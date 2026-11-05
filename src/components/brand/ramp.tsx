"use client";

import { createContext, useContext, type ReactNode } from "react";
import Image from "next/image";
import "./ramp.css";

const RampContext = createContext(false);
export function useRampBrand() { return useContext(RampContext); }
export function RampSurface({ children, adaptive = false }: { children: ReactNode; adaptive?: boolean }) {
  return <RampContext.Provider value={!adaptive}><div data-ramp-surface="" data-ramp-theme={adaptive ? "adaptive" : "light"} className="ramp-surface">{children}</div></RampContext.Provider>;
}
export function RampWordmark({ reversed = false }: { reversed?: boolean }) {
  return <Image src={`/brand/ramp-remote/wordmark-${reversed ? "reversed" : "primary"}.svg`} width={1465} height={291} alt="Ramp Remote" priority className="ramp-wordmark" />;
}
/** Candidate-only headers remain optional for embedded interview views. */
export function InterviewHeader({ candidateOnly = false }: { candidateOnly?: boolean }) {
  const ramp = useContext(RampContext);
  if (!ramp && candidateOnly) return null;
  return <header className="ramp-header"><RampWordmark reversed /><span>Interviews</span></header>;
}

/** Both variants use the approved artwork; CSS follows the active theme. */
export function RampAdaptiveWordmark() {
  return <span className="ramp-adaptive-wordmark"><span className="ramp-logo-light"><RampWordmark /></span><span className="ramp-logo-dark"><RampWordmark reversed /></span></span>;
}
