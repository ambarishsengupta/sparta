import { OCCASIONS } from '@sparta/taxonomy';
import type { Occasion } from '@sparta/taxonomy';
import { isMissing, outfitProblems, seasonFor, suggest, swapChoices, usablePlacements } from '@sparta/rules';
import type { Ctx, CurrentSeason, Hemisphere, Item, ItemId, RankedSuggestion, Slot } from '@sparta/rules';
import type { StorageLike } from './local-repository';
import type { OutfitInput } from './repository';

export { OCCASIONS };
export const SLOTS: readonly Slot[] = ['top', 'bottom', 'layer', 'footwear', 'accessory'];
export const SLOT_LABEL: Record<Slot, string> = { top: 'Top', bottom: 'Bottom', layer: 'Layer', footwear: 'Footwear', accessory: 'Accessory' };
/** After a swap only these reasons are kept: re-validation proves the hard rules R1 and R2 still hold, nothing else is re-scored. */
const HARD_RULES = ['R1', 'R2'];

/** One outfit on screen. `score` is null once the person has swapped a piece: the engine scored its own pick, not the edited outfit. */
export interface Card {
  key: string;
  items: Record<Slot, ItemId | null>;
  score: number | null;
  reasons: string[];
  ruleIds: string[];
  saved: boolean;
  swaps: number;
}
export type View =
  | { kind: 'empty' }
  | { kind: 'missing'; missing: string[]; message: string }
  | { kind: 'cards'; cards: Card[] };

export const buildCtx = (occasion: Occasion, hemisphere: Hemisphere, date: Date = new Date()): Ctx => ({ occasion, hemisphere, date });
export const seasonOf = (ctx: Ctx): CurrentSeason => seasonFor(ctx.date, ctx.hemisphere);
export const activeItems = <T extends Item>(items: readonly T[]): T[] => items.filter((i) => i.status === 'active');
export const matchPercent = (card: Card): number | null => (card.score === null ? null : Math.round(card.score * 100));

const NEED: Record<string, string> = { top: 'a top', bottom: 'a bottom', footwear: 'footwear' };
/** FR-54 in plain words: "You need a bottom for this occasion". */
export function missingMessage(missing: readonly string[]): string {
  const parts = missing.map((m) => NEED[m] ?? m);
  if (parts.length === 0) return 'You need a few more items for this occasion';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `You need ${list} for this occasion`;
}

const toCard = (s: RankedSuggestion): Card => ({
  key: Object.values(s.items).filter((id): id is string => id !== null).sort().join('+'),
  items: { ...s.items }, score: s.score, reasons: [...s.reasons], ruleIds: [...s.ruleIds], saved: false, swaps: 0,
});

/** Ask the engine over the active items only (FR-52). Pure given the same items and ctx (FR-58). */
export function startView(items: readonly Item[], ctx: Ctx): View {
  const active = activeItems(items);
  if (active.length === 0) return { kind: 'empty' };
  const result = suggest(active, ctx);
  if (isMissing(result)) return { kind: 'missing', missing: result.missing, message: missingMessage(result.missing) };
  return { kind: 'cards', cards: result.map(toCard) };
}

const mapCards = (view: View, key: string, change: (c: Card) => Card | null): View =>
  view.kind !== 'cards' ? view : { kind: 'cards', cards: view.cards.flatMap((c) => (c.key === key ? change(c) ?? [] : [c])) };

/** Reject removes the card. */
export const reject = (view: View, key: string): View => mapCards(view, key, () => null);
/** Accept marks the card saved; a saved card cannot be accepted or swapped again. */
export const markSaved = (view: View, key: string): View => mapCards(view, key, (c) => ({ ...c, saved: true }));
export const toOutfitInput = (card: Card, occasion: Occasion): OutfitInput => ({
  occasion, items: { ...card.items }, score: card.score ?? 0, reasons: [...card.reasons],
});

/** The pieces of a card, in slot order; a piece that fills two slots (Suit) appears once. */
export function chipsOf(card: Card): { itemId: ItemId; slots: Slot[] }[] {
  const chips: { itemId: ItemId; slots: Slot[] }[] = [];
  for (const slot of SLOTS) {
    const id = card.items[slot];
    if (id === null) continue;
    const chip = chips.find((c) => c.itemId === id);
    if (chip) chip.slots.push(slot); else chips.push({ itemId: id, slots: [slot] });
  }
  return chips;
}

const outfitOf = (card: Card, byId: Map<ItemId, Item>): Record<Slot, Item | null> =>
  Object.fromEntries(SLOTS.map((s) => [s, byId.get(card.items[s] ?? '') ?? null])) as Record<Slot, Item | null>;

/** FR-53: the engine's swap choices for one slot, most similar first. */
export function swapOptions(card: Card, slot: Slot, items: readonly Item[], ctx: Ctx): ItemId[] {
  return swapChoices({ items: card.items, score: card.score ?? 0, reasons: card.reasons, ruleIds: card.ruleIds }, slot, activeItems(items), {}, ctx);
}

export interface SwapResult { view: View; ok: boolean; problems: string[] }

/**
 * Put `newId` in `slot` and re-validate the whole outfit with the engine's own check (`outfitProblems`: slots, R1, R2, duplicates).
 * A piece that fills two slots is removed from both first. Nothing changes unless the check comes back empty.
 */
export function applySwap(view: View, key: string, slot: Slot, newId: ItemId, items: readonly Item[], ctx: Ctx): SwapResult {
  const card = view.kind === 'cards' ? view.cards.find((c) => c.key === key) : undefined;
  const byId = new Map(activeItems(items).map((i) => [i.id, i]));
  const candidate = byId.get(newId);
  if (!card || !candidate) return { view, ok: false, problems: ['UNKNOWN'] };
  if (card.saved) return { view, ok: false, problems: ['SAVED'] };
  const base = outfitOf(card, byId);
  const replaced = base[slot];
  let problems: string[] = ['R1'];
  for (const placement of usablePlacements(candidate, ctx.occasion).filter((p) => p.includes(slot))) {
    const next = { ...base };
    for (const s of SLOTS) if (replaced && next[s]?.id === replaced.id) next[s] = null;
    for (const s of placement) next[s] = candidate;
    problems = outfitProblems(next, ctx);
    if (problems.length > 0) continue;
    const keep = card.ruleIds.map((id, n) => (HARD_RULES.includes(id) ? n : -1)).filter((n) => n >= 0);
    const changed: Card = {
      ...card, items: Object.fromEntries(SLOTS.map((s) => [s, next[s]?.id ?? null])) as Card['items'], score: null,
      reasons: keep.map((n) => card.reasons[n]!), ruleIds: keep.map((n) => card.ruleIds[n]!), swaps: card.swaps + 1,
    };
    return { view: mapCards(view, key, () => changed), ok: true, problems: [] };
  }
  return { view, ok: false, problems };
}

/** Hemisphere setting, kept in the browser under its own versioned key. Default north. */
export const SETTINGS_KEY = 'sparta.settings.v1';
export function loadHemisphere(storage: StorageLike | null): Hemisphere {
  try {
    const doc = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null') as { version?: number; hemisphere?: string } | null;
    return doc?.version === 1 && doc.hemisphere === 'south' ? 'south' : 'north';
  } catch {
    return 'north';
  }
}
export function saveHemisphere(storage: StorageLike | null, hemisphere: Hemisphere): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, hemisphere }));
  } catch {
    /* blocked or full: the choice lasts for this visit only */
  }
}
