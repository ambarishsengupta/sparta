import type { NextConfig } from 'next';

// The workspace packages ship TypeScript source and import it with `.js` suffixes (NodeNext style), so Next compiles
// them and webpack maps `./x.js` to `./x.ts`. Turbopack has no such alias yet, hence `--webpack` in the scripts.
// Response headers for every route (WO-0053, partial hardening). The Content-Security-Policy is deliberately partial: it stops framing, form
// posts to other sites, a changed base URL and plugins. A full policy with a script-src nonce is LATER work (see workflow/evidence/R2b/NOTES.md).
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const config: NextConfig = {
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  transpilePackages: ['@sparta/taxonomy', '@sparta/rules'],
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    webpackConfig.resolve.extensionAlias = { ...webpackConfig.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
};
export default config;
