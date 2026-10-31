import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { jsonBody, responseError, VideoError } from "@/lib/video/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { issueRelayTicket } from "@/lib/voice/relay-ticket";

export async function POST(request: Request) {
  try {
    const init = await jsonBody(request);
    if (init.type !== "mic_test" && init.type !== "init") throw new VideoError(400, "invalid_request");
    const token = request.headers.get("x-aural-video-invite");
    let subject: string;
    if (token) {
      if (!/^[A-Za-z0-9_-]{12,128}$/.test(token)) throw new VideoError(403, "access_denied");
      const { data, error } = await db.from("candidates").select("*").eq("inviteToken", token).maybeSingle();
      if (error) throw new VideoError(503, "access_unavailable");
      if (!data?.sessionId || (data.inviteStatus && data.inviteStatus !== "active")) throw new VideoError(403, "access_denied");
      const { data: session, error: sessionError } = await db.from("sessions").select("status,interviewId").eq("id", data.sessionId).maybeSingle();
      if (sessionError) throw new VideoError(503, "access_unavailable");
      if (!session || session.interviewId !== data.interviewId || session.status === "COMPLETED") throw new VideoError(403, "session_closed");
      if (init.type === "init" && init.sessionId !== data.sessionId) throw new VideoError(403, "access_denied");
      subject = `session:${data.sessionId}`;
    } else {
      const client = await createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new VideoError(401, "sign_in_required");
      const { data: memberships, error } = await db.from("organization_members").select("workspaceId").eq("userId", user.id).limit(1);
      if (error || !memberships?.length) throw new VideoError(403, "access_denied");
      subject = `staff:${user.id}`;
    }
    const limited = checkRateLimit(`relay:${subject}`);
    if (limited) return limited;
    const ticket = await issueRelayTicket(process.env.VOICE_RELAY_AUTH_SECRET, subject, init);
    return Response.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
