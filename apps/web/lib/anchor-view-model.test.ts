import { describe, expect, it } from 'vitest';
import { outfitProblems, parsePrior, swapChoices } from '@sparta/rules';
import type { Item } from '@sparta/rules';
import prior from '../../../packages/rules/data/fixtures/pairing-prior.fixture.json';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { SLOTS, anchorIntro, applySwap, buildCtx, markSaved, notValidMessage, reject, startView, swapOptions, thinMessage } from './suggestions-view-model';
import type { Card, View } from './suggestions-view-model';

const APRIL = new Date('2026-04-15T12:00:00Z');
const [work, formal, casual] = (['Work', 'Formal', 'Casual'] as const).map((o) => buildCtx(o, 'north', APRIL)) as [ReturnType<typeof buildCtx>, ReturnType<typeof buildCtx>, ReturnType<typeof buildCtx>];
const office = WARDROBES['Office regular']!;
const nameOf = (id: string) => office.find((i) => i.id === id)!.name;
const cards = (v: View): Card[] => { if (v.kind !== 'cards') throw new Error(`expected cards, got ${v.kind}`); return v.cards; };
const held = (c: Card, items: readonly Item[]) => Object.fromEntries(SLOTS.map((s) => [s, items.find((i) => i.id === c.items[s]) ?? null])) as Parameters<typeof outfitProblems>[0];

describe('Complete the look view (FR-59a)', () => {
  it.each(['off-01', 'off-09', 'off-14', 'off-18'])('every outfit around %s holds it, passes the rules and names it first', (id) => {
    const v = startView(office, work, { anchor: id });
    expect(v).toMatchObject({ kind: 'cards', anchor: id, thin: false });
    for (const c of cards(v)) {
      expect(SLOTS.some((s) => c.items[s] === id)).toBe(true);
      expect(outfitProblems(held(c, office), work)).toEqual([]);
      expect([c.ruleIds[0], c.reasons[0]]).toEqual(['ANCHOR', `Built around your ${nameOf(id)}`]);
    }
  });
  it.each(['off-06', 'off-13'])('names only the occasion when the occasion rule is the cause (%s is refused by R1 for Work, not by the season)', (id) => {
    expect(startView(office, work, { anchor: id })).toEqual({ kind: 'anchor_invalid', reason: 'anchor_not_valid', message: 'This item does not suit Work' });
  });
  it('names the season too when the season rule is a cause (a Winter-only overcoat in April)', () => {
    expect(startView(office, work, { anchor: 'off-16' })).toEqual({ kind: 'anchor_invalid', reason: 'anchor_not_valid', message: 'This item does not suit Work in Spring' });
    expect(notValidMessage(undefined, work)).toBe('This item does not suit Work');
  });
  it('the season in that message follows the hemisphere', () => {
    const v = startView(office, buildCtx('Work', 'south', APRIL), { anchor: 'off-16' });
    expect(v).toMatchObject({ kind: 'anchor_invalid', message: expect.stringMatching(/in Autumn$/) as string });
  });
  it('the intro under "Complete the look" promises outfits only when outfits are on screen', () => {
    const none: View = { kind: 'cards', cards: [], anchor: 'off-01' };
    expect(anchorIntro(startView(office, work, { anchor: 'off-01' }), 'Work')).toBe('Every outfit below keeps this item.');
    for (const v of [startView(office, work, { anchor: 'off-06' }), startView(office, work, { anchor: 'off-16' }), startView(office, work, { anchor: 'off-21' }), startView(office, work, { anchor: 'nope' }), none, null]) {
      expect(anchorIntro(v, 'Work')).toBeNull();
    }
    expect(anchorIntro(null, null)).toBe('Pick an occasion to build outfits around this item.');
  });
  it('accessories, an archived item and an unknown id get their own clear message', () => {
    expect(startView(office, work, { anchor: 'off-21' })).toMatchObject({ reason: 'anchor_not_offered', message: 'Outfits are not built around accessories, underwear or socks' });
    const archived = office.map((i) => (i.id === 'off-01' ? { ...i, status: 'archived' as const } : i));
    for (const [items, id] of [[archived, 'off-01'], [office, 'nope']] as const) {
      expect(startView(items, work, { anchor: id })).toMatchObject({ reason: 'anchor_not_active', message: 'That item is not in your active wardrobe' });
    }
  });
  it('a thin wardrobe gives fewer than three outfits with a clear message, or a plain "you need" when there are none', () => {
    const thin = WARDROBES['Thin wardrobe']!;
    const v = startView(thin, casual, { anchor: 'thin-01' });
    expect(v).toMatchObject({ kind: 'cards', thin: true });
    expect(cards(v)).toHaveLength(1);
    expect(thinMessage(1, 'White T-shirt', casual)).toBe('Only 1 outfit around White T-shirt works for Casual in Spring. Add more items for more.');
    expect(thinMessage(2, 'X', casual)).toBe('Only 2 outfits around X work for Casual in Spring. Add more items for more.');
    expect(startView(thin, work, { anchor: 'thin-03' })).toMatchObject({ kind: 'missing', message: expect.stringMatching(/^You need /) as string });
  });
  it('without an anchor the view is the normal one (no anchor field), and a null or absent prior changes nothing', () => {
    const normal = startView(office, work);
    expect(normal).not.toHaveProperty('anchor');
    expect(JSON.stringify(startView(office, work, { prior: null }))).toBe(JSON.stringify(normal));
    expect(JSON.stringify(startView(office, work, { prior: undefined }))).toBe(JSON.stringify(normal));
  });
  it('a loaded prior reaches the engine: scores change, every outfit still passes the rules', () => {
    const [plain, nudged] = [cards(startView(office, work)), cards(startView(office, work, { prior: parsePrior(prior) }))];
    expect(nudged.map((c) => c.score)).not.toEqual(plain.map((c) => c.score));
    for (const c of nudged) expect(outfitProblems(held(c, office), work)).toEqual([]);
  });
});

