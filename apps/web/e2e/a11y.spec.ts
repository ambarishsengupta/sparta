// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// axe on every page and state, at 375 x 812 and 1440 x 900, light and dark
// (the four Playwright projects). Tags as in plan 4.8 and 5.3.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { settle, TABS } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const PAGES = [
  ...TABS.flatMap((t) => [t.href, `${t.href}?state=loading`, `${t.href}?state=error`]),
  "/specimen",
];

for (const path of PAGES) {
  test(`axe: ${path} has no violations`, async ({ page }) => {
    await page.goto(path);
    await settle(page);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);

    // UI copy rule (plan 4.5): no em-dashes.
    expect(await page.locator("body").innerText()).not.toContain("—");
  });
}
