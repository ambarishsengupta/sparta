/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WARDROBES } from '../../../../packages/rules/src/fixtures/wardrobes';
import { EventLog } from '../../lib/events';
import type { StoredItem } from '../../lib/repository';
import { applySwap, buildCtx, startView, swapOptions } from '../../lib/suggestions-view-model';
import type { Card } from '../../lib/suggestions-view-model';
import { OutfitCard } from './OutfitCard';
import { OutfitsView } from './OutfitsView';
import { SwapSheet } from './SwapSheet';

// WO-0050: the sign-in and session modules talk to the Supabase Auth service by design and are not on the suggestion path. They are
// named one by one (never a folder), so a new module under lib/ is still scanned, and lib/supabase/source.test.ts proves that no
// file scanned here imports any of them.
const sources = import.meta.glob<string>(
  [
    './*.tsx', '../../app/outfits/**/*.tsx', '../../lib/**/*.ts', '!../../lib/**/*.test.ts', '../use-repository.ts', '../use-learned.ts',
    '!../../lib/auth-form.ts', '!../../lib/supabase/auth-actions.ts', '!../../lib/supabase/browser.ts', '!../../lib/supabase/gate.ts',
    '!../../lib/supabase/gate-state.ts', '!../../lib/supabase/proxy-session.ts', '!../../lib/supabase/server.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);
const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|axios)\b|https?:\/\//;
const ctx = buildCtx('Work', 'north', new Date('2026-04-15T12:00:00Z'));
const items = WARDROBES['Office regular']!;
const stored = new Map<string, StoredItem>(items.map((i) => [i.id, { ...i, hex: '#336699', fit: null, material: null, neverWorn: false, archiveReason: null, createdAt: '', updatedAt: '' }]));
const view = startView(items, ctx);
const card = (view.kind === 'cards' ? view.cards[0] : undefined) as Card;
const noop = () => undefined;

/** Controls and landmarks in rendered HTML that have no accessible name (the same idea as components/wardrobe/a11y.test.ts). */
function unnamed(html: string): string[] {
  const out: string[] = [];
  const bare = (s: string) => s.replace(/<[^>]*>/g, '').trim();
  for (const m of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) if (!/aria-label="[^"]+"/.test(m[2]!) && bare(m[3]!) === '') out.push(`<${m[1]}${m[2]}>`);
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) if (bare(m[1]!) === '') out.push('empty label');
  for (const m of html.replace(/<label\b[\s\S]*?<\/label>/g, '').matchAll(/<input\b([^>]*)>/g)) if (!/aria-label="[^"]+"/.test(m[1]!)) out.push(`<input${m[1]}>`);
  for (const m of html.matchAll(/<(div|ul|section)\b([^>]*role="(meter|list)"[^>]*|[^>]*aria-labelledby="[^"]*"[^>]*)>/g)) if (!/aria-label(ledby)?="[^"]+"/.test(m[2]!)) out.push(`<${m[1]}${m[2]}>`);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('no request leaves the browser in the suggestion path (FR-59, CC4)', () => {
  it('finds the suggestion sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6);
  });
  it('covers every non-test file in lib, the repository hook, the demo loader and the local repository (WO-0022 item 2)', () => {
    const names = Object.keys(sources).map((f) => f.replace(/^.*\/(lib\/)/, '$1').replace(/^.*\/(use-repository\.ts)$/, 'components/$1'));
    for (const f of ['lib/local-repository.ts', 'lib/demo.ts', 'lib/events.ts', 'lib/repository.ts', 'lib/item-form.ts', 'lib/filters.ts', 'lib/suggestions-view-model.ts', 'lib/engine-config.ts', 'lib/wishlist.ts', 'components/use-repository.ts']) expect(names, f).toContain(f);
    expect(names.some((f) => f.endsWith('.test.ts'))).toBe(false);
  });
  it('none of them calls fetch, XHR, sendBeacon, a socket or names a URL, except the two fixed GETs of lib/engine-config.ts (WO-0012)', () => {
    for (const [file, text] of Object.entries(sources)) {
      let code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (file.endsWith('/lib/engine-config.ts')) code = code.replace('fetch(PRIOR_URL, init())', '').replace('fetch(UNLOCK_URL, init())', ''); // exactly these two calls, nowhere else
      expect(code.match(NETWORK), file).toBeNull();
    }
  });
  it('imports only React, Next links, the workspace packages and the app\'s own files', () => {
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/from '([^']+)'/g)) expect(m[1], file).toMatch(/^(\.|react|next\/link|@sparta\/(rules|taxonomy))/);
    }
  });
  it('asking, swapping and logging make no request when the network globals throw', () => {
    const boom = vi.fn(() => { throw new Error('network used'); });
    vi.stubGlobal('fetch', boom);
    vi.stubGlobal('XMLHttpRequest', boom);
    vi.stubGlobal('navigator', { sendBeacon: boom });
    const v = startView(items, ctx);
    const first = (v.kind === 'cards' ? v.cards[0] : undefined) as Card;
    const choice = swapOptions(first, 'bottom', items, ctx)[0]!;
    expect(applySwap(v, first.key, 'bottom', choice, items, ctx).ok).toBe(true);
    new EventLog(null).record('suggestion_swapped', { occasion: 'Work', slot: 'bottom' });
    expect(boom).not.toHaveBeenCalled();
  });
});

