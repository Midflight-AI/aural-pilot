/** Upload sample size: big enough to measure, small enough to finish in seconds on a slow link. */
export const SPEED_TEST_BYTES = 1_000_000;
export const MAX_SPEED_TEST_BYTES = 2_000_000;
/** Webcam video (600 kbps) plus interview audio, with headroom for the voice connection. */
export const MIN_VIDEO_UPLOAD_MBPS = 1.5;

/** Times one upload of random bytes to the app and returns megabits per second. */
export async function measureUploadMbps({ request = fetch, now = () => performance.now() }: { request?: typeof fetch; now?: () => number } = {}): Promise<number> {
  const sample = new Uint8Array(SPEED_TEST_BYTES);
  // Random bytes, so no compression along the way flatters the result.
  for (let offset = 0; offset < sample.length; offset += 65_536) crypto.getRandomValues(sample.subarray(offset, offset + 65_536));
  const started = now();
  const response = await request("/api/session/speed-test", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: sample,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`speed_test_failed_${response.status}`);
  const seconds = Math.max(now() - started, 1) / 1000;
  return (SPEED_TEST_BYTES * 8) / seconds / 1_000_000;
}
