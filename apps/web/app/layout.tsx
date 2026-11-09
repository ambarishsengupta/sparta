// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Rozha_One } from "next/font/google";

import { messages } from "@/lib/i18n/messages";
import "./globals.css";

// next/font downloads these at build time and serves them from this app, so
// visitors make no request to Google (plan 4.5). All three are SIL OFL 1.1.
// Rozha One (display) is by the Indian Type Foundry and carries Devanagari,
// ready for a Hindi locale.
const rozha = Rozha_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-rozha",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: messages.app.name, template: `%s · ${messages.app.name}` },
  description: messages.app.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff5ed" },
    { media: "(prefers-color-scheme: dark)", color: "#231f36" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${rozha.variable} ${instrumentSans.variable} ${geistMono.variable}`}
    >
      <head>
        {/* Applies the stored theme and motion choice before first paint (theme-toggle.tsx, motion-toggle.tsx). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var d=document.documentElement,t=localStorage.getItem("sparta-theme"),m=localStorage.getItem("sparta-motion");if(t==="light"||t==="dark")d.dataset.theme=t;if(m==="calm")d.dataset.motion="calm"}catch(e){}',
          }}
        />
      </head>
      <body className="artful-ground">{children}</body>
    </html>
  );
}
