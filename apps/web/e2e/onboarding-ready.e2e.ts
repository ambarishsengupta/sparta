import type { Page } from '@playwright/test';
import { acceptTerms, expect, joinPilot, signIn, test } from './fixtures';

// WO-0185 (FR-6, FR-9, NFR-4): the onboarding form is a controlled React form, so a choice made in the server-rendered HTML before the page is hydrated used to be replaced by the empty state when React took over.
// The fix keeps the controls disabled until the form has hydrated and marks the form `data-ready="true"` then. These tests hold the page's JavaScript back with a route, so the page stays un-hydrated for as long as the test wants.

/** Opens /onboarding with every script file of the page held back. Returns the function that lets them through. */
async function openHeld(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => { await gate; await route.continue(); });
  await page.goto('/onboarding', { waitUntil: 'commit' });
  await expect(page.getByLabel('Country', { exact: true })).toBeVisible(); // the server-rendered form is there, the scripts are not
  return release;
}

/** A user who is one step from the questions: signed in, ticks done, pilot joined. */
async function reachOnboarding(page: Page, name: string, cast: { provision(n: string): Promise<Parameters<typeof signIn>[1]> }): Promise<void> {
  await signIn(page, await cast.provision(name));
  await expect(page).toHaveURL(/\/accept-terms$/);
  await acceptTerms(page);
  await joinPilot(page);
}

test('FR-6 and FR-9 a country chosen before the page is ready is not lost, and Skip then goes on', async ({ page, cast }) => {
  await reachOnboarding(page, 'early', cast);
  const release = await openHeld(page);
  const country = page.getByLabel('Country', { exact: true });
  // A person on a slow phone tries at once. Either the form takes the choice and must keep it, or it refuses it (disabled until ready); a short timeout tells the two apart.
  const accepted = await country.selectOption({ label: 'India' }, { timeout: 1_500 }).then(() => true, () => false);
  if (!accepted) await expect(country).toBeDisabled(); // refused for the right reason: the control is disabled, not some other failure of selectOption
  release();
  await page.waitForLoadState('load');
  // React's own mark on a hydrated element. Kept on purpose: the form of the code before WO-0185 has no data-ready, and the run against it needs a signal that does not depend on the fix.
  await page.waitForFunction(() => { const el = document.getElementById('ob-country'); return el !== null && Object.keys(el).some((k) => k.startsWith('__reactProps$')); }, undefined, { timeout: 10_000 })
    .catch((e: unknown) => { throw new Error('React never took over the onboarding form', { cause: e }); });
  // The select can still show the early choice after hydration while the form's state is empty, so what proves the choice is kept is what Skip does, not what the box shows.
  if (accepted) await expect(country).toHaveValue('IN');
  else { await expect(page.locator('form.form')).toHaveAttribute('data-ready', 'true'); await country.selectOption({ label: 'India' }); } // refused early: choose again once the form says it is ready
  await expect(country).toHaveValue('IN');
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('heading', { name: 'Wardrobe' })).toBeVisible();
});

test('FR-6 and FR-9 before the page is ready every control and the three buttons are disabled and the form is marked not ready; once ready all are enabled', async ({ page, cast }) => {
  await reachOnboarding(page, 'disabled', cast);
  const release = await openHeld(page);
  const form = page.locator('form.form');
  await expect(form).toHaveAttribute('data-ready', 'false');
  await expect(page.getByLabel('Country', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Hemisphere (decides the seasons)')).toBeDisabled();
  await expect(page.getByLabel('Preferred currency')).toBeDisabled();
  for (const name of ['Start from popular items', 'Add my own', 'Skip']) await expect(page.getByRole('button', { name })).toBeDisabled();
  release();
  await expect(form).toHaveAttribute('data-ready', 'true');
  await expect(page.getByLabel('Country', { exact: true })).toBeEnabled();
  for (const name of ['Start from popular items', 'Add my own', 'Skip']) await expect(page.getByRole('button', { name })).toBeEnabled();
});
