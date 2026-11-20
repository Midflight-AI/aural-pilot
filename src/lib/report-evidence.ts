type Question = { id?: string; text: string; source?: string };
type Turn = { questionId?: string | null; role: string; content: string };

// Preserve the full saved transcript. Give the scorer only turns that belong
// to the shared questions. Unknown or unassigned turns cannot add points.
export function reportEvidence<Q extends Question, M extends Turn>(questions: Q[], turns: M[]) {
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
  return { questions: core.filter(q => scored.some(m => m.questionId === q.id)), turns: scored, supporting, canScore: scored.some(m => m.role.toLowerCase() === "user" && m.content.trim()) };
}
