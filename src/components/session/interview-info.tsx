"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import styles from "./interview-info.module.css";

export interface InterviewInfoProps {
  interviewTitle: string;
  interviewDescription?: string | null;
  questionCount: number;
  timeLimitMinutes?: number | null;
  antiCheatingEnabled?: boolean;
  needsVisualChecks?: boolean;
  voiceEnabled?: boolean;
  agreed: boolean;
  onAgreedChange: (value: boolean) => void;
  onNext: () => void;
}

/** Shared by real onboarding and the data-free branding preview. */
export function InterviewInfo({ interviewTitle, interviewDescription, questionCount,
  timeLimitMinutes, antiCheatingEnabled, needsVisualChecks, voiceEnabled,
  agreed, onAgreedChange, onNext }: InterviewInfoProps) {
  return (
      <div className={styles.surface}>
        <header className={styles.header}>
          <Image src="/brand/ramp-remote/wordmark-reversed.svg" width={1465} height={291} alt="Ramp Remote" priority className={styles.logo} />
          <span>Interviews</span>
        </header>
        <nav aria-label="Interview progress" className={styles.steps}>
          <ol>{["Interview Info", "Checklist", "Start"].map((label, index) => (
            <li key={label} aria-current={index === 0 ? "step" : undefined}>
              <span aria-hidden="true">{index + 1}</span>{label}
            </li>
          ))}</ol>
        </nav>
        <main className={styles.content}>
          <Card className={styles.panel}>
            <CardContent className="p-4 sm:p-6">
              <h1 className={styles.title}>{interviewTitle}</h1>

              <div className="mt-4 flex gap-6 text-sm">
                <div>
                  <span className="font-medium">Description</span>
                  <p className="mt-1 text-muted-foreground">
                    {interviewDescription || "No additional description."}
                  </p>
                </div>
              </div>

              <div className="mt-2 text-sm text-muted-foreground">
                {questionCount} questions &middot;{" "}
                {timeLimitMinutes
                  ? `${timeLimitMinutes} min`
                  : "No time limit"}
              </div>
            </CardContent>
          </Card>

          <Card className={`${styles.panel} mt-4`}>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <h3 className="font-semibold">Integrity Notices</h3>
              {antiCheatingEnabled ? (
                <>
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    To ensure fairness, the following integrity measures will be
                    actively enforced throughout this session.
                  </div>
                  <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                    <li>
                      To ensure that the interview runs properly, please use the
                      latest version of Chrome.
                    </li>
                    <li>
                      After completing your answers, please make sure that you have
                      submitted them to all questions. Otherwise it will affect your
                      results.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Tab switching and focus tracking:</span>{" "}
                      Leaving the interview page or switching to another window will
                      be automatically detected and recorded. If you leave more
                      than{" "}
                      <span className="font-medium text-primary">3</span> times,
                      your session will be flagged for review.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">External paste blocked:</span>{" "}
                      Pasting content from outside the interview page is not
                      allowed. You can copy and paste freely within the page.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Multiple screen detection:</span>{" "}
                      The system will detect if you have multiple monitors connected.
                      Please unplug or turn off additional screens before starting.
                    </li>
                    <li>
                      This interview requires a camera to collect your registration
                      photo and capture your behavior. All photos are privacy
                      protected.
                    </li>
                    <li>
                      The interview will screen capture throughout. Screen capture
                      requires authorization.
                    </li>
                  </ol>
                </>
              ) : (
                <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                  <li>
                    To ensure that the interview runs properly, please use the
                    latest version of Chrome.
                  </li>
                  <li>
                    After completing your answers, please make sure that you have
                    submitted them to all questions. Otherwise it will affect your
                    results.
                  </li>
                  <li>
                    Before the interview starts, please shut down any software or
                    web page with ads, message pop-ups. Please do not leave the
                    interview page during the whole process.
                  </li>
                  {needsVisualChecks && <>
                    <li>This interview uses camera snapshots and screen capture, which require authorization.</li>
                  </>}
                  {voiceEnabled && <li>This interview records audio for transcription and review. Microphone access is required.</li>}
                </ol>
              )}
            </CardContent>
          </Card>

          <div className={styles.actions}>
            <label className={styles.consent}>
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => onAgreedChange(v === true)}
              />
              I agree to the above notice and interview guidelines
            </label>
            <Button
              disabled={!agreed}
              onClick={onNext}
              className={styles.next}
            >
              Next
            </Button>
          </div>
        </main>
      </div>
  );
}
