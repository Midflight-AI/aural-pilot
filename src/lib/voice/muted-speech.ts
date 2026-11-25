/**
 * Spots a candidate talking while their mic is muted, from local level readings only.
 * Speech has short gaps between words, so a run of loud readings survives a brief dip;
 * the warning holds until a few seconds of quiet so it doesn't flicker mid-sentence.
 */
export const MUTED_SPEECH_RMS = 0.03;
export const MUTED_SPEECH_MS = 400;
export const MUTED_SPEECH_GAP_MS = 350;
export const MUTED_SPEECH_HOLD_MS = 5_000;

export type MutedSpeechState = { loudSince: number | null; lastLoudAt: number | null; warning: boolean };
export const QUIET: MutedSpeechState = { loudSince: null, lastLoudAt: null, warning: false };

export function stepMutedSpeech(state: MutedSpeechState, rms: number, now: number): MutedSpeechState {
  if (rms >= MUTED_SPEECH_RMS) {
    const loudSince = state.loudSince !== null && state.lastLoudAt !== null && now - state.lastLoudAt <= MUTED_SPEECH_GAP_MS ? state.loudSince : now;
    return { loudSince, lastLoudAt: now, warning: state.warning || now - loudSince >= MUTED_SPEECH_MS };
  }
  const quietFor = state.lastLoudAt === null ? Infinity : now - state.lastLoudAt;
  return {
    loudSince: quietFor > MUTED_SPEECH_GAP_MS ? null : state.loudSince,
    lastLoudAt: state.lastLoudAt,
    warning: state.warning && quietFor < MUTED_SPEECH_HOLD_MS,
  };
}

export function rmsOf(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
