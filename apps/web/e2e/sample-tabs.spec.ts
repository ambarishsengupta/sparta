// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Every tab opens on labelled sample content, with a way to the real empty screen,
// and items picked on "popular items" show up in Wardrobe.
import { expect, test } from "@playwright/test";

const NOTE = "Sample data for the demo. Your own items will replace it.";

for (const [path, content] of [
  ["/wardrobe", "Oxford button-down shirt, regular fit"],
  ["/outfits", "Weekend brunch"],
  ["/wishlist", "Merino crew-neck jumper"],
  ["/purchases", "White leather low-top sneakers"],
] as const) {
  test(`${path} shows sample content and links to its empty screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(NOTE)).toBeVisible();
    await expect(page.getByText(content).first()).toBeVisible();

    await page.getByRole("link", { name: "See the empty screen" }).click();
    await expect(page).toHaveURL(`${path}?state=empty`);
    await expect(page.getByText(NOTE)).toHaveCount(0);
  });
}

test("an item picked on popular items appears in Wardrobe as new", async ({ page }) => {
  await page.goto("/wardrobe");
  // Next keeps visited pages in the DOM (hidden), so count visible tiles only.
  const visibleTiles = page.locator("main article").filter({ visible: true });
  const before = await visibleTiles.count();

  await page.getByRole("link", { name: "Add from popular items" }).click();
  await expect(page).toHaveURL(/\/wardrobe\/popular$/);
  // Merino jumper is not in the sample wardrobe, so it is a genuinely new item.
  await page.getByRole("button", { name: "Add Merino crew-neck jumper" }).click();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Wardrobe", exact: true })
    .click();
  await expect(page).toHaveURL(/\/wardrobe$/);
  const fresh = visibleTiles.filter({ hasText: "Merino crew-neck jumper" });
  await expect(fresh).toBeVisible();
  await expect(fresh.getByText("New", { exact: true })).toBeVisible();
  await expect(visibleTiles).toHaveCount(before + 1);
});
