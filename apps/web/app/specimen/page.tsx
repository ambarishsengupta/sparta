// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Component specimen: button states and every colour token rendered in the
// browser, so axe measures real pixels (plan 4.4 method B). Not in the tab bar.
import type { Metadata } from "next";

import { LoadingDemo } from "@/app/specimen/loading-demo";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: messages.specimen.title,
  robots: { index: false, follow: false },
};

const copy = messages.specimen;

const FLASH = [
  { name: "Electric Tangerine", fill: "bg-tangerine text-on-tangerine", tint: "bg-tangerine-tint" },
  { name: "Hot Pink", fill: "bg-pink text-on-pink", tint: "bg-pink-tint" },
  { name: "Acid Lime", fill: "bg-lime text-on-lime", tint: "bg-lime-tint" },
  { name: "Electric Cyan", fill: "bg-cyan text-on-cyan", tint: "bg-cyan-tint" },
  { name: "Sun Yellow", fill: "bg-yellow text-on-yellow", tint: "bg-yellow-tint" },
  { name: "Electric Cobalt", fill: "bg-cobalt text-on-cobalt", tint: "bg-cobalt-tint" },
] as const;

// Garment-tinted tiles: color-mix(in oklab, <item colour> 14%, canvas) (plan 4.3).
// The darkest and lightest garments are the worst cases for ink and ink-soft.
const GARMENTS = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#ffffff" },
  { name: "Navy", hex: "#1f2a44" },
  { name: "Maroon", hex: "#800020" },
  { name: "Olive", hex: "#708238" },
  { name: "Yellow", hex: "#ffff00" },
  { name: "Blue", hex: "#0000ff" },
  { name: "Neon green", hex: "#39ff14" },
] as const;

export default function SpecimenPage() {
  return (
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-6 lg:px-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-2 max-w-[65ch] text-ink-soft">{copy.intro}</p>
      </header>

      <section aria-labelledby="buttons" className="flex flex-col gap-6">
        <h2 id="buttons" className="text-xl font-bold">
          {copy.buttons}
        </h2>
        <div className="flex flex-wrap items-center gap-3" data-testid="button-row">
          <Button data-testid="btn-primary">{copy.rest}</Button>
          <Button variant="secondary" data-testid="btn-secondary">
            {copy.secondary}
          </Button>
          <Button variant="ghost" data-testid="btn-ghost">
            {copy.ghost}
          </Button>
          <Button disabled data-testid="btn-disabled">
            {copy.disabled}
          </Button>
          <Button aria-disabled="true" data-testid="btn-aria-disabled">
            {copy.disabled}
          </Button>
          <Button loading data-testid="btn-loading">
            {copy.loading}
          </Button>
          <Button size="sm">{copy.rest}</Button>
        </div>
        <LoadingDemo />
      </section>

      <section aria-labelledby="tokens" className="flex flex-col gap-6">
        <h2 id="tokens" className="text-xl font-bold">
          {copy.tokens}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLASH.map((f) => (
            <li key={f.name} className="overflow-hidden rounded-tile border border-line bg-surface">
              <div
                className={cn("border-b-[1.5px] border-flash-edge px-4 py-3 font-semibold", f.fill)}
              >
                {f.name}
              </div>
              <div className={cn("px-4 py-3", f.tint)}>
                <p className="font-semibold text-ink">Ink on tint</p>
                <p className="text-sm text-ink-soft">Ink soft on tint</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-3 rounded-tile border border-line bg-surface p-4 sm:grid-cols-2">
          <p className="text-ink">Ink on surface</p>
          <p className="text-ink-soft">Ink soft on surface</p>
          <p className="text-ink-mute">Ink mute on surface, hints only</p>
          <a href="#tokens" className="text-accent-text underline underline-offset-4">
            Accent text link
          </a>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GARMENTS.map((g) => (
            <li
              key={g.name}
              className="rounded-tile p-4"
              style={{ background: `color-mix(in oklab, ${g.hex} 14%, var(--canvas))` }}
            >
              <span
                aria-hidden="true"
                className="mb-3 block size-5 rounded-full ring-[1.5px] ring-ink"
                style={{ background: g.hex }}
              />
              <p className="font-semibold text-ink">{g.name}</p>
              <p className="text-sm text-ink-soft">Example tile</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
