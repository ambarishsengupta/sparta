// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { TabNav } from "@/components/shared/tab-nav";
import { messages } from "@/lib/i18n/messages";

export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-full border-[1.5px] border-ink bg-surface px-5 py-2.5 font-semibold text-ink focus-visible:translate-y-0"
      >
        {messages.shell.skipLink}
      </a>
      <TabNav />
      {/* Bottom padding clears the tab bar; the rail offsets content at 1024 px and over. */}
      <main
        id="main"
        tabIndex={-1}
        className="min-h-dvh pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none lg:pb-0 lg:pl-24"
      >
        {children}
      </main>
    </>
  );
}
