import { z } from "zod";

// Deliberately no free-text fields, transcripts, URLs, tokens or candidate details.
export const observationKinds = ["voice_connect", "voice_connect_failed", "voice_reconnect", "voice_response", "voice_timeout", "voice_asr_timeout", "voice_model_first_audio", "voice_provider_error", "voice_empty_response", "video_upload", "video_upload_failed", "video_backlog", "video_finalize", "video_finalize_failed", "video_processing", "video_processing_failed"] as const;
export const observationSchema = z.object({
  id: z.uuid(), kind: z.enum(observationKinds),
  durationMs: z.number().finite().min(0).max(3_600_000).optional(),
  bytes: z.number().int().min(0).max(420_000_000).optional(),
}).strict();
export const observationBatch = z.array(observationSchema).min(1).max(16);
export type Observation = z.infer<typeof observationSchema>;
export type ObservationKind = typeof observationKinds[number];

/** Bounded, idempotent delivery. Telemetry never blocks or breaks the interview. */
export class ObservationQueue {
  private pending: Observation[] = [];
  private task: Promise<void> | null = null;
  constructor(private deliver: (events: Observation[]) => Promise<boolean>) {}
  add(event: Observation) {
    if (!observationSchema.safeParse(event).success) return;
    if (this.pending.length >= 64) this.pending.shift();
    this.pending.push(event);
  }
  flush(): Promise<void> {
    if (this.task) return this.task;
    const batch = this.pending.slice(0, 16);
    if (!batch.length) return Promise.resolve();
    this.task = Promise.resolve().then(() => this.deliver(batch)).then(ok => {
      if (ok) { const ids = new Set(batch.map(e => e.id)); this.pending = this.pending.filter(e => !ids.has(e.id)); }
    }).catch(() => {}).finally(() => { this.task = null; });
    return this.task;
  }
}
