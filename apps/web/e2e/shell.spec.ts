// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { settle, TABS, tokenRgb } from "./helpers";

test.describe("app shell", () => {
  test("bottom bar under 1024 px, 96 px rail at 1024 px and over", async ({ page }) => {
    await page.goto("/wardrobe");
    const viewport = page.viewportSize()!;
    const nav = page.getByRole("navigation", { name: "Main" });
    const box = (await nav.boundingBox())!;

    if (viewport.width < 1024) {
      expect(box.width).toBe(viewport.width);
      expect(Math.round(box.y + box.height)).toBe(viewport.height);
    } else {
      expect(box.x).toBe(0);
      expect(box.width).toBe(96);
      expect(box.height).toBe(viewport.height);
    }
  });

  test("five tabs in FDD order, icon plus label, 48 px targets", async ({ page }) => {
    await page.goto("/wardrobe");
    const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(links).toHaveText(TABS.map((t) => t.label));
    for (const link of await links.all()) {
      await expect(link.locator("svg")).toHaveCount(1);
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
  });

  for (const tab of TABS) {
    test(`${tab.label}: active pill in its pop colour`, async ({ page }) => {
      await page.goto(tab.href);
      await settle(page);
      const link = page.getByRole("link", { name: tab.label, exact: true });
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[aria-current="page"]')).toHaveCount(1);

      const pill = link.locator("span[aria-hidden]").first();
      const fill = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(fill).toBe(await tokenRgb(page, tab.pop));
      expect(await pill.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(tab.label);
    });
  }

  test("navigating moves the current tab", async ({ page }) => {
    await page.goto("/wardrobe");
    await page.getByRole("link", { name: "Outfits", exact: true }).click();
    await expect(page).toHaveURL(/\/outfits$/);
    await expect(page.getByRole("link", { name: "Outfits", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Wardrobe", exact: true })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("root redirects to wardrobe", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/wardrobe$/);
  });

  test("no horizontal scroll", async ({ page }) => {
    for (const tab of TABS) {
      await page.goto(tab.href);
      const [scroll, client] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scroll, tab.href).toBe(client);
    }
  });

  test("skip link is first, visible on focus, and moves focus to main", async ({ page }) => {
    await page.goto("/wardrobe");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("keyboard focus shows a 2 px ring in the focus colour", async ({ page }) => {
    await page.goto("/wardrobe");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // first tab
    const focused = page.getByRole("link", { name: "Wardrobe", exact: true });
    await expect(focused).toBeFocused();
    const style = await focused.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor };
    });
    expect(style).toEqual({ width: "2px", style: "solid", color: await tokenRgb(page, "focus") });
  });

  test("no focus ring on pointer click", async ({ page }) => {
    await page.goto("/wardrobe");
    const link = page.getByRole("link", { name: "Wishlist", exact: true });
    await link.click();
    await expect(page).toHaveURL(/\/wishlist$/);
    const active = page.locator(":focus-visible");
    await expect(active).toHaveCount(0);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("tab pill and empty-state scene do not animate", async ({ page }) => {
    await page.goto("/wardrobe?state=empty");
    const pill = page
      .getByRole("link", { name: "Wardrobe", exact: true })
      .locator("span[aria-hidden]")
      .first();
    const duration = await pill.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    );
    expect(duration).toBeLessThanOrEqual(0.001);
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((a) => {
          const t = a.effect?.getComputedTiming();
          return a.playState === "running" && (t?.duration as number) > 1;
        }).length,
    );
    expect(running).toBe(0);
  });
});

test("UI copy has no em-dashes", () => {
  const copy = readFileSync(path.join(__dirname, "../lib/i18n/messages/en.json"), "utf8");
  expect(copy).not.toContain("—");
});
