import { readFileSync } from 'node:fs';
import { expect, loadDemoWardrobe, reachWardrobe, signIn, test } from './fixtures';
import { countInvitationsOf, itemNamesOf, rowsOfUser, userIdOf, type Cast, type SyntheticUser } from './support';
import type { Page } from '@playwright/test';

// WO-0169: the data-rights flows of FDD 8 (export FR-62, delete account FR-63, Leave the pilot FR-66). Each test reads the database as postgres through the local-only helper, so it
// proves what is stored and what is gone, not only what the page says. The app's own words are copied here on purpose.
// Delete account and Leave the pilot are one screen in the app (FR-66 runs "the same deletion as FR-63"), so the two tests share the flow below.

const NO_MATCH = 'That email and password do not match. Check them and try again.';

/** A signed-in user with a wardrobe, a saved outfit and a stored file, so that what a deletion removes is really there before it runs. Ends on the wardrobe. */
async function userWithData(page: Page, cast: Cast, label: string): Promise<{ user: SyntheticUser; id: string }> {
  const user = await cast.provision(label);
  await reachWardrobe(page, user);
  await loadDemoWardrobe(page);
  await page.getByRole('link', { name: 'Outfits', exact: true }).click();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await page.getByRole('button', { name: 'Accept outfit 1' }).click();
  await expect(page.getByText('Outfit 1 saved.')).toBeVisible();
  await cast.storeFile(user);
  const id = userIdOf(user.email);
  expect(id).not.toBe('');
  const held = rowsOfUser(id);
  expect(held.app).toBeGreaterThan(5); // profile, consent and acceptance records, items, the outfit and its pieces
  expect(held.storage).toBe(1);
  expect(countInvitationsOf(user.email)).toBe(1);
  return { user, id };
}

/** Settings, then the Leave the pilot link, then the password and the confirming button. Ends on the goodbye page. */
async function leave(page: Page, password: string): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Leave the pilot' }).click();
  await expect(page).toHaveURL(/\/leave$/);
  await page.getByLabel('Your password').fill(password);
  await page.getByRole('button', { name: 'Delete my account and leave the pilot' }).click();
  try { await expect(page).toHaveURL(/\/goodbye$/, { timeout: 20_000 }); } catch (e) {
    const said = (await page.getByRole('alert').filter({ hasText: /\S/ }).allTextContents()).join(' | ');
    // the purge route needs the local stack's server-only key in the server's environment; playwright.config.ts does not pass it (see the WO-0169 report)
    throw new Error(`Leave the pilot did not reach the goodbye page; the page says: ${said || '(no alert)'}. If it says files could not be removed, start the run with the local stack's server-only key in the environment of the run.`, { cause: e });
  }
  await expect(page.getByRole('heading', { name: 'You have left the pilot' })).toBeVisible();
}

/** The sign-in screen's real refusal for an account that no longer exists: the page stays on /sign-in with the app's own message. */
async function expectSignInRefused(page: Page, user: SyntheticUser): Promise<void> {
  await signIn(page, user);
  await expect(page.locator('form').getByRole('alert')).toHaveText(NO_MATCH);
  await expect(page).toHaveURL(/\/sign-in$/);
}

test('FR-63 deleting the account removes its rows, files and invitation, and sign-in with the same email and password is refused', async ({ page, cast }) => {
  const { user, id } = await userWithData(page, cast, 'delete');
  await leave(page, user.password);
  expect(userIdOf(user.email)).toBe(''); // the account row is gone
  expect(rowsOfUser(id)).toEqual({ app: 0, storage: 0 }); // every app row and every stored file of the user
  expect(countInvitationsOf(user.email)).toBe(0); // the email is no longer in ops.invitations
  await expectSignInRefused(page, user);
});

test('FR-66 Leave the pilot needs the password, asks no reason, says how long deletion takes, and then sign-in fails', async ({ page, cast }) => {
  const { user, id } = await userWithData(page, cast, 'leave');
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Leave the pilot' }).click();
  await expect(page).toHaveURL(/\/leave$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel(/reason/i)).toHaveCount(0); // no reason is asked
  // a wrong password deletes nothing
  await page.getByLabel('Your password').fill(`${user.password}-wrong`);
  await page.getByRole('button', { name: 'Delete my account and leave the pilot' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That password is not right, so nothing was deleted. Check it and try again.' })).toBeVisible();
  await expect(page).toHaveURL(/\/leave$/);
  expect(userIdOf(user.email)).toBe(id);
  expect(rowsOfUser(id).app).toBeGreaterThan(5);
  // the right password deletes
  await leave(page, user.password);
  await expect(page.getByText('Deletion is complete within 7 days at the latest, and copies in our encrypted backups are gone within 30 days; they are never restored.')).toBeVisible();
  expect(userIdOf(user.email)).toBe('');
  expect(rowsOfUser(id)).toEqual({ app: 0, storage: 0 });
  await expectSignInRefused(page, user);
});

test('FR-62 Export my data downloads a file that holds the user\'s items and none of another user\'s', async ({ page, cast }) => {
  const user = await cast.provision('export');
  const other = await cast.provision('other');
  await reachWardrobe(page, user);
  const added = await loadDemoWardrobe(page);
  const names = itemNamesOf(user.email);
  expect(names).toHaveLength(added);
  expect(names.length).toBeGreaterThan(3);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Export my data' });
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^sparta-export-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText(`Your data was saved as ${download.suggestedFilename()}.`)).toBeVisible();
  const path = await download.path();
  const text = readFileSync(path, 'utf8'); // the content of the file, not only its name
  const doc = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(doc).length).toBeGreaterThan(1);
  for (const name of names) expect(text).toContain(JSON.stringify(name).slice(1, -1));
  expect(text).toContain(user.email);
  expect(text).not.toContain(other.email);
  expect(text).not.toContain(user.password);
});

