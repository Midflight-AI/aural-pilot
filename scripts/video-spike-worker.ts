/** Scheduled media worker. Finalized database rows are the durable queue. */
import { videoDatabaseAllowed } from "../src/lib/video/isolation";
import { createClient } from "@supabase/supabase-js";
import { createHash,randomUUID } from "node:crypto";
import { mkdtemp,writeFile,appendFile,rm } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateManifest,type VideoManifest } from "../src/lib/video/transport";
const run=promisify(execFile);

async function main() {
 const url=process.env.SUPABASE_URL;
 if(!url || !videoDatabaseAllowed(url,process.env.AURAL_VIDEO_SPIKE_DATABASE_REF,process.env.AURAL_VIDEO_ENVIRONMENT) || process.env.AURAL_VIDEO_SPIKE_ENABLED!=="true") throw new Error("video_environment_not_configured");
 const requestedId=process.argv[2];
 if(requestedId && !/^[a-f0-9-]{36}$/.test(requestedId)) throw new Error("recording_id_required");
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(60000)})}});
 if(process.argv.includes("--retry")) {
  if(!requestedId) throw new Error("recording_id_required");
  const {error}=await db.rpc("video_spike_retry",{p_id:requestedId});if(error) throw new Error("retry_not_accepted");
 }
 const deadline=Date.now()+8*60_000;
 let processed=0;
 while(Date.now()<deadline && processed<3) {
 const token=randomUUID();
 const claim=requestedId ? await db.rpc("video_spike_claim",{p_id:requestedId,p_token:token}) : await db.rpc("video_spike_claim_next",{p_token:token});
 if(claim.error) throw new Error("queue_unavailable");
 const id=requestedId ? (claim.data?requestedId:null) : claim.data as string|null;
 if(!id) break;
 processed++;
 const directory=await mkdtemp(join(tmpdir(),"aural-video-worker-"));
 const controller=new AbortController();
 let heartbeating=false;
 const heartbeat=setInterval(()=>{if(heartbeating)return;heartbeating=true;void Promise.resolve(db.rpc("video_spike_heartbeat",{p_id:id,p_token:token})).then(({data,error})=>{if(error||!data)controller.abort();}).catch(()=>controller.abort()).finally(()=>{heartbeating=false;});},30000);
 const stop=()=>controller.abort();process.once("SIGTERM",stop);process.once("SIGINT",stop);
 let outputPath:string|undefined;

 try {
  const {data:row,error}=await db.from("video_spike_recordings").select("manifest").eq("id",id).single();
  if(error || !row) throw new Error("manifest_unavailable");
  const manifest=row.manifest as VideoManifest;validateManifest(manifest);
  const source=join(directory,"source.webm");await writeFile(source,Buffer.alloc(0));
  for(const chunk of manifest.chunks) {
   if(controller.signal.aborted) throw new Error("processing_lease_lost");
   const {data,error}=await db.storage.from("video-spike-source").download(`${id}/${chunk.sequence}-${chunk.sha256}.bin`);
   if(error || !data || data.size!==chunk.bytes) throw new Error("chunk_missing");
   const bytes=Buffer.from(await data.arrayBuffer());
   if(createHash("sha256").update(bytes).digest("hex")!==chunk.sha256) throw new Error("chunk_corrupt");
   await appendFile(source,bytes);
  }
  const output=join(directory,"playback.webm");
  // Remux the single recorder container to add duration and seek indexes. No claim
  // of Safari/MP4 support. Separate recorder instances must be separate assets.
  await run("ffmpeg",["-v","error","-xerror","-i",source,"-map","0:v:0","-map","0:a:0","-c","copy",output],{timeout:120000,maxBuffer:100000,signal:controller.signal});
  const {stdout}=await run("ffprobe",["-v","error","-show_entries","stream=codec_type,codec_name,width,height","-show_entries","format=duration","-of","json",output],{timeout:30000,signal:controller.signal});
  const probe=JSON.parse(stdout);const duration=Number(probe.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>1810||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==="video")||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==="audio")) throw new Error("media_invalid");
  // Decode the whole short spike asset to reject corrupt payloads. Pilot long-session
  // resource measurements and a hosted worker remain separate release gates.
  await run("ffmpeg",["-v","error","-xerror","-i",output,"-f","null","-"],{timeout:300000,maxBuffer:100000,signal:controller.signal});
  if(controller.signal.aborted) throw new Error("processing_lease_lost");
  outputPath=`${id}/${token}.webm`;
  const {error:uploadError}=await db.storage.from("video-spike-output").upload(outputPath,await openAsBlob(output,{type:"video/webm"}),{contentType:"video/webm",upsert:false});
  if(uploadError) throw new Error("output_upload_failed");

  const {data:committed,error:commitError}=await db.rpc("video_spike_complete",{p_id:id,p_token:token,p_path:outputPath,p_duration:duration});
  if(commitError||!committed) throw new Error("processing_lease_lost");
  console.log(JSON.stringify({recordingId:id,state:manifest.partial?"partial":"ready",durationSeconds:duration,chunks:manifest.chunks.length}));
 } catch(error) {
  // An ambiguous completion response may already have committed ready. Never
  // delete its validated asset; preserve a possible orphan for later cleanup.
  // Preserve source and output objects; retention is manual, including orphan review.
  await db.rpc("video_spike_complete",{p_id:id,p_token:token,p_path:null,p_duration:null,p_error:error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:"processing_failed"});
  // Never print provider replies, storage URLs, subprocess stderr or media content.
  console.error(JSON.stringify({recordingId:id,event:"processing_failed",code:error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:"processing_failed"}));
 } finally {clearInterval(heartbeat);process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop);await rm(directory,{recursive:true,force:true});}
 if(requestedId || controller.signal.aborted) break;
 }
 console.log(JSON.stringify({event:"video_worker_finished",processed}));
}
main().catch(error=>{console.error(error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:"worker_unavailable");process.exitCode=1;});
