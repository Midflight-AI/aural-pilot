import assert from "node:assert/strict";
import test from "node:test";
import { measureUploadMbps, SPEED_TEST_BYTES } from "../src/lib/upload-speed";

test("upload speed is the sample's bits over the request time", async () => {
  let clock = 0;
  let sent = 0;
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = (init?.body as Uint8Array).byteLength;
    clock += 2_000;
    return Response.json({ bytes: sent });
  }) as typeof fetch;
  const mbps = await measureUploadMbps({ request, now: () => clock });
  assert.equal(sent, SPEED_TEST_BYTES);
  assert.equal(mbps, 4);
});

test("a failed speed test is an error, not a slow result", async () => {
  const request = (async () => new Response(null, { status: 503 })) as typeof fetch;
  await assert.rejects(measureUploadMbps({ request }));
});
