import { describe, expect, it } from 'vitest';
import { OCCASIONS } from '@sparta/taxonomy';
import type { Ctx, Item } from '@sparta/rules';
import { outfitProblems, usablePlacements } from '@sparta/rules';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { LocalRepository } from './local-repository';
import type { StorageLike } from './local-repository';
import {
  SETTINGS_KEY, SLOTS, activeItems, applySwap, buildCtx, chipsOf, eventDetails, loadHemisphere, markSaved, matchPercent, missingMessage,
  reasonSummary, reject, sameAs, saveHemisphere, seasonOf, startView, swapOptions, toOutfitInput,
} from './suggestions-view-model';
import type { Card, View } from './suggestions-view-model';

const mem = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const APRIL = new Date('2026-04-15T12:00:00Z');
const office = WARDROBES['Office regular']!;
const ctxOf = (o: (typeof OCCASIONS)[number], h: 'north' | 'south' = 'north', d = APRIL) => buildCtx(o, h, d);
const cardsOf = (v: View): Card[] => { if (v.kind !== 'cards') throw new Error(`expected cards, got ${v.kind}`); return v.cards; };
const outfitOf = (card: Card, items: readonly Item[]) =>
  Object.fromEntries(SLOTS.map((s) => [s, items.find((i) => i.id === card.items[s]) ?? null])) as Parameters<typeof outfitProblems>[0];

describe('context, season and hemisphere (FR-52, FR-58)', () => {
  it('builds a ctx from the occasion, the hemisphere and the date', () => {
    expect(ctxOf('Work', 'south')).toEqual({ occasion: 'Work', hemisphere: 'south', date: APRIL });
  });
  it('derives the season from the date with the engine helper, flipped in the south', () => {
    const season = (iso: string, h: 'north' | 'south') => seasonOf(buildCtx('Casual', h, new Date(iso)));
    expect(['2026-01-10', '2026-04-15', '2026-07-10', '2026-10-15'].map((d) => season(`${d}T12:00:00Z`, 'north'))).toEqual(['Winter', 'Spring', 'Summer', 'Autumn']);
    expect(['2026-01-10', '2026-04-15', '2026-07-10', '2026-10-15'].map((d) => season(`${d}T12:00:00Z`, 'south'))).toEqual(['Summer', 'Autumn', 'Winter', 'Spring']);
  });
  it('offers the seven occasions of the taxonomy', () => {
    expect(OCCASIONS).toEqual(['Casual', 'Work', 'Formal', 'Party', 'Sport', 'Date', 'Travel']);
  });
  it('remembers the hemisphere under its own key, north by default', () => {
    const s = mem();
    expect(loadHemisphere(s)).toBe('north');
    saveHemisphere(s, 'south');
    expect(loadHemisphere(s)).toBe('south');
    expect(s.getItem(SETTINGS_KEY)).toContain('"version":1');
    saveHemisphere(s, 'north');
    expect(loadHemisphere(s)).toBe('north');
  });
  it('falls back to north on missing, corrupt or foreign-version settings and on blocked storage', () => {
    expect(loadHemisphere(null)).toBe('north');
    for (const raw of ['{', '"south"', '{"version":2,"hemisphere":"south"}', '{"version":1,"hemisphere":"mars"}']) {
      expect(loadHemisphere({ getItem: () => raw, setItem: () => undefined })).toBe('north');
    }
    const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadHemisphere(blocked)).toBe('north');
    expect(() => saveHemisphere(blocked, 'south')).not.toThrow();
  });
});

