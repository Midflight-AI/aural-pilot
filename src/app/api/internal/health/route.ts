import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { bearerMatches } from "@/lib/observability/server";
import { healthFindings, type HealthSnapshot } from "@/lib/observability/health";
export async function GET(request: Request) {
  if (!bearerMatches(request, process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await db.rpc("interview_health");
  if (error || !data) return Response.json({ error: "monitoring_unavailable" }, { status: 503 });
  const snapshot = data as HealthSnapshot;
  const findings = healthFindings(snapshot);
  console[findings.length ? "error" : "log"](JSON.stringify({ event: "interview_health", findings, ...snapshot }));
  return Response.json({ checkedAt: new Date().toISOString(), findings, ...snapshot }, { headers: { "Cache-Control": "no-store" } });
}
