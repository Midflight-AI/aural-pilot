/** Names the browser may upload into a session's recordings folder. */
const RECORDING_NAME = /^recording-\d{10,16}(-seg\d+)?\.(webm|m4a)$/;

export function isRecordingName(name: string): boolean {
  return RECORDING_NAME.test(name);
}

/** The finished recording, as opposed to the rolling checkpoint (`-seg0`). */
export function isFinalRecordingName(name: string): boolean {
  return isRecordingName(name) && !/-seg\d+\./.test(name);
}

async function requestRecording(request: typeof fetch, body: Record<string, string>): Promise<{ url: string; path: string }> {
  const response = await request("/api/session/recording-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`recording_${body.action}_failed_${response.status}`);
  return response.json();
}

/**
 * Uploads a recording straight to Storage, retrying with backoff, and returns
 * its playback URL. A retry overwrites the same object, so it never duplicates.
 */
export async function uploadRecording(
  sessionId: string,
  blob: Blob,
  filename: string,
  { request = fetch, attempts = 3, backoffMs = 1_000 }: { request?: typeof fetch; attempts?: number; backoffMs?: number } = {},
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const grant = await requestRecording(request, { action: "grant", sessionId, filename });
      const put = await request(grant.url, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" },
        body: blob,
        signal: AbortSignal.timeout(120_000),
      });
      if (!put.ok) throw new Error(`recording_upload_failed_${put.status}`);
      return (await requestRecording(request, { action: "read", sessionId, filename })).url;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** (attempt - 1)));
    }
  }
}
