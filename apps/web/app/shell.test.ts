import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Nav } from '../components/Nav';
import { metadata } from './layout';

const path = vi.hoisted(() => ({ now: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.now }));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('app shell (WO-0022 items 5 and 6)', () => {
  it.each([['/', 'Wardrobe', 'Outfits'], ['/outfits', 'Outfits', 'Wardrobe']])('on %s only the %s link is marked aria-current="page"', (at, on, off) => {
    path.now = at;
    const html = renderToStaticMarkup(createElement(Nav));
    expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${on}</a>`));
    expect(html).not.toMatch(new RegExp(`<a[^>]*aria-current[^>]*>${off}</a>`));
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
  it('on a page that is in neither link nothing is marked', () => {
    path.now = '/items/new';
    expect(renderToStaticMarkup(createElement(Nav))).not.toContain('aria-current');
  });
  it('declares an icon that exists in public/, so /favicon.ico is not requested', () => {
    expect(metadata.icons).toEqual({ icon: '/icon.svg' });
    expect(existsSync(new URL('../public/icon.svg', import.meta.url))).toBe(true);
  });
  it('wardrobe item links do not prefetch, so item ids are not sent in prefetch requests', () => {
    expect(read('../components/wardrobe/WardrobeList.tsx')).toMatch(/<Link href=\{`\/items\/\$\{item\.id\}`\} prefetch=\{false\}/);
  });
});
