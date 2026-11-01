"use client";

import { createContext, useContext, type ReactNode } from "react";
import Image from "next/image";
import { AuralLogo } from "@/components/ui/aural-logo";
import "./ramp.css";

const RampContext = createContext(false);
export function useRampBrand() { return useContext(RampContext); }
export function RampSurface({ children }: { children: ReactNode }) {
  return <RampContext.Provider value={true}><div data-ramp-surface="" className="ramp-surface">{children}</div></RampContext.Provider>;
}
export function RampWordmark({ reversed = false }: { reversed?: boolean }) {
  return <Image src={`/brand/ramp-remote/wordmark-${reversed ? "reversed" : "primary"}.svg`} width={1465} height={291} alt="Ramp Remote" priority className="ramp-wordmark" />;
}
/** Shared session components retain their existing brand outside candidate routes. */
export function InterviewHeader({ candidateOnly = false }: { candidateOnly?: boolean }) {
  const ramp = useContext(RampContext);
  if (!ramp && candidateOnly) return null;
  if (ramp) return <header className="ramp-header"><RampWordmark reversed /><span>Interviews</span></header>;
  return <header className="sticky top-0 z-50 flex h-14 items-center border-b bg-card px-4 sm:px-6"><div className="flex items-center gap-1"><AuralLogo size={28} /><span className="font-heading text-base font-bold tracking-[2px]">AURAL</span></div></header>;
}
