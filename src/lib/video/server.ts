import { isolatedVideoDatabase } from "./isolation";
import { createHash } from "node:crypto";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { validateApiKey, isAuthError } from "@/lib/api-key-auth";
import { validateManifest, type ChunkDescriptor, type VideoManifest } from "./transport";

export const SOURCE_BUCKET = "video-spike-source";
export const OUTPUT_BUCKET = "video-spike-output";
export class VideoError extends Error { constructor(public status: number, code: string) { super(code); } }
export function requireSpike() {
  if (process.env.AURAL_VIDEO_SPIKE_ENABLED !== "true" || process.env.VERCEL_ENV !== "preview" || !isolatedVideoDatabase(process.env.SUPABASE_URL, process.env.AURAL_VIDEO_SPIKE_DATABASE_REF)) throw new VideoError(404, "not_enabled");
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new VideoError(400, "invalid_id");
  return value;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new VideoError(400, "invalid_request");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 100_000) { await reader.cancel(); throw new VideoError(413, "request_too_large"); }
    chunks.push(value);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(); return value; }
  catch { throw new VideoError(400, "invalid_request"); }
}
export async function authorizeSession(sessionId: string, request?: Request) {
  requireSpike(); uuid(sessionId);
  const { data: session, error } = await db.from("sessions").select("id,interview:interviews!inner(projectId)").eq("id", sessionId).maybeSingle();
  if (error) throw new VideoError(503, "session_unavailable");
  const raw = session?.interview;
  const projectId = (Array.isArray(raw) ? raw[0] : raw)?.projectId as string | undefined;
  if (!projectId) throw new VideoError(404, "session_unavailable");
  const { data: projectMembers, error: projectError } = await db.from("project_members").select("userId").eq("projectId",projectId);
  if (projectError) throw new VideoError(503,"access_unavailable");
  const allowed = (userId: string) => !projectMembers?.length || projectMembers.some(member => member.userId === userId);
  if (request) {
    const auth = await validateApiKey(request);
    if (isAuthError(auth) || (!auth.projectIds.includes(projectId) || !allowed(auth.userId))) throw new VideoError(403, "access_denied");
    return auth.userId;
  }
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new VideoError(401, "sign_in_required");
  // Internal preview access requires actual organization membership AND project access.
  // Public candidate-session authorization is deliberately outside this spike.
  const { data: project } = await db.from("projects").select("organizationId").eq("id", projectId).single();
  const { data: member, error: memberError } = await db.from("organization_members").select("userId").eq("workspaceId", project?.organizationId ?? "").eq("userId", user.id).maybeSingle();
  if (memberError || !member || !allowed(user.id)) throw new VideoError(403, "access_denied");
  return user.id;
}
export async function ownedRecording(id: string) {
  requireSpike(); uuid(id);
  const { data: recording, error } = await db.from("video_spike_recordings").select("*").eq("id", id).maybeSingle();
  if (error) throw new VideoError(503, "recording_unavailable");
  if (!recording) throw new VideoError(404, "recording_unavailable");
  const userId = await authorizeSession(recording.session_id);
  if (recording.owner_id !== userId) throw new VideoError(403, "access_denied");
  if (["deleted", "expired"].includes(recording.state) || Date.parse(recording.expires_at) <= Date.now()) throw new VideoError(410, "recording_closed");
  return recording;
}
export function chunkDescriptor(value: unknown): ChunkDescriptor {
  const c = value as ChunkDescriptor;
  try { validateManifest({ id:"", sessionId:"", generation:1, mimeType:"video/webm;codecs=vp8,opus", sealed:true, partial:false, chunks:[{ ...c, sequence:0 }] }); }
  catch { throw new VideoError(400, "invalid_chunk"); }
  if (!c || !Number.isSafeInteger(c.sequence) || c.sequence < 0 || c.sequence >= 400) throw new VideoError(400, "invalid_chunk");
  return { sequence:c.sequence,bytes:c.bytes,sha256:c.sha256,endMs:c.endMs };
}
export function sourcePath(id: string, chunk: ChunkDescriptor) { return `${id}/${chunk.sequence}-${chunk.sha256}.bin`; }
export async function registerChunk(id: string, c: ChunkDescriptor, ack: boolean) {
  const { data, error } = await db.rpc("video_spike_chunk", { p_id:id,p_sequence:c.sequence,p_bytes:c.bytes,p_sha256:c.sha256,p_end_ms:c.endMs,p_ack:ack });
  if (error) throw new VideoError(409, "chunk_not_accepted");
  return Boolean(data);
}
export async function acknowledgeChunk(id: string, c: ChunkDescriptor) {
  const { data, error } = await db.storage.from(SOURCE_BUCKET).download(sourcePath(id,c));
  if (error || !data) throw new VideoError(409, "chunk_missing");
  if (data.size !== c.bytes || createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex") !== c.sha256) throw new VideoError(409, "chunk_corrupt");
  await registerChunk(id,c,true);
}
export function canonicalManifest(value: unknown, id: string, sessionId: string): VideoManifest {
  const m = value as VideoManifest;
  if (!m || m.id !== id || m.sessionId !== sessionId || typeof m.partial !== "boolean") throw new VideoError(400,"invalid_manifest");
  try { validateManifest(m); } catch { throw new VideoError(400,"invalid_manifest"); }
  return { id,sessionId,generation:1,mimeType:m.mimeType,chunks:m.chunks.map(chunkDescriptor),sealed:true,partial:m.partial };
}
export function responseError(error: unknown) {
  return Response.json({ error: error instanceof VideoError ? error.message : "video_unavailable" }, {status:error instanceof VideoError ? error.status : 503,headers:{"Cache-Control":"no-store"}});
}
export function json(data: unknown) { return Response.json(data,{headers:{"Cache-Control":"no-store"}}); }
