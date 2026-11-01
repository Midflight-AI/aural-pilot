"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { InterviewHeader } from "@/components/brand/ramp";
import { IntervieweeOnboarding } from "@/components/session/interviewee-onboarding";
import { PreparingScreen } from "@/components/session/preparing-screen";
import { SessionEndedScreen } from "@/components/session/session-ended-screen";
import { VideoRecoveryPanel } from "@/components/session/video-recovery";
import { DEFAULT_FOLLOW_UP_DEPTH } from "@/lib/follow-up-depth";
import { Button } from "@/components/ui/button";

const VoiceInterface = dynamic(() => import("@/components/session/voice-interface").then(m => m.VoiceInterface), { ssr: false, loading: () => <PreparingScreen /> });
const ChatInterface = dynamic(() => import("@/components/session/chat-interface").then(m => m.ChatInterface), { ssr: false, loading: () => <PreparingScreen /> });
const screens = ["Information & checks", "Loading", "Voice interview", "Voice & video", "Chat interview", "Upload recovery", "Completed", "Time limit"] as const;
type Screen = typeof screens[number];
const title = "Customer Support Specialist";
const questions = [{ id: "sample-question", text: "Tell me about a time you helped a customer solve a difficult problem.", type: "OPEN_ENDED", order: 0 }];
export function CandidateFlowPreview() {
  const [screen, setScreen] = useState<Screen>("Information & checks");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(true);
  return <>
    <aside className="flex flex-wrap items-center gap-3 border-b bg-white p-4 text-sm" aria-label="Preview controls">
      <strong>Sample interview · design preview</strong>
      <label className="flex items-center gap-2">Screen<select className="min-h-11 rounded-lg border border-input bg-white px-3" value={screen} onChange={e => setScreen(e.target.value as Screen)}>{screens.map(s => <option key={s}>{s}</option>)}</select></label>
      <Link href="/login" className="text-primary underline">Login screen</Link>
      <span className="text-muted-foreground">No interview is saved. Device-check buttons request browser permissions.</span>
    </aside>
    {screen === "Information & checks" && <IntervieweeOnboarding interviewTitle={title} interviewDescription="Tell us about your experience helping customers and working with a remote team." questionCount={8} timeLimitMinutes={20} voiceEnabled videoEnabled chatEnabled onComplete={() => setScreen("Voice interview")} />}
    {screen === "Loading" && <PreparingScreen />}
    {(screen === "Voice interview" || screen === "Voice & video") && <VoiceInterface sessionId="__preview__" interviewId="__preview__" interviewTitle={title} aiName="AI Interviewer" questionCount={1} interviewContext={{ title, aiName: "AI Interviewer", aiTone: "professional", language: "en-US", followUpDepth: DEFAULT_FOLLOW_UP_DEPTH, questions }} chatEnabled preview previewWebcam={screen === "Voice & video"} />}
    {screen === "Chat interview" && <ChatInterface sessionId="__preview__" interview={{id:"__preview__", title, aiName:"AI Interviewer", mode:"CHAT", questions}} preview initialMessages={[{id:"sample-message",role:"ASSISTANT",content:questions[0].text,timestamp:"2026-11-01T00:00:00Z"}]} onComplete={() => {}} />}
    {screen === "Upload recovery" && <><InterviewHeader /><VideoRecoveryPanel uploading={uploading} error={uploadError ? "Upload paused. Retrying automatically when connected. Keep this browser data." : ""} onRetry={() => {setUploading(true);setUploadError(false);}} /><div className="mx-auto mt-4 max-w-2xl px-4"><Button variant="outline" onClick={() => {setUploading(false);setUploadError(true);}}>Simulate interrupted upload</Button><p className="mt-2 text-sm text-muted-foreground">Sample states only; this preview uploads no video.</p></div></>}
    {screen === "Completed" && <SessionEndedScreen />}
    {screen === "Time limit" && <SessionEndedScreen reason="INTERVIEW_TIME_LIMIT_REACHED" />}
  </>;
}
