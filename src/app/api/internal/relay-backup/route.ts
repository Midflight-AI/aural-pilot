import { bearerMatches } from "@/lib/observability/server";
import { isWav, MAX_AUDIO_SEGMENT_BYTES, relayAudioPath, relayTurnRows } from "@/lib/relay-backup";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { json, jsonBody, responseError, uuid, VideoError } from "@/lib/video/server";

/** Stores the voice relay's backup copy: committed turns (JSON) or a candidate audio segment (WAV). */
export async function POST(request: Request) {
  if (!bearerMatches(request, process.env.VOICE_RELAY_AUTH_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    if (request.headers.get("content-type")?.startsWith("audio/wav")) {
      const params = new URL(request.url).searchParams;
      const sessionId = uuid(params.get("sessionId"));
      const startedAt = Number(params.get("startedAt"));
      if (!Number.isSafeInteger(startedAt) || startedAt <= 0) throw new VideoError(400, "invalid_request");
      const declared = Number(request.headers.get("content-length"));
      if (declared > MAX_AUDIO_SEGMENT_BYTES) throw new VideoError(413, "request_too_large");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_AUDIO_SEGMENT_BYTES) throw new VideoError(413, "request_too_large");
      if (!isWav(bytes)) throw new VideoError(400, "invalid_audio");
      const { data: session, error: sessionError } = await db.from("sessions").select("id").eq("id", sessionId).maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) throw new VideoError(404, "session_not_found");
      const { error } = await db.storage.from("recordings").upload(relayAudioPath(sessionId, startedAt), bytes, { contentType: "audio/wav", upsert: true });
      if (error) throw error;
      return json({ accepted: true });
    }
    const body = await jsonBody(request);
    const sessionId = uuid(body.sessionId);
    const rows = relayTurnRows(sessionId, body.turns);
    if (!rows) throw new VideoError(400, "invalid_turns");
    const { error } = await db.from("relay_transcript_turns").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    return json({ accepted: true });
  } catch (error) {
    if (!(error instanceof VideoError)) console.error(JSON.stringify({ event: "relay_backup_store_failed" }));
    return responseError(error);
  }
}
