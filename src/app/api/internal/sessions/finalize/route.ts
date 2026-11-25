import { handleVoiceSave } from "@/app/api/voice/save/logic";
import { voiceSaveOps } from "@/app/api/voice/save/ops";
import { bearerMatches } from "@/lib/observability/server";
import { supabaseAdmin as db } from "@/lib/supabase/admin";

export const maxDuration = 300;

const IDLE_MINUTES = 30;
const BATCH = 10;

/** Completes voice sessions abandoned before the browser sent "complete", so their transcript still gets a report. */
export async function GET(request: Request) {
  if (!bearerMatches(request, process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const cutoff = new Date(Date.now() - IDLE_MINUTES * 60_000).toISOString();
  const { data, error } = await db.rpc("idle_voice_sessions", { p_cutoff: cutoff, p_limit: BATCH });
  if (error) return Response.json({ error: "idle_sessions_unavailable" }, { status: 503 });
  const ids = (data ?? []) as string[];
  const failed: string[] = [];
  for (const sessionId of ids) {
    const result = await handleVoiceSave({ sessionId, complete: true }, voiceSaveOps);
    if (result.status !== 200) failed.push(sessionId);
  }
  if (ids.length) console.log(JSON.stringify({ event: "idle_sessions_completed", completed: ids.length - failed.length, failed }));
  return Response.json({ completed: ids.length - failed.length, failed }, { status: failed.length ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
