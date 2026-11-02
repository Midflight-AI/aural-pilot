/** One MediaRecorder instance is one container. Never concatenate recorder restarts. */
export type VideoState = "capturing" | "uploading" | "processing" | "ready" | "partial" | "failed" | "deleted" | "expired";
export interface ChunkDescriptor {
  sequence: number;
  bytes: number;
  sha256: string;
  endMs: number;
}
export interface VideoManifest {
  id: string;
  sessionId: string;
  generation: 1;
  mimeType: string;
  chunks: ChunkDescriptor[];
  sealed: boolean;
  partial: boolean;
  failureCode?: "capture_interrupted" | "backlog_limit" | "local_storage_failed";
}
export interface PendingChunk extends ChunkDescriptor { blob: Blob }
export interface VideoStore {
  saveManifest(manifest: VideoManifest): Promise<void>;
  put(id: string, chunk: PendingChunk, manifest: VideoManifest): Promise<void>;
  pending(id: string): Promise<PendingChunk[]>;
  acknowledge(id: string, sequence: number): Promise<void>;
}
export interface VideoTransport {
  /** Resolves only after server checksum/length verification; identical retries are safe. */
  upload(manifest: VideoManifest, chunk: PendingChunk): Promise<void>;
  finalize(manifest: VideoManifest): Promise<void>;
}
export const BACKLOG_BYTES = 20 * 1024 * 1024;
export const BACKLOG_MS = 60_000;
export const MAX_RECORDING_BYTES = 400 * 1024 * 1024; // Fits Vercel scratch space with output/index headroom.
export const MAX_CHUNKS = 400; // 30 minute pilot at a five-second target, with headroom.

export function validateManifest(manifest: VideoManifest): void {
  if (!manifest.sealed || !manifest.chunks.length || manifest.chunks.length > MAX_CHUNKS) throw new Error("invalid_manifest");
  if (manifest.generation !== 1 || manifest.mimeType !== "video/webm;codecs=vp8,opus") throw new Error("unsupported_container");
  let previousEnd = 0;
  let totalBytes = 0;
  for (const [i, chunk] of manifest.chunks.entries()) {
    if (chunk.sequence !== i || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > BACKLOG_BYTES ||
        !/^[a-f0-9]{64}$/.test(chunk.sha256) || !Number.isFinite(chunk.endMs) || chunk.endMs < previousEnd || chunk.endMs > 1_810_000) {
      throw new Error("invalid_chunk");
    }
    totalBytes += chunk.bytes;
    if (totalBytes > MAX_RECORDING_BYTES) throw new Error("recording_too_large");
    previousEnd = chunk.endMs;
  }
}

/** Serialized durable writes; bounded parallel uploads settle before finalization. */
export class VideoUploadQueue {
  private writes: Promise<void> = Promise.resolve();
  private drainTask: Promise<void> | null = null;
  private stopped = false;
  private bufferedBytes = 0;
  private writeFailure: Error | null = null;
  constructor(
    readonly manifest: VideoManifest,
    private store: VideoStore,
    private transport: VideoTransport,
    private onLimit: (code: "backlog_limit" | "local_storage_failed") => void,
  ) {}

  append(blob: Blob, endMs: number): Promise<void> {
    if (this.stopped || this.manifest.sealed) return Promise.reject(new Error("recording_sealed"));
    this.bufferedBytes += blob.size;
    if (this.bufferedBytes > BACKLOG_BYTES) {
      this.bufferedBytes -= blob.size;
      this.manifest.partial = true;
      this.manifest.failureCode = "backlog_limit";
      this.onLimit("backlog_limit");
      return Promise.resolve();
    }
    this.writes = this.writes.then(async () => {
      if (!blob.size) return;
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const chunk: PendingChunk = {
        sequence: this.manifest.chunks.length, bytes: blob.size, endMs,
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""), blob,
      };
      if (chunk.bytes > BACKLOG_BYTES || chunk.sequence >= MAX_CHUNKS || this.manifest.chunks.reduce((total, item) => total + item.bytes, 0) + chunk.bytes > MAX_RECORDING_BYTES) {
        this.manifest.partial = true;
        this.manifest.failureCode = "backlog_limit";
        this.onLimit("backlog_limit");
        return;
      }
      const existing = await this.store.pending(this.manifest.id);
      if (existing.reduce((total, item) => total + item.bytes, 0) + chunk.bytes > BACKLOG_BYTES) {
        this.manifest.partial = true;
        this.manifest.failureCode = "backlog_limit";
        this.onLimit("backlog_limit");
        return;
      }
      const next = { ...this.manifest, chunks: [...this.manifest.chunks, { sequence: chunk.sequence, bytes: chunk.bytes, sha256: chunk.sha256, endMs }] };
      await this.store.put(this.manifest.id, chunk, next);
      this.manifest.chunks = next.chunks;
      const pending = await this.store.pending(this.manifest.id);
      const bytes = pending.reduce((total, item) => total + item.bytes, 0);
      const earliest = pending[0]?.sequence ?? chunk.sequence;
      const startMs = earliest ? this.manifest.chunks[earliest - 1].endMs : 0;
      if (bytes >= BACKLOG_BYTES || endMs - startMs >= BACKLOG_MS) {
        this.manifest.partial = true;
        this.manifest.failureCode = "backlog_limit";
        this.onLimit("backlog_limit");
      }
    }).catch(() => {
      this.writeFailure = new Error("local_storage_failed");
      this.manifest.partial = true;
      this.manifest.failureCode = "local_storage_failed";
      this.onLimit("local_storage_failed");
    }).finally(() => { this.bufferedBytes -= blob.size; });
    return this.writes;
  }

  async drain(): Promise<void> {
    if (this.drainTask) return this.drainTask;
    this.drainTask = (async () => {
      // More chunks can be persisted while this batch is uploading, including
      // the final dataavailable event. Drain all batches before resolving.
      while (true) {
        await this.writes;
        const pending = await this.store.pending(this.manifest.id);
        if (!pending.length) break;
        // Independent immutable chunks can arrive out of order. Wait for every
        // in-flight result before retrying so a failed sibling never duplicates
        // an upload still running in the background.
        const results = await Promise.allSettled(pending.slice(0, 3).map(async (chunk) => {
          await this.transport.upload(this.manifest, chunk);
          await this.store.acknowledge(this.manifest.id, chunk.sequence);
        }));
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
    })().finally(() => { this.drainTask = null; });
    return this.drainTask;
  }

  async seal(partial = false): Promise<void> {
    this.stopped = true;
    await this.writes;
    this.manifest.sealed = true;
    this.manifest.partial ||= partial;
    if (partial && !this.manifest.failureCode) this.manifest.failureCode = "capture_interrupted";
    await this.store.saveManifest(this.manifest);
    if (this.writeFailure) throw this.writeFailure;
  }

  async retry(): Promise<void> {
    await this.drain();
    if (!this.manifest.sealed) return;
    validateManifest(this.manifest);
    await this.transport.finalize(this.manifest);
  }
}

/** An empty setup reservation has no media to seal. Keep its stable ID for prepare(). */
export async function recoverStoredVideo(manifest: VideoManifest, store: VideoStore, transport: VideoTransport): Promise<boolean> {
  if (!manifest.sealed && manifest.chunks.length === 0) return false;
  const queue = new VideoUploadQueue(manifest, store, transport, () => {});
  if (!manifest.sealed) await queue.seal(true);
  await queue.retry();
  return true;
}
