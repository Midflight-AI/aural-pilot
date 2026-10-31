import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { authorizeSession,json,jsonBody,responseError,uuid,VideoError } from "@/lib/video/server";
export async function GET(request: Request) {
 try { const sessionId=uuid(new URL(request.url).searchParams.get("sessionId")); await authorizeSession(sessionId); return json({enabled:true,consentVersion:"internal-video-spike-v1"}); }
 catch(error) { return responseError(error); }
}
export async function POST(request: Request) {
 try {
  const body=await jsonBody(request); const sessionId=uuid(body.sessionId); const id=uuid(body.id);
  const ownerId=await authorizeSession(sessionId);
  if(body.consentVersion!=="internal-video-spike-v1" || body.consent!==true) throw new VideoError(400,"consent_required");
  const {error}=await db.from("video_spike_recordings").insert({id,session_id:sessionId,owner_id:ownerId,consent_version:body.consentVersion});
  const {data:row}=await db.from("video_spike_recordings").select("id,owner_id,state,expires_at").eq("session_id",sessionId).maybeSingle();
  if(!row || row.id!==id || row.owner_id!==ownerId) throw new VideoError(error?409:503,"recording_exists_or_unavailable");
  if(["deleted","expired"].includes(row.state) || Date.parse(row.expires_at)<=Date.now()) throw new VideoError(410,"recording_closed");
  return json({id:row.id,state:row.state});
 } catch(error) { return responseError(error); }
}
