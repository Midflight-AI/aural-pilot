/** Public invitation scope. An invite never grants access to another session. */
export const CANDIDATE_COOKIE = "aural_candidate_invite";
export type CandidateScope = { inviteToken: string; sessionId: string | null };
export function candidateProcedureAllowed(path: string, input: unknown, scope: CandidateScope | null): boolean {
  if (!scope || !input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  if (path === "candidate.getByToken") return value.token === scope.inviteToken;
  if (path === "session.createFromInvite") return value.inviteToken === scope.inviteToken;
  const sessionProcedures = ["session.getById", "session.sendMessage", "session.saveWhiteboard", "session.deleteWhiteboard", "session.saveCode", "session.deleteCode", "session.updateCurrentQuestion", "session.complete", "session.reportAntiCheatingViolation", "session.saveRecording"];
  return sessionProcedures.includes(path) && Boolean(scope.sessionId) && (path === "session.getById" || path === "session.complete" ? value.id : value.sessionId) === scope.sessionId;
}
