type Turn = { role: string; content: string };
type Scored = { evidence?: unknown } & Record<string, unknown>;

// Short quotes like "yes" or "I think so" prove nothing about an answer.
const MIN_QUOTE_WORDS = 4;

const normalise = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Every word the participant said, normalised so a quote can be matched against it. */
export function participantText(turns: Turn[]): string {
  return ` ${turns.filter((t) => t.role.toLowerCase() === "user").map((t) => normalise(t.content)).join(" ")} `;
}

/** A quote is real only if each part (split on an ellipsis) appears word for word in what the participant said. */
export function isVerbatimQuote(quote: unknown, said: string): quote is string {
  if (typeof quote !== "string") return false;
  const parts = quote.split(/\.\.\.|…/).map(normalise).filter(Boolean);
  const words = parts.join(" ").split(" ").filter(Boolean).length;
  return words >= MIN_QUOTE_WORDS && parts.every((p) => said.includes(` ${p} `));
}

/** Keep a score only when the model backed it with at least one verbatim participant quote; keep only the quotes that check out. */
export function verifiedScores(items: unknown, said: string): Scored[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: Scored) => {
    const evidence = Array.isArray(item?.evidence) ? item.evidence.filter((q) => isVerbatimQuote(q, said)) : [];
    return evidence.length ? [{ ...item, evidence }] : [];
  });
}

/** The report's insights with every unproven score and quote removed. */
export function verifiedInsights(
  parsed: Record<string, unknown>,
  turns: Turn[],
  evidence: { canScore: boolean; supporting: string[] },
): Record<string, unknown> {
  const said = participantText(turns);
  const insights: Record<string, unknown> = {
    keyInsights: [...(Array.isArray(parsed.keyInsights) ? parsed.keyInsights : []), ...evidence.supporting],
  };
  if (evidence.canScore) {
    const criteria = verifiedScores(parsed.criteriaEvaluations, said);
    const questions = verifiedScores(parsed.questionEvaluations, said);
    if (criteria.length) insights.criteriaEvaluations = criteria;
    if (questions.length) insights.questionEvaluations = questions;
  }
  if (parsed.researchFindings) insights.researchFindings = parsed.researchFindings;
  if (parsed.toneAnalysis) insights.toneAnalysis = parsed.toneAnalysis;
  return insights;
}
