import { after } from "next/server";
import { processVideoQueue } from "@/lib/video/processor";
export const maxDuration = 800;
import { createHash } from "node:crypto";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { acknowledgeChunk,canonicalManifest,chunkDescriptor,json,jsonBody,ownedRecording,registerChunk,responseError,SOURCE_BUCKET,sourcePath,VideoError } from "@/lib/video/server";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params; const row=await ownedRecording(id); const body=await jsonBody(request);
  if(body.action==="upload" || body.action==="acknowledge") {
   const c=chunkDescriptor(body.chunk);
   const acknowledged=await registerChunk(id,c,false);
   if(acknowledged) return json({acknowledged:true});
   if(body.action==="acknowledge") { await acknowledgeChunk(id,c);return json({acknowledged:true}); }
   const {data,error}=await db.storage.from(SOURCE_BUCKET).createSignedUploadUrl(sourcePath(id,c),{upsert:false});
   if(error || !data) throw new VideoError(503,"upload_unavailable");
   return json({url:data.signedUrl,acknowledged:false});
  }
  if(body.action==="finalize") {
   const manifest=canonicalManifest(body.manifest,id,row.session_id);
   const hash=createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
   const {data,error}=await db.rpc("video_spike_finalize",{p_id:id,p_manifest:manifest,p_hash:hash});
   if(error) throw new VideoError(409,"finalize_not_accepted");
   if(data === "processing") after(async () => { await processVideoQueue(id).catch(() => console.error("video_dispatch_failed")); });
   return json({state:data});
  }
  throw new VideoError(400,"invalid_action");
 } catch(error) { return responseError(error); }
}
