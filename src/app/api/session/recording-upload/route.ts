import { createLogger } from "@/lib/logger";
import { isFinalRecordingName, isRecordingName } from "@/lib/recording-upload";
import { deleteSessionSegmentFiles } from "@/lib/storage-cleanup";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const log = createLogger("api/session/recording-upload");

/**
 * Interview audio goes straight to Storage: a whole interview is larger than
 * the request body a function accepts.
 *
 * - `grant`: a signed upload URL for `recordings/<sessionId>/<filename>`.
 * - `read`: after the upload, the playback URL; a final recording replaces the
 *   rolling checkpoint, which is then deleted.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const filename = typeof body?.filename === "string" ? body.filename : "";
  const scope = req.headers.get("x-aural-candidate-session");
  if (scope && scope !== sessionId) return NextResponse.json({ error: "access_denied" }, { status: 403 });
  if (!sessionId || !isRecordingName(filename)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { data: session, error: sessionError } = await supabaseAdmin.from("sessions").select("id").eq("id", sessionId).maybeSingle();
  if (sessionError) {
    log.error("Session lookup failed:", sessionError);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = `${sessionId}/${filename}`;
  const storage = supabaseAdmin.storage.from("recordings");
  if (body.action === "grant") {
    const { data, error } = await storage.createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      log.error("Upload grant failed:", error);
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ url: data.signedUrl, path });
  }
  if (body.action === "read") {
    const { data, error } = await storage.createSignedUrl(path, 60 * 60 * 24 * 365);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "not_uploaded" }, { status: 409 });
    if (isFinalRecordingName(filename)) await deleteSessionSegmentFiles(sessionId);
    return NextResponse.json({ url: data.signedUrl, path });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
