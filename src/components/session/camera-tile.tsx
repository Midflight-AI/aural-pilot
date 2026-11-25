"use client";

import { Camera, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The candidate's own camera, mirrored like a mirror, with their mic state on it. */
export function CameraTile({ stream, micOn, alarm, className }: {
  /** Null in the design preview, which shows a placeholder instead. */
  stream: MediaStream | null;
  micOn: boolean;
  /** They're talking while muted: the tile goes red so it can't be missed. */
  alarm: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="webcam-tile"
      className={cn("relative overflow-hidden rounded-2xl bg-neutral-900 shadow-sm", alarm && "ring-4 ring-destructive", className)}
    >
      {stream ? (
        <video
          muted
          playsInline
          autoPlay
          aria-label="Your camera"
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-white/70">
          <Camera className="h-8 w-8" />
          <span>Sample camera</span>
        </div>
      )}
      {alarm && (
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-destructive px-4 py-2.5 text-sm font-bold text-destructive-foreground">
          <MicOff className="h-4 w-4" />
          You&apos;re muted
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
        {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        {micOn ? "You" : "You (muted)"}
      </div>
    </div>
  );
}

/** The loud warning when a candidate talks while muted. */
export function MutedSpeechAlert({ onUnmute }: { onUnmute: () => void }) {
  return (
    <div
      role="alert"
      data-testid="muted-speech-alert"
      className="flex w-full max-w-2xl items-center gap-4 rounded-2xl bg-destructive p-4 text-destructive-foreground shadow-xl"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
        <MicOff className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold md:text-lg">You&apos;re talking, but your mic is muted</p>
        <p className="text-sm opacity-90">We can&apos;t hear you. Unmute to answer.</p>
      </div>
      <Button variant="outline" className="shrink-0 gap-2 border-0 bg-white text-destructive hover:bg-white/90 hover:text-destructive" onClick={onUnmute}>
        <Mic className="h-4 w-4" />
        Unmute
        <kbd className="hidden rounded border border-destructive/40 px-1.5 text-[11px] md:inline">Space</kbd>
      </Button>
    </div>
  );
}
