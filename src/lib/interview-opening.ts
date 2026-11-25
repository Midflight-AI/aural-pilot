/** Merge fields an interview's opening may use. Anything else in double braces is spoken as written. */
export const OPENING_FIELDS = ["first_name", "role", "interviewer", "question_count"] as const;
export const OPENING_MAX_LENGTH = 600;

export type OpeningValues = { participantName?: string | null; title: string; aiName: string; questionCount: number };

/** The opening as the interviewer should say it to this participant; null when the interview has none. */
export function renderOpening(template: string | null | undefined, values: OpeningValues): string | null {
  const text = template?.trim();
  if (!text) return null;
  // Without a name the greeting still reads naturally: "Hi there".
  const firstName = values.participantName?.trim().split(/\s+/)[0] || "there";
  const fields: Record<(typeof OPENING_FIELDS)[number], string> = {
    first_name: firstName,
    role: values.title,
    interviewer: values.aiName,
    question_count: String(values.questionCount),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in fields ? fields[name as keyof typeof fields] : match));
}
