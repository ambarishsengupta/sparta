'use client';
import { LegendList } from './shared';
import type { LegendItem } from './shared';

/** Swatches with labels, used by the other charts. `slot` is the palette slot 1 to 6 (5 and 6 are hatched). Shown only when there is more than one item. */
export function Legend({ items }: { items: LegendItem[] }) {
  return items.length > 1 ? <LegendList items={items} /> : null;
}
export type { LegendItem };
