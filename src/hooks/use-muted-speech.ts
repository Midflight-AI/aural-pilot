"use client";

import { useEffect, useState } from "react";
import { QUIET, rmsOf, stepMutedSpeech } from "@/lib/voice/muted-speech";

const SAMPLE_MS = 100;

/**
 * While `watching` (connected and muted), listens to the mic locally and reports whether the
 * candidate is talking. Nothing is recorded or sent: the stream feeds an analyser only and is
 * released as soon as they unmute or the interview ends.
 */
export function useMutedSpeech(watching: boolean) {
  const [talking, setTalking] = useState(false);

  useEffect(() => {
    if (!watching) {
      setTalking(false);
      return;
    }
    let stopped = false;
    let release = () => {};
    void navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((stream) => {
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let state = QUIET;
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        state = stepMutedSpeech(state, rmsOf(samples), performance.now());
        setTalking(state.warning);
      }, SAMPLE_MS);
      release = () => {
        window.clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
      };
    }).catch(() => {
      // Without mic permission there is nothing to watch; the muted state still shows.
    });
    return () => {
      stopped = true;
      release();
      setTalking(false);
    };
  }, [watching]);

  return talking;
}
