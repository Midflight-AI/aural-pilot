import { randomUUID } from "node:crypto";
import { ObservationQueue, type ObservationKind } from "../src/lib/observability/events";

export function relayObservations(sessionId: string) {
  const url = process.env.AURAL_OBSERVABILITY_URL;
  const secret = process.env.VOICE_RELAY_AUTH_SECRET;
  const valid = /^[a-f0-9-]{36}$/i.test(sessionId);
  const queue = new ObservationQueue(async events => {
    if (!url || !secret || !valid) return true;
    // Only configured HTTPS destinations, never a value supplied by the candidate.
    if (new URL(url).protocol !== "https:") return false;
    const response = await fetch(url, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ sessionId, events }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) console.error(JSON.stringify({ event: "observation_delivery_failed", status: response.status }));
    return response.ok;
  });
  const timer = setInterval(() => { void queue.flush(); }, 5_000);
  timer.unref();
  return {
    emit(kind: ObservationKind, durationMs?: number) {
      console.log(JSON.stringify({ event: "voice_observation", kind, durationMs }));
      queue.add({ id: randomUUID(), kind, durationMs });
    },
    close() { clearInterval(timer); void queue.flush(); },
  };
}
