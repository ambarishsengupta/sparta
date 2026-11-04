import type { NextConfig } from 'next';

// The workspace packages ship TypeScript source and import it with `.js` suffixes (NodeNext style), so Next compiles
// them and webpack maps `./x.js` to `./x.ts`. Turbopack has no such alias yet, hence `--webpack` in the scripts.
const config: NextConfig = {
  transpilePackages: ['@sparta/taxonomy', '@sparta/rules'],
  webpack(webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    webpackConfig.resolve.extensionAlias = { ...webpackConfig.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
};
export default config;
