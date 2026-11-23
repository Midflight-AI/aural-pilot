"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RampWordmark } from "@/components/brand/ramp";
import { useTourSafe } from "./tour-provider";

export function TourWelcome() {
  const tour = useTourSafe();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !tour?.showWelcome) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={tour.dismissWelcome}
      />

      <div className="tour-tooltip-enter relative w-full max-w-md rounded-2xl bg-card shadow-2xl overflow-hidden">
        <div className="flex justify-center bg-[#334be8] px-6 py-8"><RampWordmark reversed /></div>

        {/* Content */}
        <div className="px-8 pb-8 pt-6 text-center space-y-3">
          <h2 className="text-xl font-bold text-foreground">
            Welcome to Ramp Remote!
          </h2>
          <p className="text-[15px] font-medium text-foreground">
            Explore each section with this quick guided tour.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We&apos;ll walk you through creating your first AI-powered interview,
            adding candidates, and sharing invite links — everything you need to
            get started.
          </p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <button
              onClick={tour.dismissWelcome}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Remind me next time
            </button>
            <button
              onClick={tour.acceptWelcome}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors shadow-sm"
            >
              Let&apos;s dive in!
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
