export const EXTERNAL_REFERENCE_MAX_LENGTH = 40;
export const EXTERNAL_URL_MAX_LENGTH = 500;

export type ExternalLink = { externalReference: string | null; externalUrl: string | null };

/** Reads `{ reference, url }` (both set, or both null to clear) into the interview's columns. */
export function parseExternalLink(body: unknown): ExternalLink | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be an object." };
  const { reference, url } = body as Record<string, unknown>;
  if (reference === null && url === null) return { externalReference: null, externalUrl: null };
  if (typeof reference !== "string" || !reference.trim() || reference.trim().length > EXTERNAL_REFERENCE_MAX_LENGTH) {
    return { error: `reference must be text of 1 to ${EXTERNAL_REFERENCE_MAX_LENGTH} characters, or null with url.` };
  }
  if (typeof url !== "string" || url.length > EXTERNAL_URL_MAX_LENGTH) {
    return { error: `url must be an https URL of at most ${EXTERNAL_URL_MAX_LENGTH} characters, or null with reference.` };
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { error: "url must be an https URL." }; }
  if (parsed.protocol !== "https:") return { error: "url must be an https URL." };
  return { externalReference: reference.trim(), externalUrl: parsed.toString() };
}
