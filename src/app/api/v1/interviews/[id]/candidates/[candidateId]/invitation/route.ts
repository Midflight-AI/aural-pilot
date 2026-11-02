import { apiError, isAuthError, validateApiKey } from "@/lib/api-key-auth";
import { assertInterviewProjectAccess } from "@/app/api/v1/_lib/interview-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOrgMembership, getEffectiveProjectRole, hasMinRole } from "@/server/trpc";
import { invitationActionSchema, invitationResponse, validIdempotencyKey } from "@/lib/invite-lifecycle";

type Context = { params: Promise<{ id: string; candidateId: string }> };
export async function POST(request: Request, { params }: Context) {
  if (process.env.AURAL_INVITE_LIFECYCLE_ENABLED !== "true") return apiError("NOT_ENABLED", "Invitation controls are not enabled.", 404);
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;
  const { id, candidateId } = await params;
  const access = await assertInterviewProjectAccess(id, auth.projectIds);
  if (access instanceof Response) return access;
  const membership = await getOrgMembership(supabaseAdmin, auth.organizationId, auth.userId);
  if (!membership || !hasMinRole(await getEffectiveProjectRole(supabaseAdmin, access.projectId, auth.userId, membership.role), "MEMBER")) return apiError("FORBIDDEN", "MEMBER role or higher required.", 403);
  const key = request.headers.get("Idempotency-Key");
  if (!validIdempotencyKey(key)) return apiError("BAD_REQUEST", "A valid Idempotency-Key is required.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("BAD_REQUEST", "Invalid JSON.", 400); }
  const parsed = invitationActionSchema.safeParse(body);
  if (!parsed.success) return apiError("BAD_REQUEST", parsed.error.issues[0]!.message, 400);
  const { data, error } = await supabaseAdmin.rpc("change_api_invite", { p_actor: auth.userId, p_interview: id, p_candidate: candidateId, p_key: key, p_request: parsed.data });
  if (error) {
    const known = ["IDEMPOTENCY_CONFLICT", "INVITE_VERSION_CONFLICT", "INTERVIEW_ALREADY_STARTED", "INVITE_NOT_FOUND", "INVALID_EXPIRY"];
    const code = known.find(c => error.message.includes(c));
    return apiError(code ?? "INTERNAL_ERROR", code ?? "Invitation update failed.", code === "INVITE_NOT_FOUND" ? 404 : code === "INVALID_EXPIRY" ? 400 : code ? 409 : 500);
  }
  return Response.json({ data: invitationResponse(data, process.env.NEXT_PUBLIC_APP_URL ?? "https://aural-ai.com") });
}
