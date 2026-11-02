export interface HealthSnapshot {
  windowMinutes: number;
  metrics: { source: string; kind: string; samples: number; p50_ms: number | null; p95_ms: number | null; bytes: number | null }[];
  stuckRecordings: number;
  unrecoveredUploads: number;
  failedRecordings: number;
}
export function healthFindings(snapshot: HealthSnapshot): string[] {
  const findings: string[] = [];
  if (snapshot.stuckRecordings) findings.push("recording_completion_delayed");
  if (snapshot.unrecoveredUploads) findings.push("recording_upload_unrecovered");
  if (snapshot.failedRecordings) findings.push("recording_processing_failed");
  for (const metric of snapshot.metrics) {
    if (/failed|timeout|provider_error|empty_response/.test(metric.kind) && metric.samples > 0) findings.push(metric.kind);
    // Sample floor avoids treating one slow measurement as a population percentile.
    if (metric.kind === "voice_response" && metric.samples >= 5 && (metric.p95_ms ?? 0) > 5_000) findings.push("voice_response_slow");
    if (metric.kind === "video_backlog" && metric.samples) findings.push("video_backlog");
  }
  return [...new Set(findings)].sort();
}