describe('asking for suggestions (FR-52, FR-54)', () => {
  it('says empty when there are no active items, archived ones included', () => {
    expect(startView([], ctxOf('Casual')).kind).toBe('empty');
    expect(startView(office.map((i) => ({ ...i, status: 'archived' as const })), ctxOf('Casual')).kind).toBe('empty');
  });
  it('gives up to three outfits with a reason and a score each', () => {
    const cards = cardsOf(startView(office, ctxOf('Work')));
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.score).toBeGreaterThan(0);
      expect(c.saved).toBe(false);
    }
  });
  it('gives the same outfits in the same order for the same inputs (FR-58)', () => {
    expect(startView(office, ctxOf('Casual'))).toEqual(startView(office, ctxOf('Casual')));
  });
  it('never uses an archived item', () => {
    const archivedIds = new Set(office.filter((i) => i.subType === 'Blazer').map((i) => i.id));
    const items = office.map((i) => (archivedIds.has(i.id) ? { ...i, status: 'archived' as const } : i));
    for (const c of cardsOf(startView(items, ctxOf('Formal')))) for (const id of Object.values(c.items)) expect(archivedIds.has(id ?? '')).toBe(false);
  });
  it('returns what is missing, in plain words, for a thin wardrobe', () => {
    const view = startView(WARDROBES['Thin wardrobe']!, ctxOf('Work'));
    expect(view.kind).toBe('missing');
    if (view.kind === 'missing') {
      expect(view.missing).toEqual(['top', 'bottom']);
      expect(view.message).toBe('You need a top and a bottom for this occasion');
    }
  });
  it('words the missing slots as FR-54 does', () => {
    expect(missingMessage(['bottom'])).toBe('You need a bottom for this occasion');
    expect(missingMessage(['top'])).toBe('You need a top for this occasion');
    expect(missingMessage(['footwear'])).toBe('You need footwear for this occasion');
    expect(missingMessage(['bottom', 'footwear'])).toBe('You need a bottom and footwear for this occasion');
    expect(missingMessage(['top', 'bottom', 'footwear'])).toBe('You need a top, a bottom and footwear for this occasion');
    expect(missingMessage([])).toBe('You need a few more items for this occasion');
  });
  it('keeps only active items', () => {
    expect(activeItems(office.map((i, n) => (n === 0 ? { ...i, status: 'archived' as const } : i)))).toHaveLength(office.length - 1);
  });
});

describe('accept and reject (FR-53)', () => {
  const cards = cardsOf(startView(office, ctxOf('Work')));
  const view: View = { kind: 'cards', cards };
  it('reject removes only that card', () => {
    const next = cardsOf(reject(view, cards[1]!.key));
    expect(next.map((c) => c.key)).toEqual([cards[0]!.key, cards[2]!.key]);
    expect(cards).toHaveLength(3);
  });
  it('rejecting every card leaves an empty list, and other views are left alone', () => {
    const none = cards.reduce<View>((v, c) => reject(v, c.key), view);
    expect(cardsOf(none)).toEqual([]);
    expect(reject({ kind: 'empty' }, 'x')).toEqual({ kind: 'empty' });
  });
  it('accept marks the card saved and builds the outfit to store', () => {
    const next = cardsOf(markSaved(view, cards[0]!.key));
    expect(next.map((c) => c.saved)).toEqual([true, false, false]);
    expect(toOutfitInput(cards[0]!, 'Work')).toEqual({ occasion: 'Work', items: cards[0]!.items, score: cards[0]!.score, reasons: cards[0]!.reasons });
  });
  it('an accepted outfit is saved through the repository and survives a reload', async () => {
    const storage = mem();
    const repo = new LocalRepository(storage);
    const saved = await repo.outfits.create(toOutfitInput(cards[0]!, 'Work'));
    const again = await new LocalRepository(storage).outfits.list();
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: saved.id, occasion: 'Work', items: cards[0]!.items });
  });
  it('turns the score into a percent for the match meter', () => {
    expect(matchPercent({ ...cards[0]!, score: 0.964 })).toBe(96);
    expect(matchPercent({ ...cards[0]!, score: null })).toBeNull();
  });
  it('shows a Suit once, in both of its slots', () => {
    const card: Card = { ...cards[0]!, items: { top: 'a', bottom: 'suit', layer: 'suit', footwear: 'f', accessory: null } };
    expect(chipsOf(card)).toEqual([{ itemId: 'a', slots: ['top'] }, { itemId: 'suit', slots: ['bottom', 'layer'] }, { itemId: 'f', slots: ['footwear'] }]);
  });
});

