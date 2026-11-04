import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'workflow/gates/**/*.test.ts', 'apps/web/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
