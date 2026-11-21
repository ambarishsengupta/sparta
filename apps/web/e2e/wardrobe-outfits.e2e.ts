import { loadDemoWardrobe, reachWardrobe, expect, test } from './fixtures';
import { ensureDemoCatalogue, itemNamesOf, sql } from './support';

// WO-0169: the wardrobe, outfit and sharing flows (FDD 4 to 7 and FR-61), each test named after the FDD id it proves. What the user sees is checked on the page, and what the database
// holds is read back as postgres through the local-only helper. As in account-consent.e2e.ts, the strings are the app's own words, copied here on purpose.

const rowsOf = (email: string, table: 'items' | 'outfits' | 'outfit_items'): number =>
  Number(sql(`select count(*) from app.${table} t join auth.users u on u.id = t.user_id where u.email = :'e'`, { e: email }));

test('FR-22 and FR-28 an item added by hand appears in the wardrobe and is stored for the user', async ({ page, cast }) => {
  const user = await cast.provision('byhand');
  await reachWardrobe(page, user);
  await expect(page.getByText('Your wardrobe is empty.')).toBeVisible(); // the page loaded and the wardrobe really starts empty
  expect(itemNamesOf(user.email)).toEqual([]);
  await page.getByRole('link', { name: 'Add item' }).click();
  await expect(page.getByRole('button', { name: 'Save item' })).toBeEnabled();
  await page.getByLabel('Category').selectOption('Tops');
  await expect(page.getByLabel('Category')).toHaveValue('Tops');
  await page.getByLabel('Sub-type').selectOption('T-shirt');
  await page.getByLabel('Name').fill('Hand-made test tee');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: 'Hand-made test tee', exact: true })).toBeVisible();
  await expect(page.getByText('1 of 1 items')).toBeVisible();
  expect(itemNamesOf(user.email)).toEqual(['Hand-made test tee']);
  expect(sql(`select i.origin || '/' || i.category || '/' || i.sub_type from app.items i join auth.users u on u.id = i.user_id where u.email = :'e'`, { e: user.email })).toBe('manual/Tops/T-shirt');
});

test('FR-21 and FR-28 an item picked from the demo catalogue is pre-filled, saved with its catalogue link and shown in the wardrobe', async ({ page, cast }) => {
  cast.onRemove(ensureDemoCatalogue());
  const user = await cast.provision('catalogue');
  await reachWardrobe(page, user);
  await page.getByRole('link', { name: 'Add from catalogue' }).click();
  await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();
  await expect(page.getByText(/^\d+ shown/)).toBeVisible();
  await expect(page.getByText('The catalogue is empty for now.')).toHaveCount(0); // the seed is there, so the picker is not the empty state
  await page.getByLabel('Search by name or brand').fill('Crew tee - Ink black');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Choose Crew tee - Ink black' }).click();
  await expect(page.getByRole('heading', { name: 'Add item' })).toBeVisible();
  await expect(page.getByLabel('Category')).toHaveValue('Tops'); // pre-filled from the catalogue entry
  await expect(page.getByLabel('Sub-type')).toHaveValue('T-shirt');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: 'Crew tee - Ink black', exact: true })).toBeVisible();
  expect(itemNamesOf(user.email)).toEqual(['Crew tee - Ink black']);
  expect(sql(`select i.origin || '/' || (i.catalog_item_id is not null) from app.items i join auth.users u on u.id = i.user_id where u.email = :'e'`, { e: user.email })).toBe('catalogue/true');
});

test('FR-52 and FR-53 an outfit is suggested for an occasion, a swap keeps it valid, and Accept stores the outfit', async ({ page, cast }) => {
  const user = await cast.provision('outfit');
  await reachWardrobe(page, user);
  const added = await loadDemoWardrobe(page);
  expect(itemNamesOf(user.email)).toHaveLength(added);
  await page.getByRole('link', { name: 'Outfits', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible();
  await expect(page.getByText('Pick an occasion to see outfits from your wardrobe.')).toBeVisible();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const first = page.locator('li', { has: page.getByRole('heading', { name: 'Outfit 1' }) });
  await expect(first.getByRole('heading', { name: 'Outfit 1' })).toBeVisible();
  const pieces = first.getByRole('list', { name: 'Pieces in outfit 1' }).getByRole('listitem');
  expect(await pieces.count()).toBeGreaterThanOrEqual(2);
  const before = await pieces.allTextContents();
  // swap one piece: the sheet lists the choices that keep the outfit valid; pick the first
  await first.getByRole('button', { name: /^Swap / }).first().click();
  const sheet = page.getByRole('region', { name: /^Swap / });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /^Use / }).first().click();
  await expect(page.getByText(/^Swapped the .*\. The outfit still follows the rules\.$/)).toBeVisible();
  await expect(sheet).toHaveCount(0);
  expect(await pieces.allTextContents()).not.toEqual(before);
  await expect(first.getByText('Swapped by you, so it is not scored again.')).toBeVisible();
  // Accept stores the outfit in the account
  expect(rowsOf(user.email, 'outfits')).toBe(0);
  await first.getByRole('button', { name: 'Accept outfit 1' }).click();
  await expect(page.getByText('Outfit 1 saved.')).toBeVisible();
  await expect(first.getByRole('heading', { name: 'Outfit 1 (saved)' })).toBeVisible();
  expect(rowsOf(user.email, 'outfits')).toBe(1);
  expect(rowsOf(user.email, 'outfit_items')).toBeGreaterThanOrEqual(2);
});

