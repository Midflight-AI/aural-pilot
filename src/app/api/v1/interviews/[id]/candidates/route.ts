import { invitationResponse, validIdempotencyKey } from "@/lib/invite-lifecycle";
import { apiCandidateDetailsSchema } from "@/lib/api-feature-schemas";
import { assertInterviewProjectAccess } from "@/app/api/v1/_lib/interview-access";
import {
    apiError,
    isAuthError,
    validateApiKey,
} from "@/lib/api-key-auth";
import { nanoid } from "@/lib/id";
import { supabaseAdmin } from "@/lib/supabase/admin";

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://aural-ai.com";

type CandidateInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
};

function normalizeCandidateInput(raw: unknown): CandidateInput | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as CandidateInput;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { id: interviewId } = await params;

  const access = await assertInterviewProjectAccess(interviewId, auth.projectIds);
  if (access instanceof Response) return access;

  const { data: candidates, error } = await supabaseAdmin
    .from("candidates")
    .select(
      "id, name, email, phone, notes, gender, birthday, education, school, major, graduationYear, workExperience, inviteToken, sessionId, inviteStatus, inviteExpiresAt, inviteVersion, createdAt",
    )
    .eq("interviewId", interviewId)
    .order("createdAt", { ascending: false });

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  return Response.json({ data: (candidates ?? []).map(row => invitationResponse(row, APP_BASE)) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { id: interviewId } = await params;

  const access = await assertInterviewProjectAccess(interviewId, auth.projectIds);
  if (access instanceof Response) return access;

  const key = request.headers.get("Idempotency-Key");
  if (key && (!validIdempotencyKey(key) || process.env.AURAL_INVITE_LIFECYCLE_ENABLED !== "true")) {
    return apiError("BAD_REQUEST", "Idempotent invitation creation is not enabled or key is invalid.", 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const rawItems = Array.isArray(body) ? body : [body];
  if (rawItems.length === 0) {
    return apiError("BAD_REQUEST", "At least one candidate is required", 400);
  }
  if (rawItems.length > 500) {
    return apiError("BAD_REQUEST", "Maximum 500 candidates per request", 400);
  }

  const rows: {
    interviewId: string;
    name: string;
    email: string | null;
    phone: string | null;
    notes: string | null;
    inviteToken: string;
    inviteExpiresAt?: string;
  }[] = [];

  for (const item of rawItems) {
    const c = normalizeCandidateInput(item);
    if (!c) {
      return apiError("BAD_REQUEST", "Each candidate must be an object", 400);
    }

    const name =
      typeof c.name === "string" ? c.name.trim() : "";
    const emailRaw = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    const phone = typeof c.phone === "string" ? c.phone.trim() || null : null;
    const notes = typeof c.notes === "string" ? c.notes.trim() || null : null;

    const details = apiCandidateDetailsSchema.safeParse(item);
    if (!details.success) return apiError("BAD_REQUEST", details.error.issues[0]!.message, 400);
    if (!name) return apiError("BAD_REQUEST", "Candidate name is required.", 400);
    const expiry = (item as Record<string, unknown>).inviteExpiresAt;
    if (expiry !== undefined && (!key || typeof expiry !== "string" || !Number.isFinite(Date.parse(expiry)))) return apiError("BAD_REQUEST", "A valid expiry and idempotency key are required.", 400);
    rows.push({
      ...(typeof expiry === "string" ? { inviteExpiresAt: new Date(expiry).toISOString() } : {}),
      ...details.data,
      interviewId,
      name,
      email: emailRaw || null,
      phone,
      notes,
      inviteToken: nanoid(12),
    });
  }

  if (key) {
    const { data, error } = await supabaseAdmin.rpc("create_api_invites", {
      p_actor: auth.userId, p_interview: interviewId, p_key: key,
      p_rows: rows.map(({ inviteToken: _token, interviewId: _id, ...row }) => { void _token; void _id; return row; }),
    });
    if (error) {
      const code = error.message.includes("IDEMPOTENCY_CONFLICT") ? "IDEMPOTENCY_CONFLICT" : error.message.includes("INVALID_EXPIRY") ? "INVALID_EXPIRY" : "INTERNAL_ERROR";
      return apiError(code, code, code === "IDEMPOTENCY_CONFLICT" ? 409 : code === "INVALID_EXPIRY" ? 400 : 500);
    }
    return Response.json({ data: (data as Record<string, unknown>[]).map(row => invitationResponse(row, APP_BASE)) });
  }

  const { data: created, error } = await supabaseAdmin
    .from("candidates")
    .insert(rows)
    .select(
      "id, name, email, phone, notes, gender, birthday, education, school, major, graduationYear, workExperience, inviteToken, sessionId, inviteStatus, inviteExpiresAt, inviteVersion, createdAt, updatedAt",
    );

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  const data = (created ?? []).map((row) => ({
    ...row,
    inviteUrl: `${APP_BASE.replace(/\/$/, "")}/i/invite/${encodeURIComponent(row.inviteToken as string)}`,
  }));

  return Response.json({ data });
}
