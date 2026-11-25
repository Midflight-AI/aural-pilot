import {
    apiError,
    isAuthError,
    validateApiKey,
} from "@/lib/api-key-auth";
import { parseExternalLink } from "@/lib/interview-external-link";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Sets (or clears) the record this interview was made for, e.g. Ramp's REQ-0042. Safe to repeat. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  if (auth.projectIds.length === 0) {
    return apiError("NOT_FOUND", "Interview not found.", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_REQUEST", "Invalid JSON body.", 400);
  }

  const link = parseExternalLink(body);
  if ("error" in link) return apiError("BAD_REQUEST", link.error, 400);

  const { data: updated, error } = await supabaseAdmin
    .from("interviews")
    .update(link)
    .eq("id", id)
    .in("projectId", auth.projectIds)
    .select("id, externalReference, externalUrl")
    .maybeSingle();

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }
  if (!updated) {
    return apiError("NOT_FOUND", "Interview not found.", 404);
  }

  return Response.json({ data: updated });
}
