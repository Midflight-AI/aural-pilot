import { randomUUID } from "node:crypto";

/**
 * The relay's own copy of the interview: every committed turn and the
 * candidate's microphone audio. The browser's save stays the record; this copy
 * fills the gaps when the browser's uploads are lost (tab closed, crash,
 * network drop), so an interview is never left without a transcript.
 */

export interface BackupTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  questionIndex: number;
  spokenAt: string;
}

export type BackupDelivery =
  | { kind: "turns"; turns: BackupTurn[] }
  | { kind: "audio"; startedAt: number; wav: Buffer };

const SAMPLE_RATE = 16_000;
/** One minute of 16 kHz mono 16-bit PCM, about 1.9 MB: well under the receiver's body limit. */
export const AUDIO_SEGMENT_BYTES = SAMPLE_RATE * 2 * 60;
/** Segments held for retry while the receiver is unreachable (about 10 MB). */
export const MAX_PENDING_SEGMENTS = 5;
const FLUSH_MS = 10_000;
/** Keeps each delivery inside the receiver's JSON body limit. */
export const TURN_BATCH = 20;

export function wavFromPcm16(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class RelayBackup {
  private turns: BackupTurn[] = [];
  private audio: Buffer[] = [];
  private audioBytes = 0;
  private audioStartedAt = 0;
  private segments: { startedAt: number; wav: Buffer }[] = [];
  private flushing: Promise<void> | null = null;

  constructor(
    private deliver: (delivery: BackupDelivery) => Promise<boolean>,
    private now: () => number = Date.now,
  ) {}

  addTurn(role: "user" | "assistant", content: string, questionIndex: number): void {
    const text = content.trim();
    if (!text) return;
    this.turns.push({ id: randomUUID(), role, content: text, questionIndex, spokenAt: new Date(this.now()).toISOString() });
  }

  addMicAudio(pcm16k: Buffer): void {
    if (!pcm16k.length) return;
    if (!this.audioBytes) this.audioStartedAt = this.now();
    this.audio.push(pcm16k);
    this.audioBytes += pcm16k.length;
    if (this.audioBytes >= AUDIO_SEGMENT_BYTES) this.cutSegment();
  }

  /** Sends what is pending; anything the receiver did not accept is kept for the next flush. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.send().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Cuts the partial audio segment and makes a last delivery attempt. */
  close(): Promise<void> {
    this.cutSegment();
    return this.flush();
  }

  private cutSegment(): void {
    if (!this.audioBytes) return;
    this.segments.push({ startedAt: this.audioStartedAt, wav: wavFromPcm16(Buffer.concat(this.audio)) });
    this.audio = [];
    this.audioBytes = 0;
    if (this.segments.length > MAX_PENDING_SEGMENTS) {
      this.segments.shift();
      console.error(JSON.stringify({ event: "relay_backup_audio_dropped" }));
    }
  }

  private async send(): Promise<void> {
    while (this.turns.length) {
      const batch = this.turns.slice(0, TURN_BATCH);
      if (!(await this.safeDeliver({ kind: "turns", turns: batch }))) break;
      this.turns = this.turns.slice(batch.length);
    }
    while (this.segments.length) {
      if (!(await this.safeDeliver({ kind: "audio", ...this.segments[0] }))) break;
      this.segments.shift();
    }
  }

  private async safeDeliver(delivery: BackupDelivery): Promise<boolean> {
    try {
      return await this.deliver(delivery);
    } catch (error) {
      console.error(JSON.stringify({ event: "relay_backup_delivery_failed", kind: delivery.kind, error: error instanceof Error ? error.name : "unknown" }));
      return false;
    }
  }
}

/** Delivers to the web app that receives the relay's observations, with the same shared secret. */
export function relayBackup(sessionId: string): RelayBackup & { stop: () => void } {
  const observationUrl = process.env.AURAL_OBSERVABILITY_URL;
  const secret = process.env.VOICE_RELAY_AUTH_SECRET;
  const valid = /^[a-f0-9-]{36}$/i.test(sessionId);
  const backup = new RelayBackup(async (delivery) => {
    if (!observationUrl || !secret || !valid) return true;
    const url = new URL("/api/internal/relay-backup", observationUrl);
    // Only configured HTTPS destinations, never a value supplied by the candidate.
    if (url.protocol !== "https:") return true;
    const auth = { Authorization: `Bearer ${secret}` };
    let response: Response;
    if (delivery.kind === "turns") {
      response = await fetch(url, { method: "POST", redirect: "error", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, turns: delivery.turns }), signal: AbortSignal.timeout(10_000) });
    } else {
      url.searchParams.set("sessionId", sessionId);
      url.searchParams.set("startedAt", String(delivery.startedAt));
      response = await fetch(url, { method: "POST", redirect: "error", headers: { ...auth, "Content-Type": "audio/wav" }, body: new Uint8Array(delivery.wav), signal: AbortSignal.timeout(30_000) });
    }
    if (!response.ok) console.error(JSON.stringify({ event: "relay_backup_rejected", kind: delivery.kind, status: response.status }));
    return response.ok;
  });
  const timer = setInterval(() => { void backup.flush(); }, FLUSH_MS);
  timer.unref();
  return Object.assign(backup, { stop: () => { clearInterval(timer); void backup.close(); } });
}
