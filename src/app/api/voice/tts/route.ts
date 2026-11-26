import { synthesizeOpenAiSpeech } from "@/lib/voice/openai-tts";
import { isAbortError } from "@/lib/abort-error";
import { createLogger } from "@/lib/logger";
import { NextResponse } from "next/server";

const log = createLogger("api/voice/tts");

type TtsClientFormat = "wav" | "mp3" | "pcm_f32le";

function resolveClientFormat(req: Request): TtsClientFormat {
  const url = new URL(req.url);
  const queryFormat = url.searchParams.get("format")?.toLowerCase();
  const format = req.headers.get("x-aural-tts-format")?.toLowerCase();
  const accept = req.headers.get("accept")?.toLowerCase() || "";

  /** Raw float32 LE — only for callers that decode PCM manually (not HTMLAudioElement). */
  if (queryFormat === "pcm_f32le" || format === "pcm_f32le") return "pcm_f32le";
  if (queryFormat === "mp3" || format === "mp3" || accept.includes("audio/mpeg")) return "mp3";
  // WAV by default so HTMLAudioElement always receives a decodeable container.
  return "wav";
}

function s16leToF32le(input: Buffer): Uint8Array {
  const sampleCount = Math.floor(input.byteLength / 2);
  const out = new ArrayBuffer(sampleCount * 4);
  const view = new DataView(out);
  for (let i = 0; i < sampleCount; i++) {
    view.setFloat32(i * 4, input.readInt16LE(i * 2) / 32768, true);
  }
  return new Uint8Array(out);
}

function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(input.byteLength);
  new Uint8Array(out).set(input);
  return out;
}

/**
 * POST /api/voice/tts
 *
 * GPT speech for the speaker check and prep coach. Returns WAV by default (browser-safe).
 */
export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });
  if (text.length > 4096) return NextResponse.json({ error: "Text is too long" }, { status: 400 });

  const format = resolveClientFormat(req);
  try {
    const audio = await synthesizeOpenAiSpeech(text, format === "pcm_f32le" ? "pcm" : format, req.signal);
    const output = format === "pcm_f32le" ? s16leToF32le(Buffer.from(audio)) : audio;
    return new NextResponse(toArrayBuffer(output), {
      headers: {
        "Content-Type": format === "pcm_f32le" ? "application/octet-stream" : format === "mp3" ? "audio/mpeg" : "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (req.signal.aborted || isAbortError(err)) return new Response(null, { status: 499 });
    log.error("Speech synthesis failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Speech synthesis unavailable" }, { status: 502 });
  }
}
