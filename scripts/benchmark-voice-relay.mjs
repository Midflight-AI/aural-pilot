// Synthetic voice load only; no candidate content or tokens in output.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { SignJWT } from 'jose';
const [url,countArg='6',output='/private/tmp/aural-voice-benchmark.json']=process.argv.slice(2);
const count=Number(countArg);
if(!/^wss:\/\/aural-relay(?:--[a-z0-9-]+)?\.purpleflower-a0eeeb4d\.eastus2\.azurecontainerapps\.io$/.test(url||'')||!Number.isInteger(count)||count<1||count>6)throw Error('known_relay_and_1_to_6_sessions_required');
const candidates=process.env.VOICE_BENCH_CANDIDATES_FILE?JSON.parse(fs.readFileSync(process.env.VOICE_BENCH_CANDIDATES_FILE,'utf8')):null;
const secret=candidates?null:fs.readFileSync(process.env.VOICE_BENCH_SECRET_FILE,'utf8').trim();
if(candidates&&candidates.length<count)throw Error('candidate_fixtures_missing');
const pcm=fs.readFileSync(process.env.VOICE_BENCH_PCM_FILE);
if(pcm.length>16000*2*30)throw Error('synthetic_fixture_too_long');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
async function run(index){
 const sessionId=candidates?.[index]?.sessionId??crypto.randomUUID();
 const init={type:'init',sessionId,context:{title:'Synthetic release concurrency check',aiName:'Interviewer',aiTone:'FRIENDLY',language:'en',followUpDepth:'LOW',questions:[{text:'Briefly explain how you help a customer with a billing problem.',type:'TEXT',order:0},{text:'What would you do next?',type:'TEXT',order:1}]}};
 let ticket;
 if(candidates){
  const response=await fetch("https://interviews.rampremote.com/api/voice/ticket",{method:"POST",headers:{"Content-Type":"application/json","x-aural-video-invite":candidates[index].inviteToken},body:JSON.stringify(init),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("candidate_ticket_"+response.status);
  ticket=(await response.json()).ticket;
 }else ticket=await new SignJWT({digest:crypto.createHash('sha256').update(JSON.stringify(init)).digest('hex')}).setProtectedHeader({alg:'HS256'}).setIssuer('aural-voice').setAudience('aural-relay').setSubject('session:'+sessionId).setIssuedAt().setExpirationTime('60s').sign(new TextEncoder().encode(secret));
 const start=performance.now(),result={index,sessionId,readyMs:null,greetingMs:null,responseMs:null,audioBytes:0,asrEvents:0,errors:0,retries:0,earlyResponseBytes:0};results.push(result);
 const ws=new WebSocket(url); let speechEnd=null,feeding=false,finished=false,retryTimer=null;
 return await new Promise(resolve=>{
  const finish=reason=>{if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(retryTimer);result.outcome=reason;result.elapsedMs=Math.round(performance.now()-start);ws.close();resolve(result);};
  const timeout=setTimeout(()=>finish('timeout'),90000);
  ws.on('error',()=>{result.errors++;finish('connection_error');});
  ws.on('close',()=>{if(!finished)finish('closed');});
  ws.on('open',()=>ws.send(JSON.stringify({...init,ticket})));
  ws.on('message',async(raw,binary)=>{
   if(binary){result.audioBytes+=raw.length;if(feeding&&speechEnd===null)result.earlyResponseBytes+=raw.length;if(result.greetingMs===null)result.greetingMs=Math.round(performance.now()-start);if(speechEnd!==null&&result.responseMs===null){result.responseMs=Math.round(performance.now()-speechEnd);finish('response_received');}return;}
   const msg=JSON.parse(raw.toString());
   if(msg.type==='ready')result.readyMs=Math.round(performance.now()-start);
   if(msg.type==='asr')result.asrEvents++;
   if(msg.type==='asr_ended'&&msg.text&&!retryTimer){retryTimer=setTimeout(()=>{if(!finished&&result.responseMs===null){result.retries++;ws.send(JSON.stringify({type:'text_input',content:msg.text,replay:true}));}},8000);}
   if(msg.type==='error'){result.errors++;finish('relay_error');}
   if(msg.type==='tts_ended'&&!feeding){
    feeding=true;await delay(1800);
    for(let offset=0;offset<pcm.length&&!finished;offset+=3200){ws.send(JSON.stringify({type:'audio',data:pcm.subarray(offset,offset+3200).toString('hex')}));await delay(100);}
    speechEnd=performance.now();
    for(let n=0;n<15&&!finished;n++){ws.send(JSON.stringify({type:'audio',data:Buffer.alloc(3200).toString('hex')}));await delay(100);}
   }
  });
 });
}
await Promise.all(Array.from({length:count},(_,i)=>run(i)));
fs.writeFileSync(output,JSON.stringify({url,count,fixtureSeconds:pcm.length/32000,results},null,2),{mode:0o600});
console.log(JSON.stringify({output,count,results}));
if(results.some(r=>r.outcome!=='response_received'||r.errors))process.exitCode=1;
