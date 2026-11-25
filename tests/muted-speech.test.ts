import assert from "node:assert/strict";
import test from "node:test";

import { MUTED_SPEECH_HOLD_MS, QUIET, rmsOf, stepMutedSpeech, type MutedSpeechState } from "../src/lib/voice/muted-speech";

const run = (readings: Array<[number, number]>, start: MutedSpeechState = QUIET) =>
  readings.reduce((state, [rms, at]) => stepMutedSpeech(state, rms, at), start);

test("a cough or a door bang doesn't warn", () => {
  assert.equal(run([[0.2, 0], [0.2, 100], [0, 200], [0, 800]]).warning, false);
});

test("talking for half a second warns, even with gaps between words", () => {
  assert.equal(run([[0.05, 0], [0.05, 100], [0.01, 200], [0.05, 300], [0.05, 400], [0.05, 500]]).warning, true);
});

test("a long pause restarts the count", () => {
  assert.equal(run([[0.05, 0], [0.05, 200], [0, 300], [0, 900], [0.05, 1000], [0.05, 1200]]).warning, false);
});

test("the warning holds through a short pause and clears after a few seconds of quiet", () => {
  const warned = run([0, 100, 200, 300, 400, 500].map((at) => [0.05, at] as [number, number]));
  assert.equal(warned.warning, true);
  assert.equal(stepMutedSpeech(warned, 0, 2_000).warning, true);
  assert.equal(stepMutedSpeech(warned, 0, 500 + MUTED_SPEECH_HOLD_MS).warning, false);
});

test("background hum below the threshold never warns", () => {
  assert.equal(run(Array.from({ length: 50 }, (_, i) => [0.01, i * 100] as [number, number])).warning, false);
});

test("rms of a buffer", () => {
  assert.equal(rmsOf(new Float32Array([0.5, -0.5])), 0.5);
  assert.equal(rmsOf(new Float32Array([])), 0);
});
