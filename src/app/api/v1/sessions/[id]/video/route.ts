import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { authorizeSession,json,OUTPUT_BUCKET,responseError,VideoError } from "@/lib/video/server";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params;await authorizeSession(id,request);
  const {data:row,error}=await db.from("video_spike_recordings").select("id,state,revision,duration_seconds,output_path,failure_code").eq("session_id",id).maybeSingle();
  if(error) throw new VideoError(503,"recording_unavailable");
  if(!row) return json({data:null});
  const state=row.state;
  let playback: {url:string;expiresAt:string}|undefined;
  if(new URL(request.url).searchParams.get("playback")==="true" && ["ready","partial"].includes(state) && row.output_path) {
   const {data,error:signError}=await db.storage.from(OUTPUT_BUCKET).createSignedUrl(row.output_path,300);
   if(signError || !data) throw new VideoError(503,"playback_unavailable");
   playback={url:data.signedUrl,expiresAt:new Date(Date.now()+300000).toISOString()};
  }
  return json({data:{id:row.id,kind:"video",state,revision:row.revision,durationSeconds:row.duration_seconds,expiresAt:null,failureCode:row.failure_code,playback}});
 } catch(error) { return responseError(error); }
}
