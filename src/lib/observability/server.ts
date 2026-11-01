import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { observationBatch } from "./events";
import { VideoError } from "@/lib/video/server";

export function bearerMatches(request: Request, secret: string | undefined) {
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return !!secret && expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function saveObservations(sessionId: string, events: unknown, source: "client" | "relay") {
  const parsed = observationBatch.safeParse(events);
  if (!parsed.success) throw new VideoError(400, "invalid_observations");
  const { error } = await db.rpc("record_interview_observations", { p_session: sessionId, p_source: source, p_events: parsed.data });
  if (error) throw new VideoError(503, "observations_unavailable");
}
