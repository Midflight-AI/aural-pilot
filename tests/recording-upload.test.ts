import assert from "node:assert/strict";
import test from "node:test";
import { isFinalRecordingName, isRecordingName, uploadRecording } from "../src/lib/recording-upload";

test("only interview recording names are accepted", () => {
  assert.ok(isRecordingName("recording-1795567678760.m4a"));
  assert.ok(isRecordingName("recording-1795567678760-seg0.webm"));
  assert.ok(!isRecordingName("../other-session/recording-1795567678760.m4a"));
  assert.ok(!isRecordingName("recording-1795567678760.exe"));
  assert.ok(isFinalRecordingName("recording-1795567678760.webm"));
  assert.ok(!isFinalRecordingName("recording-1795567678760-seg0.webm"));
});

function fakeStorage(failPuts: number) {
  const calls: string[] = [];
  let puts = 0;
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target === "/api/session/recording-upload") {
      const action = JSON.parse(String(init?.body)).action;
      calls.push(action);
      return Response.json(action === "grant" ? { url: "https://storage.test/upload", path: "s/r" } : { url: "https://storage.test/play", path: "s/r" });
    }
    calls.push("put");
    puts += 1;
    return new Response(null, { status: puts <= failPuts ? 503 : 200 });
  }) as typeof fetch;
  return { request, calls };
}

test("a recording upload retries a failed transfer and returns the playback URL", async () => {
  const { request, calls } = fakeStorage(1);
  const url = await uploadRecording("s", new Blob(["audio"]), "recording-1795567678760.webm", { request, backoffMs: 0 });
  assert.equal(url, "https://storage.test/play");
  assert.deepEqual(calls, ["grant", "put", "grant", "put", "read"]);
});

test("a recording upload gives up after its attempts", async () => {
  const { request } = fakeStorage(5);
  await assert.rejects(uploadRecording("s", new Blob(["audio"]), "recording-1795567678760.webm", { request, attempts: 2, backoffMs: 0 }));
});
