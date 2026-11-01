import { notFound } from "next/navigation";
import { RampSurface } from "@/components/brand/ramp";
export const metadata = { title: { absolute: "Candidate flow preview | Ramp Remote" }, robots: { index: false, follow: false } };
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <RampSurface>{children}</RampSurface>;
}
