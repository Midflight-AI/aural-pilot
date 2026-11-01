import type { WebSocket, RawData } from "ws";

/** Install before awaiting open or sending session.update: events can share one socket read. */
export function waitForRealtimeEvent(ws: WebSocket, event: string, send?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      ws.off("message", message); ws.off("error", failed); ws.off("close", closed);
      if (error) reject(error); else resolve();
    };
    const message = (raw: RawData) => {
      try {
        const value = JSON.parse(raw.toString());
        if (value.type === event) finish();
        else if (value.type === "error") finish(new Error("upstream_setup_failed"));
      } catch { /* Ignore non-JSON frames during setup. */ }
    };
    const failed = () => finish(new Error("upstream_connection_failed"));
    const closed = () => finish(new Error("upstream_closed_during_setup"));
    const timer = setTimeout(() => finish(new Error("upstream_setup_timeout")), 10_000);
    ws.on("message", message); ws.once("error", failed); ws.once("close", closed);
    try { send?.(); } catch { failed(); }
  });
}
