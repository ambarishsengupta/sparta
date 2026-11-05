import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countryCode, countryOptions, currencyFor, currencyOptions, hemisphereFor, OTHER_COUNTRY, validateOnboarding } from './onboarding';

const GOOD = { country: 'IN', hemisphere: 'north', currency: 'INR' };
describe('validateOnboarding (FR-6, FR-9)', () => {
  it('accepts a full set of answers', () => { expect(validateOnboarding(GOOD, 'IN')).toEqual({}); });
  it('asks for the country when nothing is chosen', () => { expect(validateOnboarding({ ...GOOD, country: '' }, '').country).toBe('Choose your country.'); });
  it.each(['U', 'USA', 'u1', '1A', ' U', ''])('refuses the typed country %j', (typed) => {
    expect(validateOnboarding({ ...GOOD, country: countryCode(OTHER_COUNTRY, typed) }, OTHER_COUNTRY).country).toMatch(/two-letter country code/);
  });
  it('a typed code is trimmed and upper-cased: " us " becomes US', () => { expect(countryCode(OTHER_COUNTRY, ' us ')).toBe('US'); });
  it('a listed country is used as chosen', () => { expect(countryCode('IN', 'zz')).toBe('IN'); });
  it.each(['', 'east', 'North'])('refuses the hemisphere %j', (h) => { expect(validateOnboarding({ ...GOOD, hemisphere: h }, 'IN').hemisphere).toBeDefined(); });
  it.each(['', 'IN', 'inr', 'INRR'])('refuses the currency %j', (c) => { expect(validateOnboarding({ ...GOOD, currency: c }, 'IN').currency).toBeDefined(); });
  it('reports every problem at once', () => { expect(Object.keys(validateOnboarding({ country: '', hemisphere: '', currency: '' }, '')).sort()).toEqual(['country', 'currency', 'hemisphere']); });
  it('property: no errors exactly when the country is AA-ZZ, the hemisphere north or south and the currency AAA-ZZZ', () => {
    fc.assert(fc.property(fc.string({ maxLength: 4 }), fc.constantFrom('north', 'south', 'x', ''), fc.string({ maxLength: 4 }), (country, hemisphere, currency) => {
      const ok = /^[A-Z]{2}$/.test(country) && (hemisphere === 'north' || hemisphere === 'south') && /^[A-Z]{3}$/.test(currency);
      expect(Object.keys(validateOnboarding({ country, hemisphere, currency }, country === '' ? '' : OTHER_COUNTRY)).length === 0).toBe(ok);
    }));
  });
});

describe('pre-fills', () => {
  it('India is northern and uses INR', () => { expect(hemisphereFor('IN')).toBe('north'); expect(currencyFor('IN')).toBe('INR'); });
  it('Australia is southern', () => { expect(hemisphereFor('AU')).toBe('south'); });
  it('any other currency starts at USD, the database default', () => { expect(currencyFor('GB')).toBe('USD'); });
});

describe('option lists', () => {
  const names: Record<string, string> = { IN: 'India', AU: 'Australia' };
  it('countries are named and sorted by name; an unknown code keeps its code', () => {
    expect(countryOptions(['IN', 'ZZ', 'AU'], (c) => names[c])).toEqual([{ value: 'AU', label: 'Australia' }, { value: 'IN', label: 'India' }, { value: 'ZZ', label: 'ZZ' }]);
  });
  it('currencies are sorted by code and show their name', () => {
    expect(currencyOptions(['USD', 'INR'], (c) => ({ INR: 'Indian Rupee' })[c as 'INR'])).toEqual([{ value: 'INR', label: 'INR - Indian Rupee' }, { value: 'USD', label: 'USD - USD' }]);
  });
  it('the empty list of countries (the list could not be read) gives no options', () => { expect(countryOptions([], () => undefined)).toEqual([]); });
});