describe('outfits screen: accessible names (CC6)', () => {
  it('the checker flags an empty button, an unlabelled meter and an empty label', () => {
    expect(unnamed('<button type="button"></button>')).toHaveLength(1);
    expect(unnamed('<div role="meter"></div>')).toHaveLength(1);
    expect(unnamed('<label><input type="checkbox"/></label>')).toEqual(['empty label']);
    expect(unnamed('<input type="text"/>')).toHaveLength(1);
    expect(unnamed('<button aria-label="Swap shirt">Swap</button><label><input type="checkbox"/>South</label>')).toEqual([]);
  });
  it('the page has a named group of occasions, a named hemisphere toggle and one button per occasion', () => {
    const html = renderToStaticMarkup(createElement(OutfitsView));
    expect(html).toContain('<legend>Occasion</legend>');
    expect(html).toContain('Southern hemisphere');
    for (const o of ['Casual', 'Work', 'Formal', 'Party', 'Sport', 'Date', 'Travel']) expect(html).toMatch(new RegExp(`<button[^>]*aria-pressed="false"[^>]*>${o}</button>`));
    expect(unnamed(html)).toEqual([]);
  });
  it('every control on an outfit card has a name, and Accept, Reject and Swap say which outfit or piece', () => {
    const html = renderToStaticMarkup(createElement(OutfitCard, { card, index: 0, items: stored, onAccept: noop, onReject: noop, onSwap: noop }));
    expect(html).toContain('aria-label="Accept outfit 1"');
    expect(html).toContain('aria-label="Reject outfit 1"');
    expect(html).toContain('role="meter"');
    expect(html).toMatch(/aria-label="Swap [^"]+"/);
    expect(unnamed(html)).toEqual([]);
  });
  it('every control in the swap sheet has a name', () => {
    const choices = swapOptions(card, 'bottom', items, ctx);
    const html = renderToStaticMarkup(createElement(SwapSheet, { slot: 'bottom', choices, items: stored, onPick: noop, onClose: noop }));
    expect(html).toContain('Swap bottom');
    expect(html).toContain('>Cancel<');
    expect(html.match(/aria-label="Use /g)).toHaveLength(choices.length);
    expect(unnamed(html)).toEqual([]);
  });
  it('a saved card disables Accept and Reject and offers no Swap', () => {
    const html = renderToStaticMarkup(createElement(OutfitCard, { card: { ...card, saved: true }, index: 1, items: stored, onAccept: noop, onReject: noop, onSwap: noop }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Accept outfit 2"/);
    expect(html).not.toContain('>Swap<');
  });
});

describe('outfit card: reasons, duplicates and focus targets (WO-0022 items 5, 9, 10)', () => {
  const render = (c: Card, extra: { sameAs?: number | null } = {}) =>
    renderToStaticMarkup(createElement(OutfitCard, { card: c, index: 0, items: stored, onAccept: noop, onReject: noop, onSwap: noop, ...extra }));
  it('shows the top two reasons joined with a semicolon, and the rest inside a native details disclosure', () => {
    const html = render(card);
    expect(card.reasons.length).toBeGreaterThan(2);
    expect(html).toContain(`>${card.reasons[0]}; ${card.reasons[1]}</p>`);
    expect(html).toMatch(/<details><summary>Why this outfit\?<\/summary><ul[^>]*>/);
    const inside = html.slice(html.indexOf('<details>'), html.indexOf('</details>'));
    for (const r of card.reasons.slice(2)) expect(inside).toContain(r);
    for (const r of card.reasons.slice(0, 2)) expect(inside).not.toContain(r);
  });
  it('has no disclosure when there is nothing beyond the two reasons, e.g. a swapped card', () => {
    const html = render({ ...card, reasons: card.reasons.slice(0, 2), score: null });
    expect(html).not.toContain('<details>');
    expect(html).toContain(`${card.reasons[0]}; ${card.reasons[1]}`);
  });
  it('shows a plain "Same as outfit N" note only when told so', () => {
    expect(render(card, { sameAs: 2 })).toContain('Same as outfit 2');
    expect(render(card)).not.toContain('Same as outfit');
  });
  it('the heading can take focus (tabindex -1) and each Swap button names the slot it opens', () => {
    const html = render(card);
    expect(html).toMatch(/<h2 id="outfit-title-1" tabindex="-1"/);
    expect(html).toContain(`data-swap="${card.key}:top"`);
  });
});

describe('outfits screen: focus handling (WO-0022 item 5)', () => {
  const view = sources['./OutfitsView.tsx']!;
  it('moves focus to the card heading after Accept', () => {
    expect(view).toMatch(/markSaved\(v!, card\.key\)\);\s*document\.getElementById\(`outfit-title-\$\{n\}`\)\?\.focus\(\)/);
  });
  it('logs the swapped event from the card as it is after the swap, not the pre-swap card', () => {
    expect(view).toContain("events().record('suggestion_swapped', details(after, slot))");
    expect(view).not.toContain("'suggestion_swapped', details(card");
  });
  it('returns focus to the Swap button that opened the sheet once it is closed by Cancel, Escape or a pick', () => {
    expect(view).toContain('opener.current = `${card.key}:${slot}`');
    expect(view).toMatch(/swap === null && opener\.current[\s\S]*querySelector<HTMLElement>\(`\[data-swap="\$\{opener\.current\}"\]`\)\?\.focus\(\)/);
    expect(view).toMatch(/onClose=\{\(\) => setSwap\(null\)\}/);
    expect(view).toMatch(/const result = applySwap[\s\S]*setSwap\(null\);\s*\};/);
  });
});

describe('outfits screen: the unlock list gets the switches (Model QC Q34)', () => {
  it('OutfitsView asks for the unlock list through unlockFor with the learned data from the hook, and no longer builds options by hand', () => {
    const view = sources['./OutfitsView.tsx']!;
    expect(view).toContain('unlockFor(items, ctx, undefined, learned)'); // undefined = the real switches
    expect(view).toContain('const { learned, ready } = useLearned()');
    expect(view).not.toMatch(/unlockEntries\(/);
  });
  it('the line under "Complete the look" comes from anchorIntro, so it is never shown over zero outfits (WO-0014 item 2)', () => {
    const view = sources['./OutfitsView.tsx']!;
    expect(view).toContain('anchorIntro(view, occasion)');
    expect(view).not.toContain('keeps this item');
  });
});

describe('outfits screen: keyboard (CC6)', () => {
  const view = sources['./OutfitsView.tsx']!;
  const cardSource = sources['./OutfitCard.tsx']!;
  it('occasions and Accept are real buttons, so Tab, Enter and Space work', () => {
    expect(view).toMatch(/<button key=\{o\} type="button" aria-pressed/);
    expect(cardSource).toMatch(/<button type="button" className="primary"[^>]*onClick=\{onAccept\}/);
  });
  it('click handlers sit only on buttons, and nothing uses a positive tabindex', () => {
    for (const [file, text] of Object.entries(sources)) {
      expect(text.match(/<(div|span|li|p|section|ul)\b[^>]*onClick/g) ?? [], file).toEqual([]);
      expect(text, file).not.toMatch(/tabIndex=\{?["']?[1-9]/);
    }
  });
  it('the swap sheet takes focus when it opens and closes on Escape', () => {
    const sheet = sources['./SwapSheet.tsx']!;
    expect(sheet).toContain('heading.current?.focus()');
    expect(sheet).toMatch(/e\.key === 'Escape'\) onClose\(\)/);
  });
});
