/** Recorded time excludes setup, reconnect gaps and post-interview upload waits. */
export function recordedSessionDuration(session: { audioDuration?: unknown; audioRecordings?: unknown }): number | null {
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (Array.isArray(session.audioRecordings) && session.audioRecordings.length > 0) {
    // Resumed interviews contain multiple segments; the legacy primary duration
    // only describes the latest segment. Do not silently undercount missing ones.
    let total = 0;
    for (const entry of session.audioRecordings) {
      if (!entry || typeof entry !== "object" || !valid(entry.duration)) return null;
      total += entry.duration;
    }
    return Number.isFinite(total) ? Math.round(total) : null;
  }
  return valid(session.audioDuration) ? Math.round(session.audioDuration) : null;
}
