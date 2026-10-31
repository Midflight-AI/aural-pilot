/** Preview-only manual worker. Media processing never runs in a Vercel request. */
import { isolatedVideoDatabase } from "../src/lib/video/isolation";
import { createClient } from "@supabase/supabase-js";
import { createHash,randomUUID } from "node:crypto";
import { mkdtemp,readFile,writeFile,appendFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateManifest,type VideoManifest } from "../src/lib/video/transport";
const run=promisify(execFile);

async function main() {
 const url=process.env.SUPABASE_URL;
 if(!url || !isolatedVideoDatabase(url,process.env.AURAL_VIDEO_SPIKE_DATABASE_REF) || process.env.AURAL_VIDEO_SPIKE_ENABLED!=="true") throw new Error("isolated_preview_required");
 const id=process.argv[2];if(!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("recording_id_required");
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 if(process.argv.includes("--retry")) {
  const {error}=await db.rpc("video_spike_retry",{p_id:id});if(error) throw new Error("retry_not_accepted");
 }
 const token=randomUUID();
 const {data:claimed,error:claimError}=await db.rpc("video_spike_claim",{p_id:id,p_token:token});
 if(claimError || !claimed) throw new Error("recording_not_claimed");
 const directory=await mkdtemp(join(tmpdir(),"aural-video-worker-"));
 let outputPath:string|undefined;
 try {
  const {data:row,error}=await db.from("video_spike_recordings").select("manifest").eq("id",id).single();
  if(error || !row) throw new Error("manifest_unavailable");
  const manifest=row.manifest as VideoManifest;validateManifest(manifest);
  const source=join(directory,"source.webm");await writeFile(source,Buffer.alloc(0));
  for(const chunk of manifest.chunks) {
   const {data,error}=await db.storage.from("video-spike-source").download(`${id}/${chunk.sequence}-${chunk.sha256}.bin`);
   if(error || !data || data.size!==chunk.bytes) throw new Error("chunk_missing");
   const bytes=Buffer.from(await data.arrayBuffer());
   if(createHash("sha256").update(bytes).digest("hex")!==chunk.sha256) throw new Error("chunk_corrupt");
   await appendFile(source,bytes);
  }
  const output=join(directory,"playback.webm");
  // Remux the single recorder container to add duration and seek indexes. No claim
  // of Safari/MP4 support. Separate recorder instances must be separate assets.
  await run("ffmpeg",["-v","error","-xerror","-i",source,"-map","0:v:0","-map","0:a:0","-c","copy",output],{timeout:120000,maxBuffer:100000});
  const {stdout}=await run("ffprobe",["-v","error","-show_entries","stream=codec_type,codec_name,width,height","-show_entries","format=duration","-of","json",output],{timeout:30000});
  const probe=JSON.parse(stdout);const duration=Number(probe.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>1810||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==="video")||!probe.streams?.some((s:{codec_type:string})=>s.codec_type==="audio")) throw new Error("media_invalid");
  // Decode the whole short spike asset to reject corrupt payloads. Pilot long-session
  // resource measurements and a hosted worker remain separate release gates.
  await run("ffmpeg",["-v","error","-xerror","-i",output,"-f","null","-"],{timeout:300000,maxBuffer:100000});
  outputPath=`${id}/${token}.webm`;
  const {error:uploadError}=await db.storage.from("video-spike-output").upload(outputPath,await readFile(output),{contentType:"video/webm",upsert:false});
  if(uploadError) throw new Error("output_upload_failed");
  const {data:committed,error:commitError}=await db.rpc("video_spike_complete",{p_id:id,p_token:token,p_path:outputPath,p_duration:duration});
  if(commitError||!committed) throw new Error("processing_lease_lost");
  console.log(JSON.stringify({recordingId:id,state:manifest.partial?"partial":"ready",durationSeconds:duration,chunks:manifest.chunks.length}));
 } catch(error) {
  if(outputPath) await db.storage.from("video-spike-output").remove([outputPath]);
  await db.rpc("video_spike_complete",{p_id:id,p_token:token,p_path:null,p_duration:null,p_error:"processing_failed"});
  // Never print provider replies, storage URLs, subprocess stderr or media content.
  throw new Error(error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:"processing_failed");
 } finally {await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
