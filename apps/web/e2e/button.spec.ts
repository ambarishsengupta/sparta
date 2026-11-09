// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// The six interaction states on Button (plan 3.5), measured on /specimen.
import { expect, test, type Locator } from "@playwright/test";

import { settle, tokenRgb } from "./helpers";

const style = (el: Locator) =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      // Tailwind v4 moves elements with the `translate` property, not `transform`.
      translate: s.translate,
      // Tailwind composes box-shadow from five layers; keep the visible ones.
      shadow: s.boxShadow
        .split(/,(?![^(]*\))/)
        .map((layer) => layer.trim())
        .filter((layer) => layer !== "none" && !layer.startsWith("rgba(0, 0, 0, 0)"))
        .join(", "),
      opacity: s.opacity,
      cursor: s.cursor,
      outlineWidth: s.outlineWidth,
      outlineOffset: s.outlineOffset,
      outlineColor: s.outlineColor,
    };
  });

const UP_1PX = "0px -1px";
const DOWN_1PX = "0px 1px";

test.beforeEach(async ({ page }) => {
  await page.goto("/specimen");
  await settle(page);
});

test("rest: token fill, no shadow, not moved", async ({ page }) => {
  const btn = page.getByTestId("btn-primary");
  const s = await style(btn);
  expect(s.translate).toBe("none");
  expect(s.shadow).toBe("");
  expect(await btn.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(
    await tokenRgb(page, "tangerine"),
  );
});

test("hover: 3 px ink offset shadow, up 1 px", async ({ page }) => {
  const btn = page.getByTestId("btn-primary");
  await btn.hover();
  await expect.poll(async () => (await style(btn)).translate).toBe(UP_1PX);
  const s = await style(btn);
  const ink = await tokenRgb(page, "ink");
  expect(s.shadow).toBe(`${ink} 3px 3px 0px 0px`);
});

test("focus: 2 px ring, 2 px offset, keyboard only", async ({ page }) => {
  const btn = page.getByTestId("btn-primary");
  await btn.click();
  expect((await style(btn)).outlineWidth).not.toBe("2px");
  await btn.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(btn).toBeFocused();
  const s = await style(btn);
  expect(s.outlineWidth).toBe("2px");
  expect(s.outlineOffset).toBe("2px");
  expect(s.outlineColor).toBe(await tokenRgb(page, "focus"));
});

test("pressed: down 1 px, no shadow", async ({ page }) => {
  const btn = page.getByTestId("btn-primary");
  await btn.hover();
  await page.mouse.down();
  await expect.poll(async () => (await style(btn)).translate).toBe(DOWN_1PX);
  expect((await style(btn)).shadow).toBe("");
  await page.mouse.up();
});

test("disabled: 45% opacity, no shadow, not-allowed cursor", async ({ page }) => {
  const btn = page.getByTestId("btn-disabled");
  await expect(btn).toBeDisabled();
  await btn.hover({ force: true });
  const s = await style(btn);
  expect(s.opacity).toBe("0.45");
  expect(s.shadow).toBe("");
  expect(s.translate).toBe("none");
  expect(s.cursor).toBe("not-allowed");
});

test("loading: label kept, progress bar, aria-busy, stays focusable", async ({ page }) => {
  const btn = page.getByTestId("btn-loading");
  await expect(btn).toHaveText("Saving");
  await expect(btn).toHaveAttribute("aria-busy", "true");
  await expect(btn).toHaveAttribute("aria-disabled", "true");
  await expect(btn.locator('[data-slot="button-progress"]')).toHaveCount(1);
  await btn.focus();
  await expect(btn).toBeFocused();
  await btn.hover();
  expect((await style(btn)).shadow).toBe("");
});

test("loading round trip announces the result politely", async ({ page }) => {
  const btn = page.getByTestId("btn-loading-demo");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-busy", "true");
  // A second click while busy does nothing.
  await btn.click();
  await expect(page.getByTestId("loading-status")).toHaveText("Item saved.");
  await expect(btn).not.toHaveAttribute("aria-busy");
  await expect(page.getByTestId("loading-status")).toHaveAttribute("aria-live", "polite");
});

test("aria-disabled without loading looks disabled too", async ({ page }) => {
  const btn = page.getByTestId("btn-aria-disabled");
  await expect(btn).toHaveAttribute("aria-disabled", "true");
  expect((await style(btn)).opacity).toBe("0.45");
  expect((await style(btn)).cursor).toBe("not-allowed");
});
