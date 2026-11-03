import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'data/**',
      'workflow/evidence/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts and tests: declare the few Node globals by hand (no globals package is approved).
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
