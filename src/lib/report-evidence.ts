type Question = { id?: string; text: string; source?: string };
type Turn = { introductionEndSeconds?: number | null; questionId?: string | null; role: string; content: string };

const spoken = (m: Turn) => m.role.toLowerCase() === "user" && m.content.trim().length > 0;

/** What a report says when the candidate never answered: written here, never by the model. */
export const NO_ANSWERS_SUMMARY = "No answers were recorded. The participant did not respond to any question, so there is nothing to assess.";

/** Whether any candidate answer was saved: without one, no report is generated. */
export function hasCandidateAnswers(turns: Turn[]): boolean {
  return turns.some(m => m.introductionEndSeconds == null && spoken(m));
}

// Preserve the full saved transcript. Give the scorer only turns that belong
// to the shared questions. Unknown or unassigned turns cannot add points.
export function reportEvidence<Q extends Question, M extends Turn>(questions: Q[], messages: M[]) {
  const turns = messages.filter(m => m.introductionEndSeconds == null);
  if (!questions.some(q => q.source === "invite")) {
    return { questions, turns, supporting: [] as string[], canScore: true };
  }
  const core = questions.filter(q => q.source !== "invite");
  const ids = new Set(core.map(q => q.id));
  const supporting = questions.filter(q => q.source === "invite").flatMap(q => {
    const exchange = turns.filter(m => m.questionId === q.id && m.content.trim());
    if (!exchange.some(m => m.role.toLowerCase() === "user")) return [];
    const lines = exchange.map(m => `${m.role.toLowerCase() === "user" ? "Applicant" : "Interviewer"}: ${m.content}`);
    return [`Supporting evidence — ${q.text}\n${lines.join("\n")}`];
  });
  const scored = turns.filter(m => !!m.questionId && ids.has(m.questionId));
  return { questions: core.filter(q => scored.some(m => m.questionId === q.id)), turns: scored, supporting, canScore: scored.some(spoken) };
}

/** Keep the introduction available for playback, outside the transcript consumed by job matching. */
export function interviewSections<M extends { role: unknown; introductionEndSeconds?: number | null }>(messages: M[]) {
  return {
    introduction: messages.filter(m => m.introductionEndSeconds != null),
    messages: messages.filter(m => m.introductionEndSeconds == null),
  };
}
