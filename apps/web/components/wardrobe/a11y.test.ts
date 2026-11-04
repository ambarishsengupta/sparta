/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ItemForm } from './ItemForm';
import { WardrobeList } from './WardrobeList';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

const FIELDS = new Set(['input', 'select', 'textarea']);
/** Controls (input, select, textarea, button, a) in rendered HTML that have no accessible name: no label text, aria-label or text. */
export function unnamed(html: string): string[] {
  type Frame = { tag: string; attrs: string; text: string; controls: string[] };
  const out: string[] = [];
  const stack: Frame[] = [];
  const forIds = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi)) {
    const [, close, tag = '', attrs = '', , text] = m;
    if (text !== undefined) { if (!stack.some((f) => f.tag === 'select')) stack.forEach((f) => (f.text += text)); continue; }
    const named = /aria-label(ledby)?="[^"]+"/.test(attrs) || forIds.has(/\sid="([^"]+)"/.exec(attrs)?.[1]) || /type="hidden"/.test(attrs);
    if (!close && FIELDS.has(tag) && !named) {
      const label = [...stack].reverse().find((f) => f.tag === 'label');
      if (label) label.controls.push(tag); else out.push(`<${tag}${attrs}> has no label`);
    }
    if (close) {
      const f = stack.pop();
      if (f?.tag === 'label' && f.text.trim() === '') out.push(...f.controls.map((c) => `<${c}> inside an empty label`));
      if ((f?.tag === 'button' || f?.tag === 'a') && f.text.trim() === '' && !/aria-label/.test(f.attrs)) out.push(`<${f.tag}${f.attrs}> has no text`);
    } else if (!['input', 'br', 'meta', 'link', 'img'].includes(tag) && !m[0].endsWith('/>')) stack.push({ tag, attrs, text: '', controls: [] });
  }
  return out;
}

const render = (c: Parameters<typeof createElement>[0]) => renderToStaticMarkup(createElement(c as never));
describe('forms and list: accessible names (CC6)', () => {
  it('the checker flags an unlabelled input, an empty label and an empty button', () => {
    expect(unnamed('<input type="text"/>')).toHaveLength(1);
    expect(unnamed('<label><input type="checkbox"/></label>')).toHaveLength(1);
    expect(unnamed('<button type="button"></button>')).toHaveLength(1);
    expect(unnamed('<label>Name<input type="text"/></label><button>Save</button>')).toEqual([]);
  });
  it('every control in the item form has a name', () => {
    const html = render(ItemForm);
    expect(html).toContain('Rate condition');
    expect(unnamed(html)).toEqual([]);
  });
  it('every control in the wardrobe list and its filters has a name', () => {
    const html = render(WardrobeList);
    expect(html).toContain('Load demo wardrobe');
    expect(unnamed(html)).toEqual([]);
  });
});

const sources = import.meta.glob<string>(['../**/*.tsx', '../../app/**/*.tsx'], { query: '?raw', import: 'default', eager: true });
describe('keyboard operation (CC6)', () => {
  it('finds the component sources', () => { expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6); });
  it('no click handler sits on a non-interactive element, and no positive tabindex is used', () => {
    for (const [file, text] of Object.entries(sources)) {
      expect(text.match(/<(div|span|li|p|section)\b[^>]*onClick/g) ?? [], file).toEqual([]);
      expect(text, file).not.toMatch(/tabIndex=\{?["']?[1-9]/);
    }
  });
});
