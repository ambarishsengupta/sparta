import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'workflow/gates/**/*.test.ts', 'apps/web/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 30_000, // the gate's own selftests spawn git and shell scripts and take 5 to 6 s under load; the 5 s default timed out twice in the WO-0082 gate
    hookTimeout: 30_000,
  },
});
