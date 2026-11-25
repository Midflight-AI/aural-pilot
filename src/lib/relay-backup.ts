/** Receiving side of the voice relay's backup copy (server/relay-backup.ts). */

export interface RelayTurnRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  question_index: number | null;
  spoken_at: string;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const MAX_TURNS_PER_DELIVERY = 50;
export const MAX_AUDIO_SEGMENT_BYTES = 3_000_000;

/** Returns the rows to store, or null when the delivery is malformed. */
export function relayTurnRows(sessionId: string, turns: unknown): RelayTurnRow[] | null {
  if (!Array.isArray(turns) || turns.length < 1 || turns.length > MAX_TURNS_PER_DELIVERY) return null;
  const rows: RelayTurnRow[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") return null;
    const { id, role, content, questionIndex, spokenAt } = turn as Record<string, unknown>;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || !content.trim() || content.length > 20_000) return null;
    if (typeof spokenAt !== "string" || Number.isNaN(Date.parse(spokenAt))) return null;
    rows.push({
      id, session_id: sessionId, role, content: content.trim(),
      question_index: Number.isInteger(questionIndex) ? (questionIndex as number) : null,
      spoken_at: new Date(spokenAt).toISOString(),
    });
  }
  return rows;
}

export function relayAudioPath(sessionId: string, startedAt: number): string {
  return `${sessionId}/relay/candidate-${startedAt}.wav`;
}

export function isWav(bytes: Uint8Array): boolean {
  return bytes.length > 44 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WAVE";
}

/**
 * Turns the browser never saved: those spoken after its last saved message.
 * The browser's transcript stays the record; the relay only fills the gap after it.
 */
export function unsavedRelayTurns<T extends { spoken_at: string }>(turns: readonly T[], lastSavedAt: string | null): T[] {
  if (!lastSavedAt) return [...turns];
  const cutoff = Date.parse(lastSavedAt);
  return turns.filter((turn) => Date.parse(turn.spoken_at) > cutoff);
}
