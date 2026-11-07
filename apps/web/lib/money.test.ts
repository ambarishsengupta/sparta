import { describe, expect, it } from 'vitest';
import { convert, formatPrice, secondaryPrice } from './money';
import type { FxRates } from './money';

const rates: FxRates = { USD: { rateDate: '2026-11-05', perUsd: 1 }, EUR: { rateDate: '2026-11-05', perUsd: 0.9 }, INR: { rateDate: '2026-10-01', perUsd: 84 } };

describe('formatPrice (FR-33)', () => {
  it('uses Intl.NumberFormat in the stored currency', () => {
    expect(formatPrice(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatPrice(1234.5, 'EUR', 'de-DE')).toBe('1.234,50 €');
    expect(formatPrice(500, 'JPY', 'en-US')).toBe('¥500');
  });
  it('shows a currency code Intl does not know as digits and the code', () => { expect(formatPrice(3, 'ZZ', 'en-US')).toBe('3.00 ZZ'); });
});

describe('convert: amount / per_usd[from] * per_usd[to] (glossary)', () => {
  it('converts with both rows and rounds to two places', () => {
    expect(convert(90, 'EUR', 'USD', rates)).toEqual({ amount: 100, rateDate: '2026-11-05' });
    expect(convert(10, 'USD', 'INR', rates)?.amount).toBe(840);
    expect(convert(1, 'EUR', 'INR', rates)?.amount).toBe(93.33); // 1 / 0.9 * 84 = 93.333...
  });
  it('shows the older rate date as it is, however stale', () => { expect(convert(10, 'USD', 'INR', rates)?.rateDate).toBe('2026-10-01'); });
  it('is null when either currency has no row, or a rate is not positive', () => {
    expect(convert(10, 'GBP', 'USD', rates)).toBeNull();
    expect(convert(10, 'USD', 'GBP', rates)).toBeNull();
    expect(convert(10, 'USD', 'EUR', { ...rates, EUR: { rateDate: 'x', perUsd: 0 } })).toBeNull();
  });
});

describe('secondaryPrice', () => {
  it('says the converted amount and the rate date', () => { expect(secondaryPrice(90, 'EUR', 'USD', rates, 'en-US')).toBe('about $100.00 at the rate of 2026-11-05'); });
  it('adds nothing for the same currency or a missing rate', () => {
    expect(secondaryPrice(90, 'EUR', 'EUR', rates)).toBeNull();
    expect(secondaryPrice(90, 'GBP', 'USD', rates)).toBeNull();
    expect(secondaryPrice(90, 'EUR', 'USD', {})).toBeNull();
  });
});
