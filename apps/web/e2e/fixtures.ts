import { expect, test as base, type Page } from '@playwright/test';
import { isLocalUrl } from '../test-support/e2e-local';
import { Cast, type SyntheticUser } from './support';

/** `cast` holds the synthetic users of one test. Its teardown runs after a failed test too, and it fails the test if a user could not be removed. */
export const test = base.extend<{ cast: Cast }>({
  cast: async ({ baseURL }, provide) => {
    if (!baseURL || !isLocalUrl(baseURL)) throw new Error('end-to-end tests refuse to run: the app is not at a local address.');
    const cast = new Cast();
    try { await provide(cast); } finally { await cast.remove(); }
  },
});
export { expect };

// ---- the screens, driven as a person would (labels and buttons, no test ids: the app has none) ----
export async function signIn(page: Page, user: SyntheticUser): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** FR-2 and FR-68: both ticks, then Continue. Ends on the pilot notice. */
export async function acceptTerms(page: Page): Promise<void> {
  await page.getByLabel('I am 18 or over.').check();
  await page.getByLabel('I agree to the Terms of Use and the Privacy Policy.').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/pilot-notice$/);
}

export async function joinPilot(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'I understand and join the pilot' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

/** FR-6 and FR-9: a country of the pilot's list (by its name), or one that is not listed (by its two-letter code). Skips the optional start choice. */
export async function onboard(page: Page, country: { listed: string } | { code: string }): Promise<void> {
  if ('listed' in country) await page.getByLabel('Country', { exact: true }).selectOption({ label: country.listed });
  else {
    await page.getByLabel('Country', { exact: true }).selectOption({ label: 'My country is not listed' });
    await page.getByLabel('Country code (two letters, for example US)').fill(country.code);
  }
  await page.getByRole('button', { name: 'Skip' }).click();
}

/** From a confirmed account to the wardrobe: sign in, the two ticks, the pilot notice, onboarding in a supported country. */
export async function reachWardrobe(page: Page, user: SyntheticUser): Promise<void> {
  await signIn(page, user);
  await expect(page).toHaveURL(/\/accept-terms$/);
  await acceptTerms(page);
  await joinPilot(page);
  await onboard(page, { listed: 'India' });
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('heading', { name: 'Wardrobe' })).toBeVisible();
}
