// Synthetic voice load only; no candidate content or tokens in output.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { SignJWT } from 'jose';
const [url,countArg='6',output='/private/tmp/aural-voice-benchmark.json']=process.argv.slice(2);
const count=Number(countArg);
const turns=Number(process.env.VOICE_BENCH_TURNS || 1);
if(!Number.isInteger(turns)||turns<1||turns>6)throw Error("1_to_6_turns_required");
let active=0,peakConcurrent=0;
if(!/^wss:\/\/aural-relay(?:--[a-z0-9-]+)?\.purpleflower-a0eeeb4d\.eastus2\.azurecontainerapps\.io$/.test(url||'')||!Number.isInteger(count)||count<1||count>20)throw Error('known_relay_and_1_to_20_sessions_required');
const candidates=process.env.VOICE_BENCH_CANDIDATES_FILE?JSON.parse(fs.readFileSync(process.env.VOICE_BENCH_CANDIDATES_FILE,'utf8')):null;
const secret=candidates?null:fs.readFileSync(process.env.VOICE_BENCH_SECRET_FILE,'utf8').trim();
if(candidates&&candidates.length<count)throw Error('candidate_fixtures_missing');
const pcm=fs.readFileSync(process.env.VOICE_BENCH_PCM_FILE);
if(pcm.length>16000*2*30)throw Error('synthetic_fixture_too_long');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const startedAt=new Date().toISOString();
const results=[];
async function run(index){
 const sessionId=candidates?.[index]?.sessionId??crypto.randomUUID();
 const init={type:'init',sessionId,context:{title:'Synthetic release concurrency check',aiName:'Interviewer',aiTone:'FRIENDLY',language:'en',followUpDepth:'NONE',questions:Array.from({length:turns+1},(_,order)=>({text:order===0?'Briefly explain how you help a customer with a billing problem.':'Explain another step you would take to help the customer.',type:'TEXT',order}))}};
 let ticket;
 if(candidates){
  const response=await fetch("https://interviews.rampremote.com/api/voice/ticket",{method:"POST",headers:{"Content-Type":"application/json","x-aural-video-invite":candidates[index].inviteToken},body:JSON.stringify(init),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("candidate_ticket_"+response.status);
  ticket=(await response.json()).ticket;
 }else ticket=await new SignJWT({digest:crypto.createHash('sha256').update(JSON.stringify(init)).digest('hex')}).setProtectedHeader({alg:'HS256'}).setIssuer('aural-voice').setAudience('aural-relay').setSubject('session:'+sessionId).setIssuedAt().setExpirationTime('60s').sign(new TextEncoder().encode(secret));
 const start=performance.now(),result={index,sessionId,readyMs:null,greetingMs:null,responseMs:null,audioBytes:0,asrEvents:0,errors:0,retries:0,earlyResponseBytes:0,turnResponseMs:[],events:[]};results.push(result);
 const ws=new WebSocket(url); let speechEnd=null,feeding=false,finished=false,retryTimer=null,responded=false,connected=false,phase='greeting',playbackEnd=0;
 return await new Promise(resolve=>{
  const finish=reason=>{if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(retryTimer);result.outcome=reason;result.elapsedMs=Math.round(performance.now()-start);if(connected){active--;connected=false;}ws.close();const closeTimer=setTimeout(()=>ws.terminate(),5000);closeTimer.unref();console.log(JSON.stringify({index,outcome:reason,completedTurns:result.turnResponseMs.length,errors:result.errors,retries:result.retries}));resolve(result);};
  const timeout=setTimeout(()=>finish('timeout'),Math.max(90000,turns*90000));
  ws.on('error',()=>{result.errors++;finish('connection_error');});
  ws.on('close',()=>{if(!finished)finish('closed');});
  ws.on('open',()=>{connected=true;active++;peakConcurrent=Math.max(peakConcurrent,active);ws.send(JSON.stringify({...init,ticket}));});
  ws.on('message',async(raw,binary)=>{
   if(binary){playbackEnd=Math.max(performance.now(),playbackEnd)+raw.length/48;result.audioBytes+=raw.length;if(feeding&&speechEnd===null)result.earlyResponseBytes+=raw.length;if(result.greetingMs===null)result.greetingMs=Math.round(performance.now()-start);if(phase==='awaiting_response'&&!responded){responded=true;phase='response';clearTimeout(retryTimer);retryTimer=null;const latency=Math.round(performance.now()-speechEnd);result.turnResponseMs.push(latency);result.responseMs=latency;if(result.turnResponseMs.length===turns)finish('response_received');}return;}
   const msg=JSON.parse(raw.toString());
   if(['ready','tts_ended','asr_ended','question_change','interview_complete','error'].includes(msg.type))result.events.push({type:msg.type,ms:Math.round(performance.now()-start),phase,questionIndex:msg.questionIndex});
   if(msg.type==='ready')result.readyMs=Math.round(performance.now()-start);
   if(msg.type==='asr')result.asrEvents++;
   if(msg.type==='asr_ended'&&msg.text&&!retryTimer){retryTimer=setTimeout(()=>{if(!finished&&!responded){result.retries++;ws.send(JSON.stringify({type:'text_input',content:msg.text,replay:true}));}},8000);}
   if(msg.type==='error'){result.errors++;finish('relay_error');}
   if(msg.type==='tts_ended'&&['greeting','response'].includes(phase)&&!finished){
    phase='waiting_to_speak';
    while(!finished&&performance.now()<playbackEnd+1800)await delay(Math.max(1,Math.min(500,playbackEnd+1800-performance.now())));
    if(finished)return;
    phase='speaking';feeding=true;responded=false;speechEnd=null;clearTimeout(retryTimer);retryTimer=null;
    for(let offset=0;offset<pcm.length&&!finished;offset+=3200){ws.send(JSON.stringify({type:'audio',data:pcm.subarray(offset,offset+3200).toString('hex')}));await delay(100);}
    speechEnd=performance.now();phase='awaiting_response';
    for(let n=0;n<15&&!finished;n++){ws.send(JSON.stringify({type:'audio',data:Buffer.alloc(3200).toString('hex')}));await delay(100);}
   }
  });
 });
}
await Promise.all(Array.from({length:count},(_,i)=>run(i).catch(()=>{results.push({index:i,outcome:'setup_failed',errors:1,retries:0,turnResponseMs:[]});})));
fs.writeFileSync(output,JSON.stringify({url,count,turns,startedAt,completedAt:new Date().toISOString(),peakConcurrent,fixtureSeconds:pcm.length/32000,results},null,2),{mode:0o600});
console.log(JSON.stringify({output,count,turns,peakConcurrent,results}));
if(results.some(r=>r.outcome!=='response_received'||r.errors))process.exitCode=1;
