const BROWSER_PLAYABLE_TTS_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
]);

/** Whether an HTMLAudioElement can play the container returned by the speech route. */
export function isBrowserPlayableTtsContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return BROWSER_PLAYABLE_TTS_CONTENT_TYPES.has(mediaType);
}
