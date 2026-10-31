import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, statfs } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { videoDatabaseAllowed } from "./isolation";
import { validateManifest, type VideoManifest } from "./transport";

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg");
const ffprobe = () => process.env.FFPROBE_PATH || join(process.cwd(), "node_modules/ffprobe-static/bin/linux/x64/ffprobe");
// Fluid Compute can share a process and its scratch disk across requests.
// This is a resource guard only; database leases provide durable ownership.
let running = false;
export type ProcessingResult = { recordingId: string; state: string; totalMs: number; downloadAndRemuxMs?: number; validationMs?: number; uploadMs?: number; durationSeconds?: number; chunks?: number; code?: string };

export async function processVideoQueue(requestedId?: string): Promise<ProcessingResult[]> {
 if (running) return [];
 const url = process.env.SUPABASE_URL;
 if (!url || !videoDatabaseAllowed(url, process.env.AURAL_VIDEO_SPIKE_DATABASE_REF, process.env.VERCEL_ENV ?? process.env.AURAL_VIDEO_ENVIRONMENT) || process.env.AURAL_VIDEO_SPIKE_ENABLED !== "true") throw new Error("video_environment_not_configured");
 if (requestedId && !/^[a-f0-9-]{36}$/.test(requestedId)) throw new Error("invalid_recording_id");
 running = true;
 const results: ProcessingResult[] = [];
 const deadline = Date.now() + 740_000;
 try {
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(60_000)]) }) } });
  while (results.length < (requestedId ? 1 : 3) && deadline - Date.now() > 30_000) {
   const token = randomUUID();
   const claim = requestedId ? await db.rpc("video_spike_claim", { p_id: requestedId, p_token: token }) : await db.rpc("video_spike_claim_next", { p_token: token });
   if (claim.error) throw new Error("queue_unavailable");
   const id = requestedId ? (claim.data ? requestedId : null) : claim.data as string | null;
   if (!id) break;
   const started = Date.now();
   const controller = new AbortController();
   const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
   let heartbeating = false;
   const heartbeat = setInterval(() => {
    if (heartbeating) return;
    heartbeating = true;
    void Promise.resolve(db.rpc("video_spike_heartbeat", { p_id: id, p_token: token })).then(({ data, error }) => { if (error || !data) controller.abort(); }).catch(() => controller.abort()).finally(() => { heartbeating = false; });
   }, 30_000);
   let directory: string | undefined;
   try {
    directory = await mkdtemp(join(tmpdir(), "aural-video-"));
    const { data: row, error } = await db.from("video_spike_recordings").select("manifest").eq("id", id).single();
    if (error || !row) throw new Error("manifest_unavailable");
    const manifest = row.manifest as VideoManifest;
    validateManifest(manifest);
    const bytes = manifest.chunks.reduce((total, chunk) => total + chunk.bytes, 0);
    const disk = await statfs(directory);
    if (bytes * 1.05 + 16 * 1024 * 1024 > disk.bavail * disk.bsize) throw new Error("scratch_space_unavailable");
    const output = join(directory, "playback.webm");
    const remuxStarted = Date.now();
    // Feed verified chunks through stdin: only the seekable output uses scratch disk.
    const child = spawn(ffmpeg(), ["-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", output], { stdio: ["pipe", "ignore", "pipe"], signal });
    child.stderr.resume(); // Never log raw media/provider/subprocess content.
    child.stdin.on("error", () => {});
    let childFailed = false;
    const closed = new Promise<void>((resolve, reject) => {
     child.on("error", () => reject(new Error("media_process_failed")));
     child.on("close", code => code === 0 ? resolve() : reject(new Error("media_invalid")));
    });
    void closed.catch(() => { childFailed = true; });
    try {
     for (const chunk of manifest.chunks) {
      signal.throwIfAborted();
      if (childFailed) throw new Error("media_invalid");
      const { data, error: downloadError } = await db.storage.from("video-spike-source").download(`${id}/${chunk.sequence}-${chunk.sha256}.bin`);
      if (downloadError || !data || data.size !== chunk.bytes) throw new Error("chunk_missing");
      const buffer = Buffer.from(await data.arrayBuffer());
      if (createHash("sha256").update(buffer).digest("hex") !== chunk.sha256) throw new Error("chunk_corrupt");
      if (!child.stdin.write(buffer)) await Promise.race([once(child.stdin, "drain"), closed.then(() => { throw new Error("media_invalid"); })]);
     }
     child.stdin.end();
     await closed;
    } catch (error) {
     child.kill("SIGKILL"); await closed.catch(() => {}); throw error;
    }
    const downloadAndRemuxMs = Date.now() - remuxStarted;
    const validationStarted = Date.now();
    const { stdout } = await run(ffprobe(), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-show_entries", "format=duration", "-of", "json", output], { timeout: 30_000, signal });
    const probe = JSON.parse(stdout);
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 1810 || !probe.streams?.some((s: { codec_type: string }) => s.codec_type === "video") || !probe.streams?.some((s: { codec_type: string }) => s.codec_type === "audio")) throw new Error("media_invalid");
    await run(ffmpeg(), ["-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", output, "-f", "null", "-"], { timeout: 300_000, maxBuffer: 100_000, signal });
    const validationMs = Date.now() - validationStarted;
    signal.throwIfAborted();
    const uploadStarted = Date.now();
    const outputPath = `${id}/${token}.webm`;
    const { error: uploadError } = await db.storage.from("video-spike-output").upload(outputPath, await openAsBlob(output, { type: "video/webm" }), { contentType: "video/webm", upsert: false });
    if (uploadError) throw new Error("output_upload_failed");
    const uploadMs = Date.now() - uploadStarted;
    const { data: committed, error: commitError } = await db.rpc("video_spike_complete", { p_id: id, p_token: token, p_path: outputPath, p_duration: duration });
    if (commitError || !committed) throw new Error("processing_lease_lost");
    const result: ProcessingResult = { recordingId: id, state: manifest.partial ? "partial" : "ready", totalMs: Date.now() - started, downloadAndRemuxMs, validationMs, uploadMs, durationSeconds: duration, chunks: manifest.chunks.length };
    results.push(result); console.log(JSON.stringify({ event: "video_processing_complete", ...result }));
   } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "processing_failed";
    // Preserve all source/output objects, including an ambiguous successful commit.
    await db.rpc("video_spike_complete", { p_id: id, p_token: token, p_path: null, p_duration: null, p_error: code });
    const result = { recordingId: id, state: "failed", code, totalMs: Date.now() - started };
    results.push(result); console.error(JSON.stringify({ event: "video_processing_failed", ...result }));
   } finally {
    clearInterval(heartbeat);
    if (directory) await rm(directory, { recursive: true, force: true });
   }
  }
  return results;
 } finally { running = false; }
}
