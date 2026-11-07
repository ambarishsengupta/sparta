// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Product grid for "Start from popular items". Tile anatomy: tinted photo area with
// a round add button, discount badge, price and struck-through MRP, two-line name,
// rating, colour swatches. Responsive: 2 columns on phones, up to 6 on wide screens.
// Add toggles locally (no wardrobe store until M2) and announces politely.
import { Check, Plus, Star } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { type CatalogueItem, discount, rupees } from "@/lib/catalogue";
import { cn } from "@/lib/utils";

export function CatalogueGrid({ items }: { items: CatalogueItem[] }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState("");

  const toggle = (item: CatalogueItem) => {
    const on = !added.has(item.id);
    setAdded((prev) => {
      const next = new Set(prev);
      if (on) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    setAnnounce(on ? `${item.name} added to your wardrobe.` : `${item.name} removed.`);
  };

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {items.map((item, i) => {
          const on = added.has(item.id);
          return (
            <li
              key={item.id}
              className="rise"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <article className="flex h-full flex-col gap-2">
                <div
                  className="lift relative aspect-[4/5] overflow-hidden rounded-tile"
                  style={{ background: `color-mix(in oklab, ${item.colour} 14%, var(--surface))` }}
                >
                  {item.image ? (
                    <Image
                      src={`/catalogue/img/${item.image}`}
                      alt={item.name}
                      fill
                      sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, (min-width: 640px) 30vw, 48vw"
                      className="object-cover mix-blend-multiply"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 m-auto size-1/3 rounded-full"
                      style={{ background: item.colour, opacity: 0.85 }}
                    />
                  )}
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${on ? "Remove" : "Add"} ${item.name}`}
                    onClick={() => toggle(item)}
                    className={cn(
                      "press-feedback absolute right-2 bottom-2 flex size-11 items-center justify-center rounded-full border-[1.5px] border-ink",
                      "transition-colors duration-200 ease-snap",
                      on ? "bg-lime text-on-lime" : "bg-yellow text-on-yellow",
                    )}
                  >
                    {on ? (
                      <Check aria-hidden="true" className="size-5" strokeWidth={2.5} />
                    ) : (
                      <Plus aria-hidden="true" className="size-5" strokeWidth={2.5} />
                    )}
                  </button>
                </div>

                <p className="flex items-center gap-2 text-sm">
                  <span className="rounded-sm bg-accent-text px-1.5 py-0.5 font-semibold text-surface">
                    {discount(item)}% off
                  </span>
                  <span className="font-semibold text-accent-text">{item.group}</span>
                </p>

                <p className="flex flex-wrap items-baseline gap-x-2 text-ink">
                  <span className="font-mono text-xl font-semibold">{rupees(item.price)}</span>
                  <span className="font-mono text-sm text-ink-soft">
                    M.R.P: <s>{rupees(item.mrp)}</s>
                  </span>
                </p>

                <h3 className="line-clamp-2 font-sans text-base leading-snug font-normal">
                  {item.name}
                </h3>

                {item.rating ? (
                  <p className="flex items-center gap-1 text-sm text-ink-soft">
                    <span>{item.rating.toFixed(1)}</span>
                    <span aria-hidden="true" className="flex">
                      {Array.from({ length: 5 }, (_, s) => (
                        <Star
                          key={s}
                          className={cn(
                            "size-3.5",
                            s < Math.round(item.rating!)
                              ? "fill-tangerine text-tangerine"
                              : "text-control-border",
                          )}
                          strokeWidth={1.5}
                        />
                      ))}
                    </span>
                    <span className="sr-only">out of 5 stars,</span>
                    <span>({item.ratingCount?.toLocaleString("en-IN")})</span>
                  </p>
                ) : null}

                {item.swatches?.length ? (
                  <ul className="flex gap-2" aria-label="Other colours">
                    {item.swatches.map((c) => (
                      <li
                        key={c}
                        aria-hidden="true"
                        className="size-5 rounded-full border border-ink/40"
                        style={{ background: c }}
                      />
                    ))}
                  </ul>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </>
  );
}
