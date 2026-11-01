import { InterviewHeader, RampSurface } from "@/components/brand/ramp";
export const metadata = { title: { default: "Sign in | Ramp Remote", template: "%s | Ramp Remote" }, robots: { index: false, follow: false } };
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <RampSurface><InterviewHeader /><main className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-12"><div className="w-full max-w-md">{children}</div></main></RampSurface>;
}
