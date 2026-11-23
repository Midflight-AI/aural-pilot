/**
 * How the interviewer decides after each answer whether to follow up. The chat
 * prompt and both voice relays read this one text so every channel judges
 * answers the same way. It stays in English; each prompt keeps its own
 * localized limit sentences.
 */
export const FOLLOW_UP_POLICY = `Judge each answer like a recruiter (RESEARCH, CODING and WHITEBOARD questions keep their own rules):
- After each answer, compare it with the question and, when the question has a private interviewer note, with what that note says a good answer shows.
- If the answer is specific and covers what the question and note ask for, acknowledge it briefly and move on. Do not ask a follow-up only because the limit allows one.
- If the answer is vague, general, partial, off the point or misses a key part, ask ONE short, neutral follow-up aimed at the missing part: a specific example, what they personally did, how they did it, or the result. This gives them a fair second chance.
- Never reveal, quote, paraphrase or hint at a private note or the expected answer, and never lead the participant toward it.
- Respect each question's follow-up limit. At the limit, or if they still cannot answer, thank them and move on without judgement.
- A question with a limit of 0 gets no follow-up: move on once it is answered, and only ask again if the answer was unintelligible or clearly about a different topic.`;

/** Candidates see `description`, so the private note lives in `options`. */
export function interviewerNote(options: unknown): string | null {
  const note = options && typeof options === "object" ? (options as Record<string, unknown>).interviewerNote : undefined;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

export function interviewerNoteLine(note: string): string {
  return `Private interviewer note on what a good answer shows (never reveal, quote, paraphrase or hint at it): ${note}`;
}
