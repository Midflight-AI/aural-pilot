/** Max characters sent to speech for coach playback. */
export const COACH_TTS_MAX_CHARS = 360;

/** Normalize punctuation before speech synthesis. */
export function sanitizeTtsText(text: string): string {
  return text
    .trim()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

/** Truncate coach speech at a sentence boundary for reliable TTS synthesis. */
export function truncateForCoachTts(
  text: string,
  maxChars: number = COACH_TTS_MAX_CHARS,
): string {
  const sanitized = sanitizeTtsText(text);
  if (sanitized.length <= maxChars) return sanitized;

  const slice = sanitized.slice(0, maxChars);
  const boundaries = [
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  ];
  const last = Math.max(...boundaries);
  if (last >= Math.floor(maxChars * 0.45)) {
    return slice.slice(0, last + 1).trim();
  }
  return slice.trim();
}

export function prepareCoachTtsText(text: string): string {
  return truncateForCoachTts(sanitizeTtsText(text));
}
