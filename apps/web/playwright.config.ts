import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { assertLocalStack, E2E_CONTACT_EMAIL, E2E_PORT, env } from './test-support/e2e-local';

// WO-0168: the end-to-end suite (LLD 11 "End to end", LLD 14 M6). Run it with: npx playwright test -c apps/web/playwright.config.ts
// It serves the BUILT app (`next start`, never `next dev`) against the LOCAL Supabase stack, drives one Chromium, and stops the server afterwards.
// Nothing is written inside the repository: results and the report go under the system temporary folder. It refuses to run unless the Supabase URL,
// the mail catcher URL and the database URL point at this machine. Traces are off: a trace records what was typed, passwords included. The Playwright worker count is one: the tests share one database and one server.
const root = join(import.meta.dirname, '../..');
const webDir = join(root, 'apps/web');
const nextBin = join(root, 'node_modules/next/dist/bin/next');

/** The local stack's settings from `supabase status`, read once by the main process and handed to the workers through the environment. */
function discover(): void {
  if (env.SPARTA_E2E_API_URL) return;
  const out = execFileSync('supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString();
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Record<string, string | undefined>;
  assertLocalStack({ supabaseUrl: s.API_URL, mailUrl: s.MAILPIT_URL, dbUrl: s.DB_URL });
  if (!s.PUBLISHABLE_KEY) throw new Error('supabase status gave no publishable key: is the local stack running (supabase start)?');
  env.SPARTA_E2E_API_URL = s.API_URL;
  env.SPARTA_E2E_MAIL_URL = s.MAILPIT_URL;
  env.SPARTA_E2E_DB_URL = s.DB_URL;
  env.SPARTA_E2E_KEY = s.PUBLISHABLE_KEY;
}
discover();
env.SPARTA_E2E_RUN ??= randomBytes(6).toString('hex'); // the unique part of every synthetic address of this run
// Checked again here, so the build and the server below can never be given a remote address.
const urls = assertLocalStack({ supabaseUrl: env.SPARTA_E2E_API_URL, mailUrl: env.SPARTA_E2E_MAIL_URL, dbUrl: env.SPARTA_E2E_DB_URL });

// The NEXT_PUBLIC_ values are fixed into the app when it is built, so the app is built here, with the local stack's address. Only the publishable key is given to it, never the secret key.
const appEnv = {
  NEXT_PUBLIC_DATA_BACKEND: 'supabase',
  NEXT_PUBLIC_SUPABASE_URL: urls.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.SPARTA_E2E_KEY ?? '',
  NEXT_PUBLIC_CONTACT_EMAIL: E2E_CONTACT_EMAIL,
  NEXT_PUBLIC_HOSTING_REGION: 'Local test stack',
};
// The build runs once, in the main Playwright process, before the web-server timeout starts (a build is not a server start, and it takes longer than 120 s on a slow laptop).
if (env.TEST_WORKER_INDEX === undefined && env.SPARTA_E2E_BUILT !== '1') {
  execFileSync(process.execPath, [nextBin, 'build', '--webpack'], { cwd: webDir, env: { ...env, ...appEnv }, stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 });
  env.SPARTA_E2E_BUILT = '1';
}

const out = join(tmpdir(), `sparta-e2e-${env.SPARTA_E2E_RUN}`);
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir: join(out, 'results'),
  reporter: [['list'], ['html', { outputFolder: join(out, 'report'), open: 'never' }]],
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${nextBin} start -H 127.0.0.1 -p ${E2E_PORT}`,
    cwd: webDir,
    url: `http://127.0.0.1:${E2E_PORT}/about`,
    timeout: 120_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: appEnv, // added to the environment the server inherits
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
