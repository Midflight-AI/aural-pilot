import { notFound } from "next/navigation";
import { BackofficePreview } from "./preview";

export const metadata = { title: "Back-office preview", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <BackofficePreview />;
}
