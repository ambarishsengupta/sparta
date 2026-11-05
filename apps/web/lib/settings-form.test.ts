import { describe, expect, it } from 'vitest';
import { MAX_NAME, settingsPatch, validateSettings, type SettingsInput } from './settings-form';

const OK: SettingsInput = { displayName: 'Asha', hemisphere: 'north', currency: 'INR', occasions: ['Work'] };
const CURRENCIES = ['INR', 'USD'];

describe('validateSettings (FR-6)', () => {
  it('accepts good answers, an empty name and a name of exactly the limit', () => {
    expect(validateSettings(OK, CURRENCIES)).toEqual({});
    expect(validateSettings({ ...OK, displayName: '' }, CURRENCIES)).toEqual({});
    expect(validateSettings({ ...OK, displayName: 'é'.repeat(MAX_NAME) }, CURRENCIES)).toEqual({});
  });
  it('refuses a name over the limit (counted in characters), a name with a control character, an unknown hemisphere and an unlisted currency', () => {
    expect(validateSettings({ ...OK, displayName: 'x'.repeat(MAX_NAME + 1) }, CURRENCIES).displayName).toBeDefined();
    expect(validateSettings({ ...OK, displayName: 'a\u0000b' }, CURRENCIES).displayName).toBeDefined();
    expect(validateSettings({ ...OK, displayName: 'a\nb' }, CURRENCIES).displayName).toBeDefined();
    expect(validateSettings({ ...OK, hemisphere: '' }, CURRENCIES).hemisphere).toBeDefined();
    expect(validateSettings({ ...OK, hemisphere: 'east' }, CURRENCIES).hemisphere).toBeDefined();
    expect(validateSettings({ ...OK, currency: 'EUR' }, CURRENCIES).currency).toBeDefined();
    expect(validateSettings({ ...OK, currency: '' }, CURRENCIES).currency).toBeDefined();
  });
});

describe('settingsPatch', () => {
  it('sends only the four columns a person may change, a trimmed name, and null for an empty name', () => {
    expect(settingsPatch({ ...OK, displayName: '  Asha  ' })).toEqual({ display_name: 'Asha', hemisphere: 'north', currency: 'INR', occasions: ['Work'] });
    expect(settingsPatch({ ...OK, displayName: '   ' }).display_name).toBeNull();
    expect(Object.keys(settingsPatch(OK)).sort()).toEqual(['currency', 'display_name', 'hemisphere', 'occasions']);
  });
});
