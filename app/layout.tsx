import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { LangProvider } from "@/lib/i18n";
import { ProgressProvider } from "@/lib/progress";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SyncManager } from "@/components/SyncManager";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin", "latin-ext"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin", "latin-ext"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "600"],
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "cubad — Hydrology, step by step",
  description:
    "Interactive step-by-step tutor for the hydrology exam: guided walkthroughs, hints, exam traps, what-if scenarios and quizzes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <LangProvider>
          <ProgressProvider>
            <SyncManager />
            <Header />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
              {children}
            </main>
            <Footer />
          </ProgressProvider>
        </LangProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
