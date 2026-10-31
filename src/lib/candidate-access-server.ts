import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CandidateScope } from "./candidate-access";
export async function candidateScope(token: string | undefined | null): Promise<CandidateScope | null> {
  if (!token || !/^[A-Za-z0-9_-]{12,128}$/.test(token)) return null;
  const { data, error } = await supabaseAdmin.from("candidates").select("*").eq("inviteToken", token).maybeSingle();
  if (error || !data || (data.inviteStatus && data.inviteStatus !== "active")) return null;
  // Allocated sessions retain upload recovery access; expiry governs starting a new one.
  if (!data.sessionId && data.inviteExpiresAt && Date.parse(data.inviteExpiresAt) <= Date.now()) return null;
  return { inviteToken: token, sessionId: data.sessionId ?? null };
}
