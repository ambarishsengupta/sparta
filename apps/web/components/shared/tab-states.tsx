// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Page header, empty, loading and error states for the five tabs (plan 2.2, 5.1).
// Server-safe: no hooks, no handlers. Retry is passed in as a node so the error
// boundary can supply a client button and the preview can supply a link.
import Link from "next/link";

import { ErrorIcon, TAB_ICONS } from "@/components/shared/icons";
import { Tilt } from "@/components/shared/tilt";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import { POP_CLASS, TABS, type TabKey } from "@/lib/tabs";
import { cn } from "@/lib/utils";

export type TabState = "ready" | "empty" | "loading" | "error";

/**
 * Page header: the tab's tint, its textile motif drifting in from the right, the
 * title in Rozha One and a toran hung along the bottom edge. Compact on phones so
 * the first card shows above the fold. Text on tints is ink or ink-soft only.
 */
export function PageHeader({ tab }: { tab: TabKey }) {
  const copy = messages.tabs[tab];
  return (
    <header className="relative overflow-hidden bg-pop-tint">
      <div aria-hidden="true" className="motif-field" />
      <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-9 sm:px-6 sm:pt-8 sm:pb-11 lg:px-10 lg:pt-12 lg:pb-14">
        <h1 className="rise text-3xl lg:text-4xl">{copy.title}</h1>
        <p className="rise mt-2 max-w-[50ch] text-ink-soft [animation-delay:120ms] sm:mt-3 sm:text-lg">
          {copy.intro}
        </p>
      </div>
      <div aria-hidden="true" className="toran" />
    </header>
  );
}

export function TabFrame({ tab, children }: { tab: TabKey; children: React.ReactNode }) {
  return (
    <div className={cn(POP_CLASS[TABS[tab].pop], `motif-${tab}`)}>
      <PageHeader tab={tab} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-10">{children}</div>
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
      className="rise lift flex flex-col items-start gap-5 rounded-tile border border-line bg-surface p-5 shadow-[6px_6px_0_0_var(--pop-tint)] sm:flex-row sm:items-center sm:gap-10 sm:p-8 lg:p-10"
    >
      <JharokhaScene tab={tab} />
      <div className="flex max-w-[65ch] flex-col gap-4">
        <div>
          <h2 id={`${tab}-empty-title`} className="text-2xl">
            {copy.title}
          </h2>
          <p className="mt-2 text-ink-soft">{copy.body}</p>
        </div>
        {/* Actions arrive with their milestones (M2 to M4); they are shown but
            marked unavailable so the layout and focus order can be reviewed now. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button aria-disabled="true" aria-describedby={noteId} className="w-full sm:w-auto">
            {copy.action}
          </Button>
          {secondary ? (
            <Button
              variant="secondary"
              aria-disabled="true"
              aria-describedby={noteId}
              className="w-full sm:w-auto"
            >
              {secondary}
            </Button>
          ) : null}
        </div>
        <p id={noteId} className="text-sm text-ink-mute">
          {messages.preview.unavailable}
        </p>
        {tab === "wardrobe" ? (
          <Link
            href="/wardrobe/popular"
            className="text-sm font-semibold text-accent-text underline underline-offset-4"
          >
            Browse popular items
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Empty-state scene: a jharokha (ogee window arch) with the tab's textile as a
 * lattice, a rangoli that draws itself once, and the tab's object in front.
 * Simple geometry only; decorative, so hidden from assistive technology.
 * Three quarters size on phones to save height; leans toward a mouse pointer.
 */
function JharokhaScene({ tab }: { tab: EmptyTab }) {
  const Icon = TAB_ICONS[tab];
  return (
    <Tilt className="h-[156px] w-[120px] shrink-0 sm:h-52 sm:w-40">
      <div className="relative h-52 w-40 origin-top-left scale-75 sm:scale-100">
        <div className="jharokha absolute inset-0 bg-pop-tint">
          <div className="jharokha-lattice absolute inset-0" />
        </div>
        <Rangoli />
        <div className="absolute inset-x-0 top-[94px] flex justify-center">
          {tab === "wardrobe" ? (
            <HangerScene />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-full border-[1.5px] border-ink bg-surface">
              <Icon className="size-8 text-ink" strokeWidth={1.75} />
            </span>
          )}
        </div>
      </div>
    </Tilt>
  );
}

const PETALS = Array.from({ length: 12 }, (_, i) => i * 30);
const DOTS = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);

function Rangoli() {
  return (
    <svg viewBox="0 0 160 208" className="absolute inset-0 size-full" fill="none">
      <path
        d="M0 208V86C0 46 54 34 80 0C106 34 160 46 160 86V208"
        pathLength={1}
        className="rangoli-line stroke-ink"
        strokeWidth="1.5"
      />
      {PETALS.map((a, i) => (
        <g key={a} className="rangoli-petal" style={{ "--i": i } as React.CSSProperties}>
          <ellipse
            cx="80"
            cy="84"
            rx="6"
            ry="12"
            transform={`rotate(${a} 80 128)`}
            className={i % 2 ? "fill-yellow" : "fill-pop"}
          />
        </g>
      ))}
      <circle
        cx="80"
        cy="128"
        r="56"
        pathLength={1}
        className="rangoli-line stroke-pop"
        strokeWidth="2"
        style={{ "--i": 1 } as React.CSSProperties}
      />
      {DOTS.map((t, i) => (
        <circle
          key={i}
          cx={(80 + 64 * Math.sin(t)).toFixed(2)}
          cy={(128 - 64 * Math.cos(t)).toFixed(2)}
          r="2.4"
          className="rangoli-petal fill-ink"
          style={{ "--i": i + 4 } as React.CSSProperties}
        />
      ))}
    </svg>
  );
}

/** The hanger swings once (plan 4.7). */
function HangerScene() {
  return (
    <svg
      viewBox="0 0 120 96"
      className="h-20 w-25 text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="origin-[60px_8px] animate-hanger-swing">
        <path d="M60 22c0-6 8-6 8-12a8 8 0 0 0-16 0" />
        <path d="M60 22 12 52c-4 3-2 8 3 8h90c5 0 7-5 3-8L60 22Z" className="fill-surface" />
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
    <ul className="rise lift flex max-w-[65ch] flex-col divide-y divide-line rounded-tile border border-line bg-surface shadow-[6px_6px_0_0_var(--pop-tint)]">
      {Object.entries(sections).map(([key, section]) => (
        <li
          key={key}
          className="relative py-4 pr-5 pl-11 before:absolute before:top-[1.4rem] before:left-5 before:size-2.5 before:rotate-45 before:bg-pop"
        >
          <h2 className="font-sans text-base font-semibold">{section.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{section.body}</p>
        </li>
      ))}
    </ul>
  );
}
