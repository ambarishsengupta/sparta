import { describe, expect, it } from 'vitest';
import { CONTACT_MAX, NAME_MAX, TAKEDOWN_NOTE_MAX, TERMS_MAX, URL_MAX, checkDateOk, mayAllow, parseReview, parseSource, parseTakedown, siteUrlOk, sourceIdOf } from './admin-catalog';

const NOW = new Date('2026-11-12T10:00:00Z');
const GOOD = { name: 'Demo shop', site_url: 'https://shop.example.test/', robots_allowed: true, terms_note: 'Terms read: feed allowed.', checked_on: '2026-11-10' };
const ID = '0b3f7a52-6c1e-4f55-9a53-2d1f0a7a9c11';

describe('siteUrlOk: https anywhere, http on this machine only', () => {
  it.each(['https://shop.example.test/', 'https://a.example.test/x?y=1', 'http://127.0.0.1/', 'http://127.0.0.1:8080/demo', 'http://localhost:3000/', 'http://[::1]/'])('accepts %s', (u) => { expect(siteUrlOk(u)).toBe(true); });
  it.each(['http://shop.example.test/', 'http://127.0.0.1.example.test/', 'http://localhost.example.test/', 'ftp://shop.example.test/', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@shop.example.test/',
    'https://@shop.example.test/', '//shop.example.test', 'shop.example.test', '', 'https://', 42, null, undefined])('refuses %s', (u) => { expect(siteUrlOk(u)).toBe(false); });
  it('refuses an address over the length cap', () => { expect(siteUrlOk(`https://a.example.test/${'x'.repeat(URL_MAX)}`)).toBe(false); expect(siteUrlOk(`https://a.example.test/${'x'.repeat(URL_MAX - 24)}`)).toBe(true); });
});

describe('checkDateOk: a real date, not in the future', () => {
  it.each(['2026-11-12', '2026-11-13', '2024-02-29', '2000-01-01'])('accepts %s', (d) => { expect(checkDateOk(d, NOW)).toBe(true); });
  it.each(['2026-11-14', '2027-01-01', '2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-10', '2026-1-10', '2026-11-10T00:00:00Z', '', 'today', 20261110, null])('refuses %s', (d) => { expect(checkDateOk(d, NOW)).toBe(false); });
});

describe('mayAllow (Data Sourcing Policy section 4)', () => {
  it('needs robots_allowed true, a non-blank terms note and a check date', () => {
    expect(mayAllow(GOOD)).toBe(true);
    expect(mayAllow({ ...GOOD, robots_allowed: false })).toBe(false);
    expect(mayAllow({ ...GOOD, robots_allowed: 'true' })).toBe(false);
    expect(mayAllow({ ...GOOD, terms_note: '' })).toBe(false);
    expect(mayAllow({ ...GOOD, terms_note: '   \n' })).toBe(false);
    expect(mayAllow({ ...GOOD, checked_on: '' })).toBe(false);
    expect(mayAllow({ robots_allowed: true, terms_note: 'x' })).toBe(false);
    expect(mayAllow({ ...GOOD, terms_note: undefined })).toBe(false);
  });
});

describe('parseSource: create', () => {
  const create = (b: unknown) => parseSource(b, 'create', NOW);
  it('accepts the five required fields and fills allowed false and no contact', () => {
    expect(create(GOOD)).toEqual({ ok: true, value: { fields: { ...GOOD, allowed: false, contact: null } } });
  });
  it('trims text, keeps a contact and accepts allowed true (the route decides whether it may)', () => {
    const r = create({ ...GOOD, name: '  Demo shop ', contact: ' a@b.example.test ', allowed: true });
    expect(r).toMatchObject({ ok: true, value: { fields: { name: 'Demo shop', contact: 'a@b.example.test', allowed: true } } });
  });
  it.each(['name', 'site_url', 'robots_allowed', 'terms_note', 'checked_on'])('refuses a body without %s', (k) => { const b: Record<string, unknown> = { ...GOOD }; delete b[k]; expect(create(b).ok).toBe(false); });
  it.each([
    ['an unknown key', { ...GOOD, takedown_at: null }], ['an id', { ...GOOD, id: 3 }], ['a blank name', { ...GOOD, name: '  ' }], ['a name over the cap', { ...GOOD, name: 'n'.repeat(NAME_MAX + 1) }],
    ['a control character in the name', { ...GOOD, name: 'a\nb' }], ['a numeric name', { ...GOOD, name: 5 }], ['a bad site', { ...GOOD, site_url: 'http://shop.example.test/' }],
    ['robots as text', { ...GOOD, robots_allowed: 'yes' }], ['terms over the cap', { ...GOOD, terms_note: 't'.repeat(TERMS_MAX + 1) }], ['terms as a number', { ...GOOD, terms_note: 1 }],
    ['a future date', { ...GOOD, checked_on: '2027-01-01' }], ['a contact over the cap', { ...GOOD, contact: 'c'.repeat(CONTACT_MAX + 1) }], ['allowed as text', { ...GOOD, allowed: 'true' }],
    ['null', null], ['an array', [GOOD]], ['text', 'x'], ['nothing', undefined],
  ])('refuses %s', (_n, b) => { expect(create(b).ok).toBe(false); });
  it('accepts a blank terms note on a source that is not allowed, and the exact caps', () => {
    expect(create({ ...GOOD, terms_note: '' }).ok).toBe(true);
    expect(create({ ...GOOD, name: 'n'.repeat(NAME_MAX), terms_note: 't'.repeat(TERMS_MAX), contact: 'c'.repeat(CONTACT_MAX) }).ok).toBe(true);
  });
});