describe('the swap sheet and the anchor (FR-59a)', () => {
  const view = startView(office, work, { anchor: 'off-01' });
  const card = cards(view)[0]!;
  it('offers nothing for the anchor\'s own slot, although the engine would', () => {
    expect(swapOptions(card, 'top', office, work, 'off-01')).toEqual([]);
    expect(swapChoices({ items: card.items, score: 0, reasons: [], ruleIds: [] }, 'top', office, {}, work).length).toBeGreaterThan(0);
    expect(swapOptions(card, 'top', office, work).length).toBeGreaterThan(0); // without an anchor nothing changes
  });
  it('still offers the other slots', () => {
    expect(swapOptions(card, 'bottom', office, work, 'off-01')).toEqual(swapOptions(card, 'bottom', office, work));
    expect(swapOptions(card, 'footwear', office, work, 'off-01').length).toBeGreaterThan(0);
  });
  it('a swap keeps the anchor and the line that names it; the rules still hold', () => {
    const choice = swapOptions(card, 'bottom', office, work, 'off-01')[0]!;
    const r = applySwap(view, card.key, 'bottom', choice, office, work);
    const after = cards(r.view)[0]!;
    expect([r.ok, after.items.top, after.items.bottom, after.reasons[0], after.ruleIds[0], after.score]).toEqual([true, 'off-01', choice, 'Built around your White cotton shirt', 'ANCHOR', null]);
    expect(r.view).toMatchObject({ anchor: 'off-01', thin: false });
  });
  it('a choice that would push the anchor out (a Suit over the layer slot) is neither offered nor accepted', () => {
    const v = startView(office, formal, { anchor: 'off-14' });
    const c = cards(v)[0]!;
    expect(c.items.layer).toBe('off-14');
    expect(swapChoices({ items: c.items, score: 0, reasons: [], ruleIds: [] }, 'bottom', office, {}, formal)).toContain('off-17');
    expect(swapOptions(c, 'bottom', office, formal, 'off-14')).not.toContain('off-17');
    expect(applySwap(v, c.key, 'bottom', 'off-17', office, formal)).toMatchObject({ ok: false, problems: ['ANCHOR'] });
  });
  it('accepting or rejecting a card keeps the anchor on the view', () => {
    expect(markSaved(view, card.key)).toMatchObject({ anchor: 'off-01', thin: false });
    expect(reject(view, card.key)).toMatchObject({ anchor: 'off-01', cards: { length: 2 } });
  });
});
