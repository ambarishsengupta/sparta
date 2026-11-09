// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// First-impression fixes: a working main action, no faded buttons, a pause control
// for the always-moving background (WCAG 2.2.2) and category filters on the grid.
import { expect, test } from "@playwright/test";

import { settle } from "./helpers";

test("Wardrobe main action opens popular items", async ({ page }) => {
  await page.goto("/wardrobe");
  const cta = page.getByRole("link", { name: "Start from popular items" });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/wardrobe\/popular$/);
  await expect(page.getByRole("list").filter({ has: page.locator("article") })).toBeVisible();
});

test("not-yet-available actions are labels, not faded buttons", async ({ page }) => {
  for (const [path, label] of [
    ["/outfits", "Suggest an outfit"],
    ["/wishlist", "Add to wishlist"],
    ["/purchases", "Scan a receipt"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    await expect(page.getByText(`${label}, coming soon`)).toBeVisible();
  }
});

test("Calm switch pauses the background loops and is remembered", async ({ page }) => {
  await page.goto("/wardrobe");
  await settle(page);
  const toggle = page.getByRole("button", { name: "Pause background animation" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  const runningLoops = () =>
    page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.effect?.getComputedTiming().iterations === Infinity && a.playState === "running",
          ).length,
    );
  expect(await runningLoops()).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "calm");
  await expect.poll(runningLoops).toBe(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "calm");
  await expect(page.getByRole("button", { name: "Pause background animation" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("category chips filter the popular grid", async ({ page }) => {
  await page.goto("/wardrobe/popular");
  const tiles = page.locator("article");
  const all = await tiles.count();
  expect(all).toBeGreaterThan(0);

  const chips = page.getByRole("group", { name: "Filter by category" });
  await expect(chips.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");

  await chips.getByRole("button", { name: /^Shoes/ }).click();
  await expect(chips.getByRole("button", { name: /^Shoes/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const shoes = await tiles.count();
  expect(shoes).toBeGreaterThan(0);
  expect(shoes).toBeLessThan(all);

  await chips.getByRole("button", { name: /^All/ }).click();
  await expect(tiles).toHaveCount(all);
});
