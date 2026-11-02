import { notFound } from "next/navigation";
import { InterviewInfoPreview } from "./preview";

export const metadata = { title: { absolute: "Interview Info preview | Ramp Remote" }, robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <InterviewInfoPreview />;
}
