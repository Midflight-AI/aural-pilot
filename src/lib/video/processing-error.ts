/** Decoder exit failures are deterministic; timeouts and lost infrastructure may recover. */
export function processingErrorCode(error: unknown): string {
 if (error instanceof Error && /^[a-z_]+$/.test(error.message)) return error.message;
 if (error && typeof error === "object") {
  const process = error as { code?: unknown; killed?: unknown; signal?: unknown; name?: unknown };
  if (process.killed || process.signal || process.name === "AbortError" || process.name === "TimeoutError") return "processing_timeout";
  if (typeof process.code === "number" && process.code !== 0) return "media_invalid";
  if (process.code === "ENOSPC") return "scratch_space_unavailable";
 }
 return "processing_failed";
}
