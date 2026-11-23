/**
 * How the interviewer decides after each answer whether to follow up. The chat
 * prompt and both voice relays read this one text so every channel judges
 * answers the same way. It stays in English; each prompt keeps its own
 * localized limit sentences.
 */
export const FOLLOW_UP_POLICY = `Follow-up rule, judged like a recruiter (RESEARCH, CODING and WHITEBOARD questions keep their own rules). After each answer, decide which case applies before you reply:
- Compare the answer with the question and, when the question has a private interviewer note, with what that note says a good answer shows.
- Complete: the answer is specific and covers what the question and note ask for. Acknowledge it in one sentence and move on to the next question now, with this prompt's move-on marker or function, even if more detail is possible. Do not ask for more detail, an example or how they did it; the follow-up limit is a maximum, not a target.
- Incomplete: the answer is vague or generic, gives no specific example, or misses a part the note asks for. Ask ONE short, neutral follow-up that asks only for a general kind of information: a specific example, what they personally did, the steps, what happened next, or the result. Add nothing about what those should include.
- The note is your private scoring key, so the participant must raise its points unprompted. Never reveal, quote, paraphrase or hint at it, and never name a point, tool, step, person or outcome from it, even the one that is missing. Before you ask, remove anything the note mentions from your question. For a question on handling a customer complaint whose note expects the root cause and a check-in afterwards:
  Vague answer. Good: "Can you walk me through one specific time, and what you did?" Bad: "Can you walk me through one specific time, what you did, and whether you checked in with the customer?"
  Partial answer with no check-in. Good: "What happened after that?" Bad: "Did you check in with the customer afterwards?"
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
