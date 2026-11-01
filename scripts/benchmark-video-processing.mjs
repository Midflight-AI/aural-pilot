// Isolated-preview processing benchmark. Never loads production credentials or
// deletes recordings. Source media must be an existing synthetic test fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
const exec = promisify(execFile);
const [base, countText = '1', label = 'processing-benchmark'] = process.argv.slice(2);
const count = Number(countText);
if (!/^https:\/\/aural-pilot-[a-z0-9-]+-midflight-ai\.vercel\.app$/.test(base ?? '') || !Number.isInteger(count) || count < 1 || count > 6) throw Error('isolated_preview_and_1_to_6_recordings_required');
const ref = 'fjagcdzwvwfdufefpglm';
const url = `https://${ref}.supabase.co`;
const key = process.env.VIDEO_BENCH_PREVIEW_KEY;
if (!key || !process.env.VIDEO_BENCH_PASSWORD || !process.env.VIDEO_BENCH_CRON_SECRET) throw Error('isolated_preview_credentials_required');
const db = createClient(url, key, { auth: { persistSession: false } });
const checked = r => { if(r.error) throw Error(r.error.message); return r.data; };
const source = checked(await db.from('video_spike_recordings').select('*').eq('id', '21287522-d11a-46f4-a4c7-26563d9b135e').single());
const originalSession = checked(await db.from('sessions').select('interviewId').eq('id', source.session_id).single());
const due = checked(await db.from('video_spike_recordings').select('id,state,manifest_hash,next_processing_at').in('state',['processing','failed'])).filter(r => r.manifest_hash && (r.state==='processing'||r.next_processing_at && Date.parse(r.next_processing_at)<=Date.now()));
if(due.length) throw Error('preview_queue_not_idle');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aural-throughput-'));
let cookies = [];
const client = createServerClient(url,key,{cookies:{getAll:()=>cookies,setAll:values=>{cookies=values;}}});
checked(await client.auth.signInWithPassword({email:process.env.VIDEO_BENCH_EMAIL,password:process.env.VIDEO_BENCH_PASSWORD}));
const config = path.join(directory,'auth.curl');
fs.writeFileSync(config,`silent\nshow-error\nmax-time = 780\nheader = "Content-Type: application/json"\nheader = "Cookie: ${cookies.map(c=>`${c.name}=${c.value}`).join('; ')}"\n`,{mode:0o600});
const cronConfig = path.join(directory,'cron.curl');
fs.writeFileSync(cronConfig,`silent\nshow-error\nmax-time = 780\nheader = "Authorization: Bearer ${process.env.VIDEO_BENCH_CRON_SECRET}"\n`,{mode:0o600});
const fixtures = [];
for(let n=0;n<count;n++) {
 const id=crypto.randomUUID(),sid=crypto.randomUUID();
 const manifest={...source.manifest,id,sessionId:sid};
 checked(await db.from('sessions').insert({id:sid,interviewId:originalSession.interviewId,modeUsed:'VOICE',status:'COMPLETED'}));
 checked(await db.from('video_spike_recordings').insert({id,session_id:sid,owner_id:source.owner_id,consent_version:source.consent_version,state:'uploading',expires_at:null}));
 for(let offset=0;offset<manifest.chunks.length;offset+=4) await Promise.all(manifest.chunks.slice(offset,offset+4).map(async chunk=>{
  const suffix=`${chunk.sequence}-${chunk.sha256}.bin`;
  checked(await db.storage.from('video-spike-source').copy(`${source.id}/${suffix}`,`${id}/${suffix}`));
 }));
 checked(await db.from('video_spike_chunks').insert(manifest.chunks.map(c=>({recording_id:id,sequence:c.sequence,bytes:c.bytes,sha256:c.sha256,end_ms:c.endMs,acknowledged:true}))));
 fixtures.push({id,sessionId:sid,manifest});
}
const proof={label,base,sourceDurationSeconds:source.duration_seconds,count,fixtures:fixtures.map(f=>({id:f.id,sessionId:f.sessionId})),pollIntervalMs:1000,samples:[],cron:[]};
const proofPath=path.join(directory,'proof.json');
const save=()=>fs.writeFileSync(proofPath,JSON.stringify(proof,null,2),{mode:0o600});save();
console.log(JSON.stringify({event:'fixtures_ready',count,proofPath}));
const invoke=async(route,body,auth=config)=>{
 const requestId=crypto.randomUUID(),output=path.join(directory,requestId+'.json');
 const args=['curl',base+route,'--scope','team_fxdZOkgfkblrRaNErlALiryU','--','--config',auth,'--output',output,'--write-out','%{time_starttransfer}'];
 if(body){const input=path.join(directory,requestId+'-body.json');fs.writeFileSync(input,JSON.stringify(body),{mode:0o600});args.push('--request','POST','--data-binary','@'+input);}
 const start=Date.now();
 const command=process.env.VERCEL_CLI_PATH?process.execPath:'vercel';
 const prefix=process.env.VERCEL_CLI_PATH?[process.env.VERCEL_CLI_PATH]:[];
 const {stdout}=await exec(command,[...prefix,...args],{timeout:790000,maxBuffer:100000});
 const response=JSON.parse(fs.readFileSync(output,'utf8'));if(response.error)throw Error(response.error);
 return {response,elapsedMs:Date.now()-start,timeToFirstByteSeconds:Number(stdout.trim())};
};
proof.startedAt=Date.now();
const requests=fixtures.map(async f=>{
 const response=await invoke('/api/session/video/'+f.id,{action:'finalize',manifest:f.manifest});
 Object.assign(proof.fixtures.find(x=>x.id===f.id),{finalization:response});save();return response;
});
// Observe rejections immediately while sampling worker state.
const finalized=Promise.allSettled(requests);
let nextSweep=proof.startedAt+60000, sweep=null;
const terminal=new Set();
while(Date.now()-proof.startedAt<360000){
 const rows=checked(await db.from('video_spike_recordings').select('id,state,processing_attempts,lease_token,lease_until,failure_code,duration_seconds,output_path,expires_at').in('id',fixtures.map(f=>f.id)));
 const elapsedMs=Date.now()-proof.startedAt;
 const active=rows.filter(r=>r.state==='processing'&&r.lease_until&&Date.parse(r.lease_until)>Date.now()).length;
 if(active>2)throw Error('global_concurrency_exceeded');
 proof.samples.push({elapsedMs,active,states:rows.map(r=>({id:r.id,state:r.state,attempts:r.processing_attempts}))});
 for(const row of rows){const f=proof.fixtures.find(f=>f.id===row.id);if(row.lease_token&&f.firstLeaseMs===undefined)f.firstLeaseMs=elapsedMs;
  if(['ready','partial','failed'].includes(row.state)&&!terminal.has(row.id)){terminal.add(row.id);Object.assign(f,{completedMs:elapsedMs,final:row});}
 }
 save();if(terminal.size===count)break;
 if(Date.now()>=nextSweep&&!sweep){nextSweep+=60000;sweep=invoke('/api/internal/video/process',null,cronConfig).then(result=>proof.cron.push(result),error=>proof.cron.push({error:error.message})).finally(()=>{sweep=null;});}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
proof.finalizationResults=await finalized;if(sweep)await sweep;
for(const f of proof.fixtures){if(f.final?.state!=='ready'||f.final.processing_attempts!==1||f.final.expires_at!==null)throw Error('benchmark_not_ready_once');
 const signed=checked(await db.storage.from('video-spike-output').createSignedUrl(f.final.output_path,60));
 const r=await fetch(signed.signedUrl,{headers:{Range:'bytes=0-1023'}});f.playbackStatus=r.status;await r.arrayBuffer();if(r.status!==206)throw Error('range_playback_failed');
}
proof.finishedAt=Date.now();save();
console.log(JSON.stringify({event:'complete',label,count,proofPath,maxObservedActive:Math.max(...proof.samples.map(s=>s.active)),recordings:proof.fixtures.map(f=>({id:f.id,firstLeaseMs:f.firstLeaseMs,completedMs:f.completedMs,finalizeTtfbSeconds:f.finalization?.timeToFirstByteSeconds,duration:f.final.duration_seconds,attempts:f.final.processing_attempts,rangeStatus:f.playbackStatus})),cron:proof.cron}));
