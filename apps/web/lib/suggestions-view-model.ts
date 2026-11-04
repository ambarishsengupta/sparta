import { OCCASIONS } from '@sparta/taxonomy';
import type { Occasion } from '@sparta/taxonomy';
import { MAX_SUGGESTIONS, isMissing, outfitProblems, seasonFor, suggest, swapChoices, usablePlacements } from '@sparta/rules';
import type { Ctx, CurrentSeason, Hemisphere, Item, ItemId, RankedSuggestion, Slot, SuggestOpts } from '@sparta/rules';
import type { StorageLike } from './local-repository';
import type { EventDetails } from './events';
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
  | { kind: 'anchor_invalid'; reason: 'anchor_not_valid' | 'anchor_not_offered' | 'anchor_not_active'; message: string }
  /** `anchor` is set for Complete the look (FR-59a): that item stays in its slot; `thin` is true when fewer than three outfits exist around it. */
  | { kind: 'cards'; cards: Card[]; anchor?: ItemId; thin?: boolean };

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

const itemSetKey = (items: Record<Slot, ItemId | null>): string => Object.values(items).filter((id): id is string => id !== null).sort().join('+');

const toCard = (s: RankedSuggestion): Card => ({
  key: itemSetKey(s.items),
  items: { ...s.items }, score: s.score, reasons: [...s.reasons], ruleIds: [...s.ruleIds], saved: false, swaps: 0,
});

const invalid = (reason: 'anchor_not_valid' | 'anchor_not_offered' | 'anchor_not_active', message: string): View => ({ kind: 'anchor_invalid', reason, message });
/** FR-59a / FR-54: `opts.anchor` asks for outfits around that item; `opts.prior` is the loaded pairing prior (null or absent = off). */
export function startView(items: readonly Item[], ctx: Ctx, opts: SuggestOpts = {}): View {
  const active = activeItems(items);
  if (active.length === 0) return { kind: 'empty' };
  if (opts.anchor !== undefined && !active.some((i) => i.id === opts.anchor)) return invalid('anchor_not_active', 'That item is not in your active wardrobe');
  const result = suggest(active, ctx, opts);
  if (isMissing(result)) {
    if (result.missing.includes('anchor_not_valid')) return invalid('anchor_not_valid', `This item does not suit ${ctx.occasion} in ${seasonOf(ctx)}`);
    if (result.missing.includes('anchor_not_offered')) return invalid('anchor_not_offered', 'Outfits are not built around accessories, underwear or socks');
    return { kind: 'missing', missing: result.missing, message: missingMessage(result.missing) };
  }
  const cards = result.map(toCard);
  return opts.anchor === undefined ? { kind: 'cards', cards } : { kind: 'cards', cards, anchor: opts.anchor, thin: cards.length < MAX_SUGGESTIONS };
}
/** FR-54 for Complete the look when fewer than three outfits exist around the item. */
export const thinMessage = (count: number, name: string, ctx: Ctx): string =>
  `Only ${count} outfit${count === 1 ? '' : 's'} around ${name} work${count === 1 ? 's' : ''} for ${ctx.occasion} in ${seasonOf(ctx)}. Add more items for more.`;

const mapCards = (view: View, key: string, change: (c: Card) => Card | null): View =>
  view.kind !== 'cards' ? view : { ...view, cards: view.cards.flatMap((c) => (c.key === key ? change(c) ?? [] : [c])) };

/** Reject removes the card. */
export const reject = (view: View, key: string): View => mapCards(view, key, () => null);
/** Accept marks the card saved; a saved card cannot be accepted or swapped again. */
export const markSaved = (view: View, key: string): View => mapCards(view, key, (c) => ({ ...c, saved: true }));
export const toOutfitInput = (card: Card, occasion: Occasion): OutfitInput => ({
  occasion, items: { ...card.items }, score: card.score, reasons: [...card.reasons],
});

/** FR-52: the top two reasons on one line joined with '; ', the rest for a "Why this outfit?" disclosure. */
export const reasonSummary = (card: Card): { line: string; rest: string[] } => ({ line: card.reasons.slice(0, 2).join('; '), rest: card.reasons.slice(2) });

/** For a swapped card that now holds the same pieces as another card: that card's number (1 based), else null. Nothing is re-scored. */
export function sameAs(cards: readonly Card[], card: Card): number | null {
  if (card.swaps === 0) return null;
  const at = cards.findIndex((c) => c.key !== card.key && itemSetKey(c.items) === itemSetKey(card.items));
  return at < 0 ? null : at + 1;
}

/** What a usage event records: occasion, season, the card's CURRENT rule ids (after a swap that is only R1 and R2) and the slot. */
export const eventDetails = (ctx: Ctx, card?: Card, slot?: Slot): EventDetails => ({ occasion: ctx.occasion, season: seasonOf(ctx), ruleIds: card?.ruleIds, slot });

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

/**
 * FR-53: the engine's swap choices for one slot, most similar first. With an `anchor` (FR-59a) its own slot offers none, and a choice that
 * would push the anchor out (a Suit over the anchor's slot) is left out; `swapChoices` itself is unchanged.
 */
export function swapOptions(card: Card, slot: Slot, items: readonly Item[], ctx: Ctx, anchor?: ItemId): ItemId[] {
  if (anchor !== undefined && card.items[slot] === anchor) return [];
  const choices = swapChoices({ items: card.items, score: card.score ?? 0, reasons: card.reasons, ruleIds: card.ruleIds }, slot, activeItems(items), {}, ctx);
  return anchor === undefined ? choices : choices.filter((id) => applySwap({ kind: 'cards', cards: [card], anchor }, card.key, slot, id, items, ctx).ok);
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
  const anchor = view.kind === 'cards' ? view.anchor : undefined;
  const base = outfitOf(card, byId);
  const replaced = base[slot];
  let problems: string[] = ['R1'];
  for (const placement of usablePlacements(candidate, ctx.occasion).filter((p) => p.includes(slot))) {
    const next = { ...base };
    for (const s of SLOTS) if (replaced && next[s]?.id === replaced.id) next[s] = null;
    for (const s of placement) next[s] = candidate;
    problems = outfitProblems(next, ctx);
    if (problems.length === 0 && anchor !== undefined && !SLOTS.some((s) => next[s]?.id === anchor)) problems = ['ANCHOR']; // the anchor must stay
    if (problems.length > 0) continue;
    const keep = card.ruleIds.map((id, n) => (HARD_RULES.includes(id) || (anchor !== undefined && id === 'ANCHOR') ? n : -1)).filter((n) => n >= 0);
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