describe('parseSource: update', () => {
  const update = (b: unknown) => parseSource(b, 'update', NOW);
  it('needs a positive integer id and at least one field', () => {
    expect(update({ id: 4, name: 'New name' })).toEqual({ ok: true, value: { id: 4, fields: { name: 'New name' } } });
    expect(update({ id: 4, allowed: true, contact: null })).toEqual({ ok: true, value: { id: 4, fields: { allowed: true, contact: null } } });
    for (const b of [{ name: 'x' }, { id: 4 }, { id: 0, name: 'x' }, { id: -1, name: 'x' }, { id: 1.5, name: 'x' }, { id: '4', name: 'x' }, { id: 4, takedown_at: null }, { id: 4, takedown_note: 'x' },
      { id: 4, last_collected_at: null }, { id: 4, name: '' }, { id: 4, site_url: 'ftp://x' }]) expect(update(b).ok, JSON.stringify(b)).toBe(false);
  });
});

describe('sourceIdOf and parseTakedown', () => {
  it('reads digits only, as a positive integer that fits the column', () => {
    expect(sourceIdOf('7')).toBe(7);
    expect(sourceIdOf('2147483647')).toBe(2147483647);
    for (const raw of ['0', '-1', '07', '1.5', '1e3', ' 7', '7 ', 'abc', '', '2147483648', '12345678901', '7;drop', '7/../8']) expect(sourceIdOf(raw), raw).toBeNull();
  });
  it('a take-down note is optional, trimmed and at most 500 characters', () => {
    expect(parseTakedown(undefined)).toEqual({ ok: true, value: { note: null } });
    expect(parseTakedown({})).toEqual({ ok: true, value: { note: null } });
    expect(parseTakedown({ note: '  Asked by the rights holder.  ' })).toEqual({ ok: true, value: { note: 'Asked by the rights holder.' } });
    expect(parseTakedown({ note: 'n'.repeat(TAKEDOWN_NOTE_MAX) }).ok).toBe(true);
    expect(parseTakedown({ note: 'n'.repeat(TAKEDOWN_NOTE_MAX + 1) }).ok).toBe(false);
    for (const b of [null, [], 'x', { note: 4 }, { note: 'x', allowed: true }, { reason: 'x' }]) expect(parseTakedown(b).ok, JSON.stringify(b)).toBe(false);
  });
});

describe('parseReview: active needs a category and sub-type pair of the taxonomy', () => {
  it('accepts a withdraw and a matching pair', () => {
    expect(parseReview({ id: ID, decision: 'withdraw' })).toEqual({ ok: true, value: { id: ID, decision: 'withdraw' } });
    expect(parseReview({ id: ID, decision: 'activate', category: 'Tops', sub_type: 'T-shirt' })).toEqual({ ok: true, value: { id: ID, decision: 'activate', category: 'Tops', subType: 'T-shirt' } });
  });
  it.each([
    ['a sub-type of another category', { id: ID, decision: 'activate', category: 'Tops', sub_type: 'Jeans' }], ['an unknown category', { id: ID, decision: 'activate', category: 'Hats', sub_type: 'T-shirt' }],
    ['a missing sub-type', { id: ID, decision: 'activate', category: 'Tops' }], ['a missing category', { id: ID, decision: 'activate', sub_type: 'T-shirt' }],
    ['a pair on a withdraw', { id: ID, decision: 'withdraw', category: 'Tops', sub_type: 'T-shirt' }], ['another decision', { id: ID, decision: 'delete' }], ['no decision', { id: ID }],
    ['a bad id', { id: '1', decision: 'withdraw' }], ['an upper-case id', { id: ID.toUpperCase(), decision: 'withdraw' }], ['an extra key', { id: ID, decision: 'activate', category: 'Tops', sub_type: 'T-shirt', status: 'active' }],
    ['null', null], ['text', 'x'],
  ])('refuses %s', (_n, b) => { expect(parseReview(b).ok).toBe(false); });
});