describe('swap (FR-53, re-validated by the engine)', () => {
  const ctx = ctxOf('Work');
  const cards = cardsOf(startView(office, ctx));
  const view: View = { kind: 'cards', cards };
  const card = cards[0]!;
  it('lists only other active items, most similar first (same sub-type before others)', () => {
    const choices = swapOptions(card, 'top', office, ctx);
    expect(choices.length).toBeGreaterThan(1);
    expect(choices).not.toContain(card.items.top);
    const sub = (id: string) => office.find((i) => i.id === id)!.subType;
    const replaced = sub(card.items.top!);
    const firstOther = choices.findIndex((id) => sub(id) !== replaced);
    if (firstOther >= 0) expect(choices.slice(firstOther).some((id) => sub(id) === replaced)).toBe(false);
    expect(choices.every((id) => office.find((i) => i.id === id)!.status === 'active')).toBe(true);
  });
  it('replaces exactly one slot and re-validates the whole outfit', () => {
    const pick = swapOptions(card, 'bottom', office, ctx)[0]!;
    const result = applySwap(view, card.key, 'bottom', pick, office, ctx);
    expect(result.ok).toBe(true);
    const next = cardsOf(result.view).find((c) => c.key === card.key)!;
    expect(next.items).toEqual({ ...card.items, bottom: pick });
    expect(outfitProblems(outfitOf(next, office), ctx)).toEqual([]);
    expect(next.swaps).toBe(1);
  });
  it('stops scoring a swapped outfit and keeps only the reasons the re-check proves', () => {
    const next = cardsOf(applySwap(view, card.key, 'footwear', swapOptions(card, 'footwear', office, ctx)[0]!, office, ctx).view)[0]!;
    expect(next.score).toBeNull();
    expect(next.ruleIds).toEqual(['R1', 'R2']);
    expect(next.reasons).toEqual(card.reasons.slice(0, 2));
    expect(toOutfitInput(next, 'Work').score).toBeNull();
  });
  it('refuses a piece that would break the rules and changes nothing', () => {
    const cap = WARDROBES['Starter student']!.find((i) => i.subType === 'Cap')!;
    const result = applySwap(view, card.key, 'footwear', cap.id, [...office, cap], ctx);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.view).toBe(view);
  });
  it('refuses archived, unknown and already saved cases', () => {
    const pick = swapOptions(card, 'top', office, ctx)[0]!;
    const archived = office.map((i) => (i.id === pick ? { ...i, status: 'archived' as const } : i));
    expect(applySwap(view, card.key, 'top', pick, archived, ctx).ok).toBe(false);
    expect(applySwap(view, 'nope', 'top', pick, office, ctx).problems).toEqual(['UNKNOWN']);
    expect(applySwap(markSaved(view, card.key), card.key, 'top', pick, office, ctx).problems).toEqual(['SAVED']);
  });
  it('every choice offered for every slot of every outfit passes the engine check, on all five fixture wardrobes and seven occasions', () => {
    let checked = 0;
    for (const items of Object.values(WARDROBES)) {
      for (const occasion of OCCASIONS) {
        const c = ctxOf(occasion);
        const v = startView(items, c);
        if (v.kind !== 'cards') continue;
        for (const k of v.cards) for (const slot of SLOTS) {
          if (k.items[slot] === null) continue;
          for (const id of swapOptions(k, slot, items, c)) {
            const result = applySwap(v, k.key, slot, id, items, c);
            expect(result.ok, `${occasion} ${slot} ${id}`).toBe(true);
            expect(outfitProblems(outfitOf(cardsOf(result.view).find((x) => x.key === k.key)!, items), c)).toEqual([]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('swap re-validation with the engine check (WO-0022 item 3)', () => {
  const january = new Date('2026-01-15T12:00:00Z');
  const ctx = ctxOf('Casual', 'north', january);
  const pool = Object.values(WARDROBES).flat();
  const summer = (subType: string, id: string): Item => ({ ...pool.find((i) => i.subType === subType)!, id, seasons: ['Summer'], occasions: ['Casual'], status: 'active' });
  const items = [...office, summer('Shorts', 'x-shorts'), summer('Sandals', 'x-sandals')];
  const view = startView(items, ctx);
  it.each([['bottom', 'x-shorts'], ['footwear', 'x-sandals']] as const)('refuses %s %s in January: the placement is valid, the season rule R2 is not', (slot, id) => {
    const candidate = items.find((i) => i.id === id)!;
    expect(usablePlacements(candidate, 'Casual').some((p) => p.includes(slot))).toBe(true);
    const card = cardsOf(view)[0]!;
    const result = applySwap(view, card.key, slot, id, items, ctx);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('R2');
    expect(result.view).toBe(view);
    expect(swapOptions(card, slot, items, ctx)).not.toContain(id);
  });
  it('the same shorts are accepted in July, so the refusal comes from the season rule', () => {
    const july = ctxOf('Casual', 'north', new Date('2026-07-15T12:00:00Z'));
    const v = startView(items, july);
    expect(applySwap(v, cardsOf(v)[0]!.key, 'bottom', 'x-shorts', items, july).ok).toBe(true);
  });
});

describe('a swapped outfit: saving, events, reasons and duplicates (WO-0022 items 7, 9, 10)', () => {
  const ctx = ctxOf('Work');
  const view = startView(office, ctx);
  const [first, second] = cardsOf(view) as [Card, Card];
  const swapped = cardsOf(applySwap(view, first.key, 'bottom', swapOptions(first, 'bottom', office, ctx)[0]!, office, ctx).view)[0]!;
  it('saves a swapped outfit with a null score and it stays null after a reload', async () => {
    const storage = mem();
    await new LocalRepository(storage).outfits.create(toOutfitInput(swapped, 'Work'));
    expect((await new LocalRepository(storage).outfits.list())[0]!.score).toBeNull();
    expect(toOutfitInput(first, 'Work').score).toBe(first.score);
  });
  it('the swapped event carries the occasion, season, slot and only the rule ids that still hold', () => {
    expect(first.ruleIds.length).toBeGreaterThan(2);
    expect(eventDetails(ctx, swapped, 'bottom')).toEqual({ occasion: 'Work', season: 'Spring', ruleIds: ['R1', 'R2'], slot: 'bottom' });
    expect(eventDetails(ctx, swapped, 'bottom').ruleIds).not.toEqual(first.ruleIds);
  });
  it('shows the top two reasons joined with a semicolon and keeps the rest for the disclosure', () => {
    const { line, rest } = reasonSummary(first);
    expect(first.reasons.length).toBeGreaterThan(2);
    expect(line).toBe(`${first.reasons[0]}; ${first.reasons[1]}`);
    expect(rest).toEqual(first.reasons.slice(2));
    expect(reasonSummary(swapped)).toEqual({ line: `${swapped.reasons[0]}; ${swapped.reasons[1]}`, rest: [] });
    expect(reasonSummary({ ...first, reasons: ['Only one'] })).toEqual({ line: 'Only one', rest: [] });
  });
  it('says "Same as outfit N" when swaps make a card hold the same pieces as another card, and does not rescore', () => {
    /** Swap every differing piece of `a` for the one in `b`, one engine-checked swap at a time; null when one is refused. */
    const turnInto = (v: View, a: Card, b: Card, c: Ctx): View | null => {
      for (const slot of SLOTS) {
        if (b.items[slot] === null || cardsOf(v).find((x) => x.key === a.key)!.items[slot] === b.items[slot]) continue;
        const r = applySwap(v, a.key, slot, b.items[slot]!, office, c);
        if (!r.ok) return null;
        v = r.view;
      }
      return v;
    };
    const shape = (c: Card) => SLOTS.map((s) => c.items[s] === null).join();
    let done = false;
    for (const o of OCCASIONS) {
      const c = ctxOf(o);
      const v = startView(office, c);
      if (v.kind !== 'cards' || done) continue;
      for (const a of v.cards) for (const b of v.cards.filter((x) => x !== a && shape(x) === shape(a))) {
        const w = done ? null : turnInto(v, a, b, c);
        if (!w) continue;
        done = true;
        const cards = cardsOf(w);
        const mine = cards.find((x) => x.key === a.key)!;
        expect(Object.values(mine.items).sort()).toEqual(Object.values(b.items).sort());
        expect(sameAs(cards, mine)).toBe(cards.findIndex((x) => x.key === b.key) + 1);
        expect(mine.score).toBeNull();
        expect(sameAs(cards, cards.find((x) => x.key === b.key)!)).toBeNull();
      }
    }
    expect(done).toBe(true);
  });
  it('shows no note for an unswapped card or when no other card matches', () => {
    const twin = { ...first, key: 'twin', swaps: 1 };
    expect(sameAs(cardsOf(view), first)).toBeNull();
    expect(sameAs([swapped, second], swapped)).toBeNull();
    expect(sameAs([second, twin], twin)).toBeNull();
    expect(sameAs([first, twin], twin)).toBe(1);
  });
});
