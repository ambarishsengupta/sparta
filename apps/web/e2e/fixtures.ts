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
  // Workaround, not a fix: a choice made before the page is hydrated is lost when React takes over (the Country box then shows as invalid and Skip changes nothing; seen once in a
  // busy full run, reported as an app finding in WO-0169). So the step is repeated, at most 4 times with 4 seconds each (16 s, inside the 30-second test timeout), then it fails clearly.
  for (let attempt = 1; attempt <= 4; attempt++) {
    if ('listed' in country) await page.getByLabel('Country', { exact: true }).selectOption({ label: country.listed });
    else {
      await page.getByLabel('Country', { exact: true }).selectOption({ label: 'My country is not listed' });
      await page.getByLabel('Country code (two letters, for example US)').fill(country.code);
    }
    await page.getByRole('button', { name: 'Skip' }).click();
    try { await expect(page).not.toHaveURL(/\/onboarding$/, { timeout: 4_000 }); return; } catch { /* hydration may have dropped the choice: try again */ }
  }
  throw new Error('onboarding did not finish after 4 attempts of 4 seconds each: the form still shows after the country was chosen and Skip was pressed');
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

/** The wardrobe's own "Load demo wardrobe" button (the first demo wardrobe of the list): gives the user a set of items the outfit rules can work with. Returns how many items it added. */
export async function loadDemoWardrobe(page: Page): Promise<number> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wardrobe' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Load demo wardrobe' });
  await expect(button).toBeEnabled(); // the repository is ready
  await button.click();
  const note = page.getByText(/^Added \d+ items\.$/);
  await expect(note).toBeVisible();
  return Number(/\d+/.exec((await note.textContent()) ?? '')?.[0]);
}
