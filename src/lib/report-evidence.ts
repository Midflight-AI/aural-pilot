type Question = { id?: string; text: string; source?: string };
type Turn = { questionId?: string | null; role: string; content: string };

// Preserve the full saved transcript. Give the scorer only turns that belong
// to the shared questions. Unknown or unassigned turns cannot add points.
export function reportEvidence<Q extends Question, M extends Turn>(questions: Q[], turns: M[]) {
  if (!questions.some(q => q.source === "invite")) {
    return { questions, turns, supporting: [] as string[] };
  }
  const core = questions.filter(q => q.source !== "invite");
  const ids = new Set(core.map(q => q.id));
  const supporting = questions.filter(q => q.source === "invite").flatMap(q => {
    const answers = turns.filter(m => m.questionId === q.id && m.role.toLowerCase() === "user");
    return answers.length ? [`Supporting evidence — ${q.text}\n${answers.map(m => m.content).join("\n")}`] : [];
  });
  const scored = turns.filter(m => !!m.questionId && ids.has(m.questionId));
  return { questions: core.filter(q => scored.some(m => m.questionId === q.id)), turns: scored, supporting };
}