test('FR-59a Complete the look keeps the anchor item in every outfit', async ({ page, cast }) => {
  const user = await cast.provision('anchor');
  await reachWardrobe(page, user);
  await loadDemoWardrobe(page);
  const card = page.locator('li.card.item').filter({ has: page.getByRole('link', { name: /^Build outfits around this/ }) }).first();
  const anchorName = (await card.locator('a.title').textContent())!.trim();
  await card.getByRole('link', { name: /^Build outfits around this/ }).click();
  await expect(page).toHaveURL(/\/outfits\?anchor=/);
  await expect(page.getByRole('heading', { name: `Complete the look around ${anchorName}` })).toBeVisible();
  await expect(page.getByText('Pick an occasion to build outfits around this item.')).toBeVisible();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await expect(page.getByText('Every outfit below keeps this item.')).toBeVisible();
  const outfits = page.getByRole('heading', { name: /^Outfit \d+$/ });
  const n = await outfits.count();
  expect(n).toBeGreaterThanOrEqual(1);
  for (let i = 1; i <= n; i++) { // every card holds the anchor, marked as the user's pick, with no Swap button on it
    const pieces = page.getByRole('list', { name: `Pieces in outfit ${i}` });
    const mine = pieces.getByRole('listitem').filter({ hasText: anchorName });
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('your pick');
    await expect(mine.getByRole('button', { name: /^Swap / })).toHaveCount(0);
  }
});

test('FR-61 the sharing setting is shown on and locked, and its reason opens on request', async ({ page, cast }) => {
  await reachWardrobe(page, await cast.provision('sharing'));
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Sharing' })).toBeVisible();
  const box = page.getByRole('checkbox', { name: 'Share anonymised group figures (on for everyone in the pilot)' });
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();
  const reason = 'The pilot is a study that needs anonymised data from its participants to work, so sharing is on for everyone taking part. You can leave any time with Leave the pilot. The full version of Sparta is planned to let you turn this off.';
  await expect(page.getByText(reason)).toBeHidden(); // the page is loaded (the box is there) and the reason is not on show yet
  await page.getByText("Why can't I switch this off?").click();
  await expect(page.getByText(reason)).toBeVisible();
});

test('FR-16 deleting an item removes it and its image from storage', async ({ page, cast }) => {
  const user = await cast.provision('delete');
  await reachWardrobe(page, user);
  await page.getByRole('link', { name: 'Add item' }).click();
  await expect(page.getByRole('button', { name: 'Save item' })).toBeEnabled();
  await page.getByLabel('Category').selectOption('Tops');
  await expect(page.getByLabel('Category')).toHaveValue('Tops');
  await page.getByLabel('Sub-type').selectOption('T-shirt');
  await page.getByLabel('Name').fill('Tee to delete');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: 'Tee to delete', exact: true })).toBeVisible();
  // setup: an image and a thumbnail in the user's own folder of item-images (Storage API under the user's own login; the worker is not needed), and the item points at both
  const image = await cast.storeFile(user, 'e2e-item-image.png');
  const thumb = await cast.storeFile(user, 'e2e-item-thumb.png');
  sql(`update app.items i set image_path = :'a', image_thumb_path = :'b' from auth.users u where u.id = i.user_id and u.email = :'e' and i.name = 'Tee to delete'`, { a: image, b: thumb, e: user.email });
  const objects = (): number => Number(sql(`select count(*) from storage.objects where bucket_id = 'item-images' and name in (:'a', :'b')`, { a: image, b: thumb }));
  const rows = (): number => Number(sql(`select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email = :'e' and i.name = 'Tee to delete'`, { e: user.email }));
  expect([rows(), objects()]).toEqual([1, 2]); // proven to exist before the deletion
  await page.reload();
  await page.getByRole('link', { name: 'Tee to delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save item' })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByText('Delete this item permanently?')).toBeVisible(); // the existing confirmation
  expect([rows(), objects()]).toEqual([1, 2]); // nothing is deleted before it is confirmed
  await page.getByRole('button', { name: 'Delete item permanently' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('link', { name: 'Tee to delete', exact: true })).toHaveCount(0);
  // read-only query: the row and both objects are gone
  expect(rows()).toBe(0);
  expect(objects()).toBe(0);
});
