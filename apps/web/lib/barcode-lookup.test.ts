import { describe, expect, it, vi } from 'vitest';
import { BARCODE_INVALID, addOwnWithBarcode, lookupBarcode, noMatch, severalMatches } from './barcode-lookup';
import { catalogueFromRow } from './catalogue';

const row = (n: number) => catalogueFromRow({ id: `5c1b3b52-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Tee ${n}`, brand: 'Zorvane', category: 'Tops', sub_type: 'T-shirt', colour_hex: '#111111', product_url: 'http://127.0.0.1/p' })!;

describe('lookupBarcode (FR-26)', () => {
  it('sends only the padded 14-digit code to the catalogue, whatever was typed', async () => {
    const byGtin = vi.fn(async () => [] as ReturnType<typeof row>[]);
    await lookupBarcode({ byGtin }, ' 4006381 333931 ');
    await lookupBarcode({ byGtin }, '12345670');
    await lookupBarcode({ byGtin }, '036000-291452');
    expect(byGtin.mock.calls).toEqual([['04006381333931'], ['00000012345670'], ['00036000291452']]);
  });
  it('does not ask the catalogue at all for something that is not a barcode number', async () => {
    const byGtin = vi.fn(async () => [] as ReturnType<typeof row>[]);
    for (const raw of ['', 'abc', '123', '4006381333931x', '12345678901234567']) expect(await lookupBarcode({ byGtin }, raw)).toEqual({ kind: 'invalid' });
    expect(byGtin).not.toHaveBeenCalled();
  });
  it('one match is "one", several are "many" in the order given, none is "none" with the padded code kept', async () => {
    expect(await lookupBarcode({ byGtin: async () => [row(1)] }, '4006381333931')).toEqual({ kind: 'one', gtin: '04006381333931', item: row(1) });
    expect(await lookupBarcode({ byGtin: async () => [row(2), row(1)] }, '4006381333931')).toEqual({ kind: 'many', gtin: '04006381333931', items: [row(2), row(1)] });
    expect(await lookupBarcode({ byGtin: async () => [] }, '4006381333931')).toEqual({ kind: 'none', gtin: '04006381333931' });
  });
  it('a failing catalogue read is not turned into "none" (the error reaches the caller)', async () => {
    await expect(lookupBarcode({ byGtin: async () => { throw new Error('down'); } }, '4006381333931')).rejects.toThrow('down');
  });
  it('the sentences and the manual-entry link carry the padded code', () => {
    expect(BARCODE_INVALID).toMatch(/8, 12, 13 or 14 digits/);
    expect(noMatch('04006381333931')).toContain('04006381333931');
    expect(severalMatches(3, '04006381333931')).toMatch(/^3 catalogue items have the barcode 04006381333931/);
    expect(addOwnWithBarcode('04006381333931')).toBe('/items/new?barcode=04006381333931');
  });
});
