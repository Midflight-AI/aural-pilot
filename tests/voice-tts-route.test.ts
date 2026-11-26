import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "@/app/api/voice/tts/route";

const ENV = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_TTS_DEPLOYMENT"] as const;

async function withSpeech(response: () => Response, run: (requests: { url: string; body: Record<string, unknown> }[]) => Promise<void>) {
  const previousEnv = ENV.map((name) => process.env[name]);
  const previousFetch = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  process.env.OPENAI_BASE_URL = "https://pilot.openai.azure.com/openai/v1/";
  process.env.OPENAI_API_KEY = "test-only";
  delete process.env.OPENAI_TTS_DEPLOYMENT;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return response();
  }) as typeof fetch;
  try {
    await run(requests);
  } finally {
    globalThis.fetch = previousFetch;
    ENV.forEach((name, index) => {
      if (previousEnv[index] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[index];
    });
  }
}

function speechRequest(text: string, format = "wav") {
  return new Request(`http://localhost/api/voice/tts?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

test("speaker check speech comes from the GPT speech deployment", async () => {
  await withSpeech(
    () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } }),
    async (requests) => {
      const res = await POST(speechRequest("Can you hear me?"));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "audio/wav");
      assert.equal((await res.arrayBuffer()).byteLength, 4);
      assert.equal(requests[0].url, "https://pilot.openai.azure.com/openai/v1/audio/speech");
      assert.deepEqual(requests[0].body, { model: "aural-pilot-tts", input: "Can you hear me?", voice: "ash", response_format: "wav" });
    },
  );
});

test("speech failures return 502 so the coach falls back to browser speech", async () => {
  await withSpeech(
    () => new Response("provider detail", { status: 500 }),
    async () => {
      const res = await POST(speechRequest("Hello", "mp3"));
      assert.equal(res.status, 502);
      assert.deepEqual(await res.json(), { error: "Speech synthesis unavailable" });
    },
  );
});

test("speech refuses empty text", async () => {
  await withSpeech(
    () => new Response(null, { status: 500 }),
    async (requests) => {
      assert.equal((await POST(speechRequest("  "))).status, 400);
      assert.equal(requests.length, 0);
    },
  );
});
