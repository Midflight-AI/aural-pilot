/** Server-side speech adapter; supports Azure's OpenAI-compatible v1 endpoint. */
export async function synthesizeOpenAiSpeech(
  text: string,
  format: "wav" | "mp3" | "pcm",
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const base = process.env.OPENAI_BASE_URL;
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TTS_DEPLOYMENT;
  if (!base || !key || !model) throw new Error("Speech provider is not configured");
  if (!text.trim() || text.length > 4096) throw new Error("Invalid speech text length");
  const url = new URL("audio/speech", `${base.replace(/\/$/, "")}/`);
  if (url.protocol !== "https:") throw new Error("Speech endpoint must use HTTPS");
  const response = await request(url, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text, voice: "ash", response_format: format }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new Error(`Speech synthesis failed (${response.status})`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("audio/") && !contentType.startsWith("application/octet-stream")) {
    throw new Error("Speech provider returned non-audio content");
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!audio.length) throw new Error("Speech provider returned empty audio");
  return audio;
}
