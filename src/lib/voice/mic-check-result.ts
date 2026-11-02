/** Fixed, non-sensitive failure categories; never surface provider messages or transcripts. */
export function micCheckFailureMessage(reason: "capture" | "relay" | "timeout"): string {
  if (reason === "capture") return "The microphone could not start. Check browser microphone permission and your selected input, then retry.";
  if (reason === "relay") return "The voice service could not connect or disconnected. Your microphone has not been verified. Please retry.";
  return "No speech was recognised within 25 seconds. Check your microphone is unmuted and try again.";
}
