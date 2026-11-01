import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { healthFindings, type HealthSnapshot } from "@/lib/observability/health";

export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const operators = (process.env.AURAL_OPERATIONS_USER_IDS ?? "").split(",").map(id => id.trim());
  if (!user || !operators.includes(user.id)) notFound();
  const { data, error } = await db.rpc("interview_health");
  const snapshot = !error && data ? data as HealthSnapshot : null;
  const findings = snapshot ? healthFindings(snapshot) : ["monitoring_unavailable"];
  const seconds = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`;
  return <div className="space-y-6 p-6">
    <div className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Interview health</h1><p className="text-sm text-muted-foreground">Last 15 minutes · Checked {new Date().toISOString()}</p></div><form><Button type="submit" variant="outline">Refresh</Button></form></div>
    <Card><CardHeader><CardTitle>{findings.length ? "Needs attention" : snapshot?.metrics.length ? "No issues detected" : "No recent measurements"}</CardTitle></CardHeader><CardContent>
      {findings.length ? <ul className="list-disc pl-5">{findings.map(finding => <li key={finding}>{finding.replaceAll("_", " ")}</li>)}</ul> : <p className="text-sm text-muted-foreground">{snapshot?.metrics.length ? "Review response times and sample counts below." : "A quiet window does not prove that interviews are working."}</p>}
    </CardContent></Card>
    {snapshot && <Card><CardHeader><CardTitle>Response and recording performance</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Measurement</th><th className="p-2">Source</th><th className="p-2">Samples</th><th className="p-2">Median</th><th className="p-2">p95</th></tr></thead><tbody>{snapshot.metrics.map(metric => <tr className="border-b" key={`${metric.source}:${metric.kind}`}><td className="p-2">{metric.kind.replaceAll("_", " ")}</td><td className="p-2">{metric.source}</td><td className="p-2">{metric.samples}</td><td className="p-2">{seconds(metric.p50_ms)}</td><td className="p-2">{seconds(metric.p95_ms)}</td></tr>)}</tbody></table></div><p className="mt-4 text-sm text-muted-foreground">Voice response measures estimated speech-end to scheduled playback. Model first audio measures provider time. Video ready measures finalization to available playback; video finalize includes the candidate’s remaining uploads.</p></CardContent></Card>}
  </div>;
}
