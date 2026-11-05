/** Onboarding answers (FR-6, FR-9): validation and the pre-fills. The server checks the same shapes again in app.complete_onboarding. */
export const OTHER_COUNTRY = 'other';
export type OnboardingErrors = { country?: string; hemisphere?: string; currency?: string };
export interface OnboardingAnswers { country: string; hemisphere: string; currency: string }

/** The country the answers name: the chosen code, or the typed two-letter code when "My country is not listed" is chosen. */
export const countryCode = (choice: string, typed: string): string => (choice === OTHER_COUNTRY ? typed.trim().toUpperCase() : choice);

export function validateOnboarding(a: OnboardingAnswers, choice: string): OnboardingErrors {
  const errors: OnboardingErrors = {};
  if (choice === '') errors.country = 'Choose your country.';
  else if (!/^[A-Z]{2}$/.test(a.country)) errors.country = 'Enter the two-letter country code, for example US.';
  if (a.hemisphere !== 'north' && a.hemisphere !== 'south') errors.hemisphere = 'Choose the northern or the southern hemisphere.';
  if (!/^[A-Z]{3}$/.test(a.currency)) errors.currency = 'Choose your currency.';
  return errors;
}

/** Countries lying mostly in the southern hemisphere; a rough guide for the pre-fill only, and the person can change it (FR-6). */
const SOUTH = new Set(['AU', 'NZ', 'ZA', 'AR', 'CL', 'UY', 'PY', 'BO', 'PE', 'BR']);
export const hemisphereFor = (country: string): 'north' | 'south' => (SOUTH.has(country) ? 'south' : 'north');
/** The pilot country's currency; anything else starts at USD, the database default (profiles.currency), and can be changed. */
export const currencyFor = (country: string): string => (country === 'IN' ? 'INR' : 'USD');

export interface Option { value: string; label: string }
/** Pilot countries as value and name, sorted by name. A code the display names do not know keeps the code as its name. */
export function countryOptions(codes: readonly string[], nameOf: (code: string) => string | undefined): Option[] {
  return codes.map((c) => ({ value: c, label: nameOf(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
/** Currencies as `INR - Indian Rupee`, sorted by code. */
export function currencyOptions(codes: readonly string[], nameOf: (code: string) => string | undefined): Option[] {
  return [...codes].sort().map((c) => ({ value: c, label: `${c} - ${nameOf(c) ?? c}` }));
}
