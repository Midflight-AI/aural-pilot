import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ObservationQueue, observationBatch, observationSchema } from "../src/lib/observability/events";
import { healthFindings, type HealthSnapshot } from "../src/lib/observability/health";

test("telemetry rejects content, credentials, unbounded values and oversized batches", () => {
  const event = { id: randomUUID(), kind: "voice_response", durationMs: 1200 };
  assert.equal(observationSchema.safeParse(event).success, true);
  for (const invalid of [{ ...event, transcript: "private" }, { ...event, token: "credential" }, { ...event, durationMs: Infinity }, { ...event, durationMs: -1 }, { ...event, kind: "arbitrary" }]) assert.equal(observationSchema.safeParse(invalid).success, false);
  assert.equal(observationBatch.safeParse(Array(17).fill(event)).success, false);
});
test("lost acknowledgements retry identical IDs; concurrent flushes do not duplicate inflight delivery", async () => {
  const batches: string[][] = [];
  let release!: (value: boolean) => void;
  const queue = new ObservationQueue(events => { batches.push(events.map(e => e.id)); return new Promise(resolve => { release = resolve; }); });
  const first = { id: randomUUID(), kind: "video_upload" as const, durationMs: 10, bytes: 100 };
  queue.add(first);
  const pending = queue.flush();
  assert.equal(queue.flush(), pending);
  await Promise.resolve(); release(false); await pending;
  const retry = queue.flush(); await Promise.resolve();
  assert.deepEqual(batches[0], batches[1]);
  queue.add({ ...first, id: randomUUID() });
  release(true); await retry;
  const next = queue.flush(); await Promise.resolve(); assert.equal(batches[2].length, 1); assert.notEqual(batches[2][0], first.id); release(true); await next;
});
test("telemetry transport failures are isolated and memory is bounded", async () => {
  const seen: string[] = [];
  let fail = true;
  const queue = new ObservationQueue(async events => { if (fail) throw Error("offline"); seen.push(...events.map(e => e.id)); return true; });
  for (let i = 0; i < 100; i++) queue.add({ id: randomUUID(), kind: "video_upload_failed" });
  await queue.flush(); fail = false;
  for (let i = 0; i < 5; i++) await queue.flush();
  assert.equal(seen.length, 64); assert.equal(new Set(seen).size, 64);
});
test("health reports failures, slow response population and stuck work; quiet periods are not errors", () => {
  const healthy: HealthSnapshot = { windowMinutes: 15, metrics: [], stuckRecordings: 0, failedRecordings: 0, unrecoveredUploads: 0 };
  assert.deepEqual(healthFindings(healthy), []);
  const metric = { source: "client", kind: "voice_response", samples: 4, p50_ms: 1000, p95_ms: 6000, bytes: null };
  assert.deepEqual(healthFindings({ ...healthy, metrics: [metric] }), []);
  assert.deepEqual(healthFindings({ ...healthy, stuckRecordings: 1, metrics: [{ ...metric, samples: 5 }, { ...metric, kind: "voice_timeout", samples: 1 }] }), ["recording_completion_delayed", "voice_response_slow", "voice_timeout"]);
});
