import { RampSurface } from "@/components/brand/ramp";
export const metadata = { title: { absolute: "Interview | Ramp Remote" }, robots: { index: false, follow: false } };
export default function CandidateLayout({ children }: { children: React.ReactNode }) {
  return <RampSurface>{children}</RampSurface>;
}
