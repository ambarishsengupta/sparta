/** Settings (FR-61, FR-66): the profile fields a person may change, checked before they are sent. The database checks them again. */
export const MAX_NAME = 60;
/** The columns a person may change on their own profile (the database grants no others). */
export interface ProfilePatch { display_name: string | null; hemisphere: 'north' | 'south'; currency: string; occasions: string[] }
export interface SettingsInput { displayName: string; hemisphere: string; currency: string; occasions: string[] }
export type SettingsErrors = { displayName?: string; hemisphere?: string; currency?: string };

const hasControl = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export function validateSettings(i: SettingsInput, currencies: readonly string[]): SettingsErrors {
  const errors: SettingsErrors = {};
  const name = i.displayName.trim();
  if ([...name].length > MAX_NAME) errors.displayName = `Use ${MAX_NAME} characters or fewer.`;
  else if (hasControl(name)) errors.displayName = 'Use letters, numbers and punctuation only.';
  if (i.hemisphere !== 'north' && i.hemisphere !== 'south') errors.hemisphere = 'Choose the northern or the southern hemisphere.';
  if (!currencies.includes(i.currency)) errors.currency = 'Choose your currency.';
  return errors;
}

/** The update to send. An empty display name is stored as no name. */
export function settingsPatch(i: SettingsInput): ProfilePatch {
  const name = i.displayName.trim();
  return { display_name: name === '' ? null : name, hemisphere: i.hemisphere as 'north', currency: i.currency, occasions: i.occasions };
}
