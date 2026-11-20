import { describe, expect, it } from 'vitest';
import { loadBrandLabels } from './brands';

// WO-0155: the brand label map. A fake client stands in for the typed browser client; a failed read is an empty map (the screens then keep the guessed label), never a throw.
type Answer = { data: unknown; error: { message: string } | null };
const client = (answer: () => Promise<Answer>) => {
  const seen: string[] = [];
  const c = { schema: (s: string) => ({ from: (t: string) => ({ select: (cols: string) => { seen.push(`${s}.${t}:${cols}`); return answer(); } }) }) };
  return { c: c as unknown as Parameters<typeof loadBrandLabels>[0], seen };
};

describe('loadBrandLabels', () => {
  it('reads code and label of catalog.lk_brand once and keys the map by code', async () => {
    const { c, seen } = client(async () => ({ data: [{ code: 'demo-h-and-m', label: 'H&M' }, { code: 'demo-zor-vane', label: 'Zor Vane' }], error: null }));
    const m = await loadBrandLabels(c);
    expect(seen).toEqual(['catalog.lk_brand:code, label']);
    expect(m.get('demo-h-and-m')).toBe('H&M');
    expect(m.size).toBe(2);
  });
  it('a row without a usable label is left out (the guess is used for it)', async () => {
    const { c } = client(async () => ({ data: [{ code: 'a', label: '' }, { code: 'b', label: 'B' }, { code: 7, label: 'x' }], error: null }));
    expect([...(await loadBrandLabels(c))]).toEqual([['b', 'B']]);
  });
  it('an error answer, a rejection, a throw and a wrong shape each give an empty map and no error', async () => {
    for (const a of [async () => ({ data: null, error: { message: 'internal detail' } }), async () => { throw new TypeError('fetch failed'); }, async () => ({ data: { not: 'a list' }, error: null })]) {
      expect((await loadBrandLabels(client(a).c)).size).toBe(0);
    }
    const throwing = { schema: () => { throw new Error('no client'); } } as unknown as Parameters<typeof loadBrandLabels>[0];
    expect((await loadBrandLabels(throwing)).size).toBe(0);
  });
});
