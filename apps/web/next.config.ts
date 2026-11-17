import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import { hostableConfigProblem, hostableDemoFlag } from './lib/supabase/config';

// The workspace packages ship TypeScript source and import it with `.js` suffixes (NodeNext style), so Next compiles
// them and webpack maps `./x.js` to `./x.ts`. Turbopack has no such alias yet, hence `--webpack` in the scripts.
// Response headers for every route (WO-0053, partial hardening). The Content-Security-Policy HERE is deliberately the static part: it stops framing, form
// posts to other sites, a changed base URL and plugins, and it is the only policy the local no-login demo gets. The full policy, with a script-src nonce
// that is new for every request, is set by proxy.ts for a build with accounts (WO-0130); a header in this file can not hold a per-request value.
// On a response that went through the proxy, the proxy's policy is the one sent (seen with curl against `next start`: one Content-Security-Policy header, the
// proxy's, which repeats these four directives); this one stays as it is and must never gain a script-src.
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// The pages that show legal/*.md read the files from the repository root (outside this app's folder). When the app is built with accounts the pages
// are rendered on request, so the files are named here to be shipped with the server output.
const LEGAL_FILES = ['../../legal/PRIVACY-POLICY.md', '../../legal/TERMS-OF-USE.md'];

// WO-0130: a build of the local no-login demo says what it is on every response. The gate's build-output test refuses this header, so such a
// build can never pass as a hosted one. Read it with: curl -sI http://127.0.0.1:<port>/ | grep -i x-sparta-build
export const DEMO_BUILD_HEADER = { key: 'X-Sparta-Build', value: 'demo-no-login' };

const baseConfig = (demoNoLogin: boolean): NextConfig => ({
  headers: async () => [{ source: '/:path*', headers: demoNoLogin ? [...SECURITY_HEADERS, DEMO_BUILD_HEADER] : SECURITY_HEADERS }],
  outputFileTracingIncludes: { '/privacy': LEGAL_FILES, '/terms': LEGAL_FILES, '/about': LEGAL_FILES },
  transpilePackages: ['@sparta/taxonomy', '@sparta/rules'],
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    webpackConfig.resolve.extensionAlias = { ...webpackConfig.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
});

/**
 * WO-0130 (audit finding A13): fail closed on configuration. `next build` and `next start` refuse to go on unless the build has accounts
 * switched on and configured, or the local demo script has said it is the no-login demo. `next dev` and the tests are not held to this.
 */
export function configFor(phase: string, env?: Parameters<typeof hostableConfigProblem>[0]): NextConfig {
  const production = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER;
  const problem = hostableConfigProblem(env);
  if (production && problem !== null) throw new Error(`Sparta refuses to ${phase === PHASE_PRODUCTION_BUILD ? 'build' : 'start'}: ${problem}`);
  // the header follows the flag, so a demo build is marked even where the check above does not apply
  const demoNoLogin = (env === undefined ? hostableDemoFlag() : env.demoNoLogin) === '1';
  return baseConfig(demoNoLogin);
}

// Next calls the default export as (phase, { defaultConfig }). The second argument is NOT an environment, so it is not passed on:
// the real build reads the process environment, and only the tests hand `configFor` a made-up one.
export default function nextConfig(phase: string): NextConfig { return configFor(phase); }
