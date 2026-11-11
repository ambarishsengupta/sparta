import { describe, expect, it } from 'vitest';
import { GTIN_LENGTHS, normaliseGtin, padGtin } from './gtin';

describe('normaliseGtin and padGtin (FR-26, LLD 8.2)', () => {
  it('accepts exactly 8, 12, 13 and 14 digits', () => {
    expect(GTIN_LENGTHS).toEqual([8, 12, 13, 14]);
    for (let n = 1; n <= 20; n++) expect(normaliseGtin('7'.repeat(n)) !== null, `${n} digits`).toBe([8, 12, 13, 14].includes(n));
  });
  it('pads to 14 digits with zeros on the left and keeps a 14-digit code as it is', () => {
    expect(padGtin('12345670')).toBe('00000012345670');
    expect(padGtin('036000291452')).toBe('00036000291452');
    expect(padGtin('4006381333931')).toBe('04006381333931');
    expect(padGtin('04006381333931')).toBe('04006381333931');
  });
  it('drops spaces and hyphens a person types, and nothing else', () => {
    expect(normaliseGtin(' 4006381 333931\n')).toBe('4006381333931');
    expect(normaliseGtin('4006-3813-33931')).toBe('4006381333931');
    for (const raw of ['', '   ', 'abc12345', '4006381333931x', '4006381.333931', '+4006381333931', '٤٠٠٦٣٨١٣٣٣٩٣١', '4006381333931\u0000', '1e1234567']) expect(normaliseGtin(raw), raw).toBeNull();
  });
  it('padGtin gives null for anything that is not a barcode number, and the result always matches the database check', () => {
    expect(padGtin('123')).toBeNull();
    expect(padGtin('12345678901234567')).toBeNull();
    for (const n of [8, 12, 13, 14]) expect(padGtin('9'.repeat(n))).toMatch(/^[0-9]{14}$/);
  });
});
