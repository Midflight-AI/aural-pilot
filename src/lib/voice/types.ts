/**
 * Voice types for the interview platform.
 *
 * Browser Web Speech API (SpeechRecognition + SpeechSynthesis) fallback for
 * voice interaction; the LLM response comes from /api/ai/chat.
 */

export interface VoiceSessionConfig {
  sessionId: string;
  interviewTitle: string;
  aiName: string;
  questionCount: number;
}
