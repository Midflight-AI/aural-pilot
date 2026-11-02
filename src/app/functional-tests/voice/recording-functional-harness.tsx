"use client";
import { useState } from "react";
import { useInterviewRecording } from "@/hooks/use-interview-recording";

// Synthetic sources only. Exercise the encoded mixer output, including a mic
// attached before startup, mute, and a replacement stream after unmute.
export function RecordingFunctionalHarness() {
  const recording = useInterviewRecording({ sessionId: "functional-mixer", enabled: true, captureVisuals: false });
  const [result, setResult] = useState("");
  async function run() {
    const ctx = new AudioContext();
    await ctx.resume();
    const sources: OscillatorNode[] = [];
    const mic = (frequency: number) => {
      const destination = ctx.createMediaStreamDestination();
      const tone = ctx.createOscillator();
      const gain = ctx.createGain(); gain.gain.value = 0.1;
      tone.frequency.value = frequency;
      tone.connect(gain).connect(destination); tone.start(); sources.push(tone);
      return destination.stream;
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      recording.attachMicStream(mic(440));
      await recording.start();
      const recorder = new MediaRecorder(recording.getMixedStream()!, { mimeType: "audio/webm;codecs=opus" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.start();
      const tts = () => {
        const pcm = new Int16Array(24000);
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(2 * Math.PI * 880 * i / 24000) * 3276);
        recording.addTtsChunk(pcm.buffer);
      };
      tts(); timer = setInterval(tts, 1000);
      const wait = () => new Promise(resolve => setTimeout(resolve, 3000));
      await wait();
      recording.attachMicStream(null); // A live former mic must no longer enter the recording.
      await wait();
      recording.attachMicStream(mic(660));
      await wait();
      await new Promise<void>(resolve => { recorder.onstop = () => resolve(); recorder.stop(); });
      const decoded = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const signal = decoded.getChannelData(0);
      const amplitude = (frequency: number, second: number) => {
        const offset = Math.floor(second * decoded.sampleRate);
        const count = Math.floor(decoded.sampleRate / 2);
        let real = 0, imaginary = 0;
        for (let i = 0; i < count; i++) {
          const phase = 2 * Math.PI * frequency * i / decoded.sampleRate;
          real += signal[offset + i] * Math.cos(phase);
          imaginary += signal[offset + i] * Math.sin(phase);
        }
        return 2 * Math.hypot(real, imaginary) / count;
      };
      setResult(JSON.stringify({ beforeStartMic: amplitude(440, 1.5), interviewer: amplitude(880, 1.5), mutedMic: amplitude(440, 4.5), unmutedMic: amplitude(660, 7.5), interviewerAfterUnmute: amplitude(880, 7.5) }));
    } catch (error) { setResult(JSON.stringify({ error: String(error) })); }
    finally { clearInterval(timer); recording.cancelTts(); recording.attachMicStream(null); sources.forEach(source => source.stop()); await ctx.close(); }
  }
  return <><button onClick={() => void run()}>Test recorded voices</button><output data-testid="recorded-voices">{result}</output></>;
}
