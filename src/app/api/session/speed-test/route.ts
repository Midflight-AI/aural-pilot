import { MAX_SPEED_TEST_BYTES } from "@/lib/upload-speed";

/** Receives and discards the device check's upload sample; the browser times the request. */
export async function POST(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_request" }, { status: 400 });
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SPEED_TEST_BYTES) {
      await reader.cancel();
      return Response.json({ error: "request_too_large" }, { status: 413 });
    }
  }
  return Response.json({ bytes }, { headers: { "Cache-Control": "no-store" } });
}
