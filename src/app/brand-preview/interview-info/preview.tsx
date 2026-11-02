"use client";

import { useState } from "react";
import { InterviewInfo } from "@/components/session/interview-info";

export function InterviewInfoPreview() {
  const [agreed, setAgreed] = useState(false);
  const [integrity, setIntegrity] = useState(false);
  const [continued, setContinued] = useState(false);
  return <>
    <aside aria-label="Preview controls" className="flex flex-wrap items-center justify-center gap-4 bg-white px-4 py-3 text-sm text-slate-800">
      <span>Design preview · sample interview</span>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={integrity} onChange={e => { setIntegrity(e.target.checked); setAgreed(false); setContinued(false); }} /> Show integrity checks</label>
      {continued && <span role="status">Consent confirmed. Preview stops before device checks.</span>}
    </aside>
    <InterviewInfo interviewTitle="Customer Support Specialist" interviewDescription="Tell us about your experience helping customers, solving problems and working with a remote team." questionCount={8} timeLimitMinutes={20} voiceEnabled antiCheatingEnabled={integrity} needsVisualChecks={integrity} agreed={agreed} onAgreedChange={value => { setAgreed(value); setContinued(false); }} onNext={() => setContinued(true)} />
  </>;
}
