// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Sample content for Wardrobe, Outfits, Wishlist and Purchases (lib/sample.ts), so
// every tab has something to look at and touch in the demo. Each screen opens with
// a note saying the data is sample data and a link to the real empty screen.
// Wardrobe also shows items picked on "popular items" this visit (lib/picks.ts).
import Link from "next/link";

import { ComingSoon } from "@/components/shared/coming-soon";
import { Button } from "@/components/ui/button";
import { type CatalogueItem, rupees, SAMPLE } from "@/lib/catalogue";
import { messages } from "@/lib/i18n/messages";
import { usePicks } from "@/lib/picks";
import { item, OUTFITS, OWNED, PURCHASES, WISHLIST } from "@/lib/sample";
import type { TabKey } from "@/lib/tabs";
import { cn } from "@/lib/utils";

const copy = messages.sample;
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

const tint = (i: CatalogueItem, pct = 14) =>
  `color-mix(in oklab, ${i.colour} ${pct}%, var(--surface))`;

/** Placeholder picture: the item's colour as a soft shape on its tinted ground. */
function Swatch({ item: i, className }: { item: CatalogueItem; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-tile", className)}
      style={{ background: tint(i) }}
    >
      <span
        className="absolute inset-0 m-auto size-2/5 rounded-full"
        style={{ background: i.colour, opacity: 0.85 }}
      />
    </div>
  );
}

function SampleNote({ tab }: { tab: Exclude<TabKey, "me"> }) {
  return (
    <p className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink-soft">
      <span>{copy.note}</span>
      <Link
        href={`/${tab}?state=empty`}
        className="font-semibold text-accent-text underline underline-offset-4"
      >
        {copy.showEmpty}
      </Link>
    </p>
  );
}

/* ---------- Wardrobe ---------- */

export function WardrobeSample() {
  const picks = usePicks();
  const owned = OWNED.map((o) => ({ item: item(o.id), worn: o.worn, fresh: false }));
  const added = picks
    .filter((id) => !OWNED.some((o) => o.id === id))
    .map((id) => SAMPLE.find((s) => s.id === id))
    .filter((i): i is CatalogueItem => Boolean(i))
    .map((i) => ({ item: i, worn: 0, fresh: true }));
  const all = [...added, ...owned];

  return (
    <>
      <SampleNote tab="wardrobe" />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">{fill(copy.wardrobe.count, { n: all.length })}</h2>
        <Button asChild size="sm">
          <Link href="/wardrobe/popular">{copy.wardrobe.add}</Link>
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5">
        {all.map(({ item: i, worn, fresh }, n) => (
          <li key={i.id} className="rise" style={{ animationDelay: `${Math.min(n, 10) * 40}ms` }}>
            <article className="flex flex-col gap-2">
              <div className="relative">
                <Swatch item={i} className="lift aspect-[4/5]" />
                {fresh ? (
                  <span className="absolute top-2 left-2 rounded-full border-[1.5px] border-ink bg-lime px-2 text-xs font-semibold text-on-lime">
                    {copy.wardrobe.new}
                  </span>
                ) : null}
              </div>
              <h3 className="line-clamp-2 font-sans text-base leading-snug font-semibold">
                {i.name}
              </h3>
              <p className="text-sm text-ink-soft">
                {i.group}, {i.colourName}
              </p>
              {worn > 0 ? (
                <p className="font-mono text-xs text-ink-soft">
                  {fill(copy.wardrobe.worn, { n: worn })}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Outfits ---------- */

export function OutfitsSample() {
  return (
    <>
      <SampleNote tab="outfits" />
      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {OUTFITS.map((o, n) => {
          const parts = o.items.map(item);
          return (
            <li key={o.id} className="rise" style={{ animationDelay: `${n * 70}ms` }}>
              <article className="lift flex h-full flex-col gap-4 rounded-tile border border-line bg-surface p-5 shadow-[6px_6px_0_0_var(--pop-tint)]">
                {/* Swatch strip: the outfit's colours at a glance (FR-24). */}
                <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full">
                  {parts.map((p) => (
                    <span key={p.id} className="flex-1" style={{ background: p.colour }} />
                  ))}
                </div>
                <div>
                  <h2 className="text-xl">{o.occasion}</h2>
                  <p className="text-sm text-ink-soft">
                    {fill(copy.outfits.for, { when: o.when })}
                  </p>
                </div>
                <ul className="flex flex-col gap-3">
                  {parts.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <Swatch item={p} className="size-12 shrink-0" />
                      <span className="text-sm">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="text-ink-soft">{p.group}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <ComingSoon label={copy.outfits.swap} />
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------- Wishlist ---------- */

export function WishlistSample() {
  return (
    <>
      <SampleNote tab="wishlist" />
      <ul className="flex max-w-3xl flex-col gap-3">
        {WISHLIST.map((w, n) => {
          const i = item(w.id);
          const below = i.price <= w.target;
          return (
            <li key={w.id} className="rise" style={{ animationDelay: `${n * 50}ms` }}>
              <article className="lift flex items-center gap-4 rounded-tile border border-line bg-surface p-3 pr-4 sm:p-4">
                <Swatch item={i} className="size-16 shrink-0 sm:size-20" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-sans text-base font-semibold">{i.name}</h2>
                  <p className="text-sm text-ink-soft">{w.note}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {fill(copy.wishlist.plan, { plan: w.plan })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-base font-semibold">
                    {fill(copy.wishlist.now, { price: rupees(i.price) })}
                  </p>
                  <p className="font-mono text-xs text-ink-soft">
                    {fill(copy.wishlist.target, { price: rupees(w.target) })}
                  </p>
                  {below ? (
                    <p className="mt-1 inline-block rounded-full border-[1.5px] border-ink bg-lime px-2 text-xs font-semibold text-on-lime">
                      {copy.wishlist.below}
                    </p>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------- Purchases ---------- */

export function PurchasesSample() {
  const total = PURCHASES.reduce((sum, p) => sum + p.paid, 0);
  return (
    <>
      <SampleNote tab="purchases" />
      <div className="mb-5 flex max-w-3xl items-baseline justify-between gap-4 rounded-tile bg-pop-tint px-5 py-4">
        <p className="text-sm text-ink-soft">
          {fill(copy.purchases.total, { n: PURCHASES.length })}
        </p>
        <p className="font-mono text-2xl font-semibold">{rupees(total)}</p>
      </div>
      <ul className="flex max-w-3xl flex-col divide-y divide-line rounded-tile border border-line bg-surface">
        {PURCHASES.map((p) => {
          const i = item(p.item);
          return (
            <li key={p.id} className="flex items-center gap-4 p-3 sm:p-4">
              <Swatch item={i} className="size-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{i.name}</p>
                <p className="text-sm text-ink-soft">
                  {p.date}, {p.receipt ? copy.purchases.receipt : copy.purchases.noReceipt}
                </p>
              </div>
              <p className="shrink-0 font-mono font-semibold">{rupees(p.paid)}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
