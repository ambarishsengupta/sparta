import { E2E_CONTACT_EMAIL } from '../test-support/e2e-local';
import { acceptTerms, expect, joinPilot, onboard, reachWardrobe, signIn, test } from './fixtures';
import { countUsers, verifyLink } from './support';

// WO-0168: the account and consent flows of FDD 1 to 3 (FR-1 to FR-9, FR-67, FR-68, NFR-2), each test named after the FDD id it proves.
// The strings below are the app's own words (lib/consent-form.ts, lib/supabase/auth-actions.ts), copied here on purpose: a test that imports them would pass when they changed.

test('FR-1 an invited address signs up, confirms with the emailed link and reaches the age and Terms screen', async ({ page, cast }) => {
  const user = cast.create('invited');
  cast.invite(user.email);
  await page.goto('/sign-up');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/check-your-email$/);
  // FR-1: email is verified before the first login completes, so signing in with the new account does not work yet
  await signIn(page, user);
  await expect(page.locator('form').getByRole('alert')).toHaveText('Your email is not confirmed yet. Open the link in the message we sent you, then sign in.');
  await expect(page).toHaveURL(/\/sign-in$/);
  // the same browser follows the link from the local mail catcher (it holds the one-time sign-in verifier)
  await page.goto(await verifyLink(user.email));
  await expect(page).toHaveURL(/\/accept-terms$/);
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  // email and password now work for signing in again
  await page.context().clearCookies();
  await signIn(page, user);
  await expect(page).toHaveURL(/\/accept-terms$/);
});

test('FR-8 an uninvited address is refused at sign-up with the invitation-only message', async ({ page, cast }) => {
  const user = cast.create('uninvited');
  await page.goto('/sign-up');
  await expect(page.getByText('Sparta is invitation-only during the pilot: sign up with the address your invitation was sent to.')).toBeVisible();
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Sparta is invitation-only during the pilot.'); // the form's own alert (the page also has a route announcer)
  await expect(page).toHaveURL(/\/sign-up$/);
  expect(countUsers(user.email)).toBe(0);
});

test('FR-2 and FR-68 the age and Terms ticks are required before the pilot notice', async ({ page, cast }) => {
  await signIn(page, await cast.provision('ticks'));
  await expect(page).toHaveURL(/\/accept-terms$/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Confirm that you are 18 or over to continue.')).toBeVisible();
  await expect(page.getByText('Tick the box to agree to the Terms of Use and the Privacy Policy.')).toBeVisible();
  await page.getByLabel('I am 18 or over.').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Confirm that you are 18 or over to continue.')).toHaveCount(0); // the age error is gone, only the terms error is left
  await expect(page.getByText('Tick the box to agree to the Terms of Use and the Privacy Policy.')).toBeVisible();
  await expect(page).toHaveURL(/\/accept-terms$/);
  await page.getByLabel('I am 18 or over.').uncheck(); // and the other way round: terms ticked, age not
  await page.getByLabel('I agree to the Terms of Use and the Privacy Policy.').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Confirm that you are 18 or over to continue.')).toBeVisible();
  await expect(page.getByText('Tick the box to agree to the Terms of Use and the Privacy Policy.')).toHaveCount(0);
  await expect(page).toHaveURL(/\/accept-terms$/);
  await page.goto('/pilot-notice'); // the notice cannot be reached around the ticks
  await expect(page).toHaveURL(/\/accept-terms$/);
  await acceptTerms(page);
});

test('FR-3 and FR-4 the pilot notice blocks until accepted, and No thanks leaves only export, Leave the pilot and sign out', async ({ page, cast }) => {
  const user = await cast.provision('notice');
  await signIn(page, user);
  await acceptTerms(page);
  await expect(page.getByRole('heading', { name: 'Welcome to the Sparta pilot' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  await expect(page.getByRole('main').getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
  for (const path of ['/', '/outfits', '/settings']) { // nothing else opens while the notice is open
    await page.goto(path);
    await expect(page).toHaveURL(/\/pilot-notice$/);
  }
  await expect(page.getByRole('button', { name: 'Export my data' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leave the pilot' })).toBeVisible();
  await page.getByRole('button', { name: 'No thanks, sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, user); // the notice is shown again at the next sign-in
  await expect(page).toHaveURL(/\/pilot-notice$/);
  await joinPilot(page);
});

test('FR-9 an unsupported country is sent to /not-available and offered only export, Leave the pilot and sign out', async ({ page, cast }) => {
  await signIn(page, await cast.provision('country'));
  await acceptTerms(page);
  await joinPilot(page);
  await onboard(page, { code: 'US' });
  await expect(page).toHaveURL(/\/not-available$/);
  await expect(page.getByRole('heading', { name: 'The pilot is not open in your country yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export my data' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leave the pilot' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto('/'); // the app cannot be used from here
  await expect(page).toHaveURL(/\/not-available$/);
});

test('NFR-2 sign out and sign in as a second user on the same browser shows none of the first user\'s data or queued changes', async ({ page, cast }) => {
  const first = await cast.provision('first');
  const second = await cast.provision('second');
  const itemName = 'Private shirt of the first user';

  await reachWardrobe(page, first);
  await page.getByRole('link', { name: 'Add item' }).click();
  await expect(page.getByRole('button', { name: 'Save item' })).toBeEnabled(); // the form is hydrated and its repository is ready
  await page.getByLabel('Category').selectOption('Tops');
  await expect(page.getByLabel('Category')).toHaveValue('Tops');
  await page.getByLabel('Sub-type').selectOption({ index: 1 });
  await page.getByLabel('Name').fill(itemName);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: itemName, exact: true })).toBeVisible();
  const keysOf = (): Promise<string[]> => page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('sparta.')));
  expect((await keysOf()).some((k) => k.startsWith('sparta.events.'))).toBe(true); // the first user's usage log exists (so the check below is not vacuous)

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await keysOf()).toEqual([]);
  expect(await page.evaluate(async () => (await window.indexedDB.databases()).map((d) => d.name))).toEqual([]);

  await signIn(page, second);
  await expect(page).toHaveURL(/\/accept-terms$/); // the second user is a new person: nothing of the first user's progress carries over
  await acceptTerms(page);
  await joinPilot(page);
  await onboard(page, { listed: 'India' });
  await expect(page.getByRole('heading', { name: 'Wardrobe' })).toBeVisible();
  await expect(page.getByText('Your wardrobe is empty.')).toBeVisible();
  await expect(page.getByText(itemName)).toHaveCount(0);
  expect(await keysOf()).toEqual([]); // nothing queued or logged for the first user is read back
  expect(await page.evaluate(async () => (await window.indexedDB.databases()).map((d) => d.name))).toEqual([]);
});

test('FR-67 the About page shows the privacy contact address', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'Privacy contact' })).toBeVisible();
  const link = page.getByRole('link', { name: E2E_CONTACT_EMAIL });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `mailto:${E2E_CONTACT_EMAIL}`);
});
