import { z } from "zod";

export const invitationActionSchema = z.object({
  action: z.enum(["cancel", "expire", "reissue"]),
  version: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(v => v.action !== "reissue" || Boolean(v.expiresAt), "Reissue requires an expiry date.");
export function validIdempotencyKey(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}
export function invitationUnavailable(candidate: { sessionId?: unknown; inviteStatus?: unknown; inviteExpiresAt?: unknown }, now = Date.now()) {
  return !candidate.sessionId && ((candidate.inviteStatus && candidate.inviteStatus !== "active") ||
    (typeof candidate.inviteExpiresAt === "string" && Date.parse(candidate.inviteExpiresAt) <= now));
}
export function invitationResponse(row: Record<string, unknown>, base: string) {
  return { ...row, inviteUrl: row.inviteStatus !== "cancelled" && row.inviteStatus !== "expired" && !invitationUnavailable(row) && typeof row.inviteToken === "string"
    ? `${base.replace(/\/$/, "")}/i/invite/${encodeURIComponent(row.inviteToken)}` : null };
}
