// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Delight effects on "popular items": picks shared with the Wardrobe tab badge,
// the fly-to-tab dot and petal burst, and their absence under reduced motion.
import { expect, type Page, test } from "@playwright/test";

const badge = (page: Page) => page.locator('[data-fly-target="wardrobe"] .tab-badge');

test("adding items counts on the Wardrobe tab and survives tab changes", async ({ page }) => {
  await page.goto("/wardrobe/popular");
  await expect(badge(page)).toHaveCount(0);

  const first = page.getByRole("button", { name: /^Add / }).first();
  const name = (await first.getAttribute("aria-label"))!.replace(/^Add /, "");
  await first.click();
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(badge(page)).toHaveText("1");
  await expect(page.getByRole("status")).toContainText("added to your wardrobe");

  await page.getByRole("link", { name: "Outfits", exact: true }).click();
  await expect(page).toHaveURL(/\/outfits$/);
  await expect(badge(page)).toHaveText("1");

  await page.goto("/wardrobe/popular");
  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(badge(page)).toHaveCount(0);
});

test("an add sends a dot to the tab and scatters petals, then cleans up", async ({ page }) => {
  await page.goto("/wardrobe/popular");
  await page.getByRole("button", { name: /^Add / }).first().click();
  await expect(page.locator(".delight-dot")).toHaveCount(1);
  expect(await page.locator(".delight-petal").count()).toBeGreaterThan(0);
  await expect(page.locator(".delight-dot, .delight-petal")).toHaveCount(0, { timeout: 3000 });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no flying dot or petals, but the add still counts", async ({ page }) => {
    await page.goto("/wardrobe/popular");
    await page.getByRole("button", { name: /^Add / }).first().click();
    await expect(badge(page)).toHaveText("1");
    expect(await page.locator(".delight-dot, .delight-petal").count()).toBe(0);
  });
});
