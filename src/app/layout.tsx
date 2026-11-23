import { RampSurface } from "@/components/brand/ramp";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
  fallback: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-heading",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://interviews.rampremote.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Ramp Remote - AI Interview Platform | Voice & Video Interviews",
    template: "%s | Ramp Remote",
  },
  description:
    "Ramp Remote is the AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
  keywords: [
    "AI interview platform",
    "voice interview",
    "AI interviews",
    "interview platform",
    "structured interviews",
    "voice interviews",
    "video interviews",
    "AI voice interview",
    "automated interviews",
    "interview automation",
    "candidate assessment",
    "interview analytics",
  ],
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Ramp Remote",
    title: "Ramp Remote - AI Interview Platform | Voice & Video Interviews",
    description:
      "Ramp Remote is the AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
    url: siteUrl,
    images: [
      {
        url: `${siteUrl}/brand/ramp-remote/wordmark-primary.svg`,
        width: 1465,
        height: 291,
        alt: "Ramp Remote AI Interview Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ramp Remote - AI Interview Platform | Voice & Video Interviews",
    description:
      "Ramp Remote is the AI interview platform for structured voice, chat, and video interviews. Automate candidate screening, get real-time insights, and scale your interview process.",
    images: [`${siteUrl}/brand/ramp-remote/wordmark-primary.svg`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className={inter.className}>
        <Providers>
          <RampSurface adaptive>{children}<Toaster /></RampSurface>
        </Providers>
      </body>
    </html>
  );
}
