import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeOpenAiSpeech } from "../src/lib/voice/openai-tts";

test("Azure speaker test requests configured deployment and rejects provider failures", async () => {
  const names = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_TTS_DEPLOYMENT"] as const;
  const previous = names.map(name => process.env[name]);
  process.env.OPENAI_BASE_URL = "https://pilot.openai.azure.com/openai/v1/";
  process.env.OPENAI_API_KEY = "test-only";
  process.env.OPENAI_TTS_DEPLOYMENT = "pilot-speech";
  try {
    const controller = new AbortController();
    const mock: typeof fetch = async (url, options) => {
      assert.equal(String(url), "https://pilot.openai.azure.com/openai/v1/audio/speech");
      assert.deepEqual(JSON.parse(String(options?.body)), { model: "pilot-speech", input: "Test speaker", voice: "ash", response_format: "wav" });
      assert.equal(options?.redirect, "error");
      return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } });
    };
    assert.equal((await synthesizeOpenAiSpeech("Test speaker", "wav", controller.signal, mock)).length, 4);
    await assert.rejects(synthesizeOpenAiSpeech("Test", "wav", controller.signal, async () => new Response("private provider diagnostic", { status: 401 })), /Speech synthesis failed \(401\)/);
    await assert.rejects(synthesizeOpenAiSpeech("Test", "wav", controller.signal, async () => new Response("{}", { headers: { "content-type": "application/json" } })), /non-audio/);
    await assert.rejects(synthesizeOpenAiSpeech("Test", "wav", controller.signal, async () => new Response(new Uint8Array(), { headers: { "content-type": "audio/wav" } })), /empty audio/);
    await assert.rejects(synthesizeOpenAiSpeech("x".repeat(4097), "wav", controller.signal, mock), /text length/);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
