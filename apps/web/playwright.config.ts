// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);

// Runs against the production build (`next start`, LLD 12.1). Build first:
//   npm run build && npm run test:e2e
// Two widths (plan 5.3) times two themes.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-light", use: { viewport: { width: 375, height: 812 }, colorScheme: "light" } },
    { name: "mobile-dark", use: { viewport: { width: 375, height: 812 }, colorScheme: "dark" } },
    {
      name: "desktop-light",
      use: { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    { name: "desktop-dark", use: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/wardrobe`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
