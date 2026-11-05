// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Page header, empty, loading and error states for the five tabs (plan 2.2, 5.1).
// Server-safe: no hooks, no handlers. Retry is passed in as a node so the error
// boundary can supply a client button and the preview can supply a link.
import Link from "next/link";

import { ErrorIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import { POP_CLASS, TABS, type TabKey } from "@/lib/tabs";
import { cn } from "@/lib/utils";

export type TabState = "ready" | "empty" | "loading" | "error";

/** Light header wash in the tab's own tint. Text on tints is ink or ink-soft only. */
export function PageHeader({ tab }: { tab: TabKey }) {
  const copy = messages.tabs[tab];
  return (
    <header className="bg-pop-tint">
      <div className="mx-auto max-w-5xl px-4 pt-8 pb-6 sm:px-6 lg:px-10 lg:pt-12">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{copy.title}</h1>
        <p className="mt-2 max-w-[65ch] text-ink-soft">{copy.intro}</p>
      </div>
    </header>
  );
}

export function TabFrame({ tab, children }: { tab: TabKey; children: React.ReactNode }) {
  return (
    <div className={POP_CLASS[TABS[tab].pop]}>
      <PageHeader tab={tab} />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10">{children}</div>
    </div>
  );
}

/* ---------- Empty ---------- */

type EmptyTab = Exclude<TabKey, "me">;

export function EmptyState({ tab }: { tab: EmptyTab }) {
  const copy = messages.tabs[tab].empty;
  const noteId = `${tab}-empty-note`;
  const secondary = "secondaryAction" in copy ? copy.secondaryAction : null;
  return (
    <section
      aria-labelledby={`${tab}-empty-title`}
      className="flex flex-col items-start gap-6 rounded-tile border border-line bg-surface p-6 sm:flex-row sm:items-center sm:p-8"
    >
      {tab === "wardrobe" ? <HangerScene /> : null}
      <div className="flex max-w-[65ch] flex-col gap-4">
        <div>
          <h2 id={`${tab}-empty-title`} className="text-xl font-bold">
            {copy.title}
          </h2>
          <p className="mt-2 text-ink-soft">{copy.body}</p>
        </div>
        {/* Actions arrive with their milestones (M2 to M4); they are shown but
            marked unavailable so the layout and focus order can be reviewed now. */}
        <div className="flex flex-wrap gap-3">
          <Button aria-disabled="true" aria-describedby={noteId}>
            {copy.action}
          </Button>
          {secondary ? (
            <Button variant="secondary" aria-disabled="true" aria-describedby={noteId}>
              {secondary}
            </Button>
          ) : null}
        </div>
        <p id={noteId} className="text-sm text-ink-mute">
          {messages.preview.unavailable}
        </p>
      </div>
    </section>
  );
}

/** One-time scene: a hanger swings once (plan 4.7). The only custom SVG allowed. */
function HangerScene() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 96"
      className="h-24 w-30 shrink-0 text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="origin-[60px_8px] animate-hanger-swing">
        <path d="M60 22c0-6 8-6 8-12a8 8 0 0 0-16 0" />
        <path d="M60 22 12 52c-4 3-2 8 3 8h90c5 0 7-5 3-8L60 22Z" className="fill-tangerine-tint" />
        <circle cx="60" cy="74" r="10" className="fill-tangerine" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/* ---------- Loading ---------- */

/** Skeletons in the shape of the result, washed in the tab tint (plan 2.2, 4.7). */
export function TabSkeleton({ tab }: { tab: TabKey }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{messages.tabs[tab].loading}</span>
      <div aria-hidden="true">{SKELETONS[tab]}</div>
    </div>
  );
}

function Block({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-tile bg-pop-tint",
        // Shimmer moves with transform only; it is hidden under reduced motion.
        "after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-surface/60 after:to-transparent motion-reduce:after:hidden",
        className,
      )}
    />
  );
}

function Rows({ count, strip = false }: { count: number; strip?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {strip ? <Block className="h-16" /> : null}
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className="h-16" />
      ))}
    </div>
  );
}

const SKELETONS: Record<TabKey, React.ReactNode> = {
  // The grid shape of a 40-item page (LLD 9.2); 12 tiles fill the first screen.
  wardrobe: (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, i) => (
        <Block key={i} className="aspect-[3/4]" />
      ))}
    </div>
  ),
  outfits: (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Block key={i} className="h-64" />
      ))}
    </div>
  ),
  wishlist: <Rows count={6} />,
  purchases: <Rows count={6} strip />,
  me: (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Block className="h-6 w-40 rounded-full" />
          <Block className="h-20" />
          <Block className="h-20" />
        </div>
      ))}
    </div>
  ),
};

/* ---------- Error ---------- */

/** Inline error: accent text plus an icon plus words, never colour alone (plan 4.3). */
export function ErrorState({ tab, retry }: { tab: TabKey; retry: React.ReactNode }) {
  const copy = messages.tabs[tab].error;
  return (
    <section
      aria-labelledby={`${tab}-error-title`}
      className="flex max-w-[65ch] flex-col gap-4 rounded-tile border border-line bg-surface p-6"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-accent-text">
        <ErrorIcon aria-hidden="true" className="size-5" strokeWidth={2} />
        {messages.states.errorLabel}
      </p>
      <div>
        <h2 id={`${tab}-error-title`} className="text-xl font-bold">
          {copy.title}
        </h2>
        <p className="mt-2 text-ink-soft">{copy.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {retry}
        {tab === "outfits" ? (
          <>
            <Button asChild variant="secondary">
              <Link href="/wardrobe">{messages.tabs.outfits.error.linkWardrobe}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/wishlist">{messages.tabs.outfits.error.linkWishlist}</Link>
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- Me (settings list, no empty state) ---------- */

export function SettingsList() {
  const sections = messages.tabs.me.sections;
  return (
    <ul className="flex max-w-[65ch] flex-col divide-y divide-line rounded-tile border border-line bg-surface">
      {Object.entries(sections).map(([key, section]) => (
        <li key={key} className="px-5 py-4">
          <h2 className="font-sans text-base font-semibold">{section.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{section.body}</p>
        </li>
      ))}
    </ul>
  );
}
