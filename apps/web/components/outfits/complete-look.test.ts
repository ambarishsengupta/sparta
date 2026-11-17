/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WARDROBES } from '../../../../packages/rules/src/fixtures/wardrobes';
import type { StoredItem } from '../../lib/repository';
import { buildCtx, startView } from '../../lib/suggestions-view-model';
import type { Card } from '../../lib/suggestions-view-model';
import { ItemCard } from '../wardrobe/WardrobeList';
import { OutfitCard } from './OutfitCard';
import { UnlockPanel } from './UnlockPanel';

const src = import.meta.glob<string>(['./OutfitsView.tsx', '../wardrobe/WardrobeList.tsx'], { query: '?raw', import: 'default', eager: true });
const office = WARDROBES['Office regular']!;
const stored = new Map<string, StoredItem>(office.map((i) => [i.id, { ...i, hex: '#336699', fit: null, material: null, neverWorn: false, archiveReason: null, createdAt: '', updatedAt: '' }]));
const noop = () => undefined;
const v = startView(office, buildCtx('Work', 'north', new Date('2026-04-15T12:00:00Z')), { anchor: 'off-01' });
const card = (v.kind === 'cards' ? v.cards[0] : undefined) as Card;
const ENTRIES = [{ subType: 'Chinos', colourFamily: 'Navy', newOutfits: 6 }, { subType: 'Formal shoes', colourFamily: 'Brown', newOutfits: 1 }] as const;
/** Every button and link has visible text or an aria-label, and an aria-label that starts with the visible words (label in name). */
const names = (html: string) => [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({ label: /aria-label="([^"]+)"/.exec(m[2]!)?.[1], text: m[3]!.replace(/<[^>]*>/g, '').trim() }));

describe('Build outfits around this (FR-59a)', () => {
  const html = (id: string, status: 'active' | 'archived' = 'active') => renderToStaticMarkup(createElement(ItemCard, { item: { ...stored.get(id)!, status }, onArchive: noop, onRestore: noop }));
  it('is a named link to /outfits?anchor=<id> without prefetch, on an active shirt', () => {
    const h = html('off-01');
    const link = /<a ([^>]*)>Build outfits around this<\/a>/.exec(h)?.[1] ?? '';
    expect(link).toContain('href="/outfits?anchor=off-01"');
    expect(link).toContain('aria-label="Build outfits around this: White cotton shirt"');
    expect(src['../wardrobe/WardrobeList.tsx']).toMatch(/\/outfits\?anchor=\$\{item\.id\}`\} prefetch=\{false\}/);
  });
  it.each([['off-21', 'a belt'], ['off-23', 'a tie'], ['off-24', 'a watch']])('is not offered for %s (%s)', (id) => {
    expect(html(id)).not.toContain('Build outfits around this');
  });
  it('is not offered for an archived item', () => { expect(html('off-01', 'archived')).not.toContain('Build outfits around this'); });
});

describe('Complete the look screen and card', () => {
  it('the anchor chip has no Swap button and says it is the person\'s pick; the other pieces keep theirs', () => {
    const h = renderToStaticMarkup(createElement(OutfitCard, { card, index: 0, items: stored, onAccept: noop, onReject: noop, onSwap: noop, anchorId: 'off-01' }));
    expect(h).toContain('Top · your pick');
    expect(h).not.toContain('aria-label="Swap White cotton shirt"');
    expect(h).toContain(`aria-label="Swap ${stored.get(card.items.bottom!)!.name}"`);
    expect(names(h).every((n) => n.label || n.text)).toBe(true);
  });
  it('the page names the anchor in its heading, offers a way back, hides Swap on the anchor and reads the item from the address', () => {
    const s = src['./OutfitsView.tsx']!;
    expect(s).toContain('Complete the look{anchorName ?');
    expect(s).toContain('Back to normal suggestions');
    expect(s).toContain("new URLSearchParams(window.location.search).get('anchor')");
    expect(s).toContain('swapOptions(card, swap.slot, items!, ctx!, view.anchor)');
    expect(s).toContain('anchorId={view.anchor}');
  });
});

describe('Wardrobe unlock panel (FR-59b)', () => {
  const panel = (listed: string[] = []) => renderToStaticMarkup(createElement(UnlockPanel, { entries: ENTRIES, listed: new Set(listed), onAdd: noop }));
  it('lists each entry as "Add <colour> <sub-type>: N new outfits" with a named Add to wishlist button', () => {
    const h = panel();
    expect(h).toContain('Wardrobe unlock');
    expect(h).toContain('Add Navy Chinos: 6 new outfits');
    expect(h).toContain('Add Brown Formal shoes: 1 new outfit<');
    expect(names(h).filter((n) => n.text === 'Add to wishlist').map((n) => n.label)).toEqual(['Add to wishlist: Navy Chinos', 'Add to wishlist: Brown Formal shoes']);
  });
  it('shows attributes only: no picture, price or store', () => { expect(panel()).not.toMatch(/<img|<svg|£|\$|price|store|photo/i); });
  it('an entry already on the wishlist is marked and its button disabled; nothing renders for an empty list', () => {
    expect(panel(['Chinos|Navy'])).toMatch(/<button[^>]*disabled[^>]*aria-label="On wishlist: Navy Chinos"[^>]*>On wishlist<\/button>/);
    expect(renderToStaticMarkup(createElement(UnlockPanel, { entries: [], listed: new Set<string>(), onAdd: noop }))).toBe('');
  });
});
