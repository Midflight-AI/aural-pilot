"use client";

import { ObservationQueue, type ObservationKind } from "./events";

const queues = new Map<string, ObservationQueue>();
let installed = false;
export function observe(sessionId: string, kind: ObservationKind, durationMs?: number, bytes?: number) {
  if (typeof window === "undefined" || !/^[a-f0-9-]{36}$/i.test(sessionId)) return;
  let queue = queues.get(sessionId);
  if (!queue) {
    // Capture the invitation while still on its page, including for final unload.
    const invite = /^\/i\/invite\/([A-Za-z0-9_-]{12,128})\/session\/?$/.exec(window.location.pathname);
    const headers: Record<string,string> = { "Content-Type": "application/json", ...(invite ? { "x-aural-video-invite": invite[1] } : {}) };
    queue = new ObservationQueue(async events => (await fetch("/api/session/observations", {
      method: "POST", headers, body: JSON.stringify({ sessionId, events }),
      keepalive: true, signal: AbortSignal.timeout(5_000),
    })).ok);
    if (queues.size >= 8) queues.delete(queues.keys().next().value!);
    queues.set(sessionId, queue);
  }
  queue.add({ id: crypto.randomUUID(), kind, durationMs, bytes });
  if (!installed) {
    installed = true;
    const flush = () => { for (const q of queues.values()) void q.flush(); };
    setInterval(flush, 15_000);
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
  }
}
