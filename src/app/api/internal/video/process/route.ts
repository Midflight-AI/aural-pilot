import { timingSafeEqual } from "node:crypto";
import { processVideoQueue } from "@/lib/video/processor";
export const maxDuration = 800;
export async function GET(request: Request) {
 const secret = process.env.CRON_SECRET;
 const expected = Buffer.from(`Bearer ${secret ?? ""}`);
 const provided = Buffer.from(request.headers.get("authorization") ?? "");
 if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
 try { return Response.json({ results: await processVideoQueue() }, { headers: { "Cache-Control": "no-store" } }); }
 catch { return Response.json({ error: "processor_unavailable" }, { status: 503 }); }
}
