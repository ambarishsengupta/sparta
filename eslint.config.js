import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import regexp from 'eslint-plugin-regexp';

// Sparta lint rules (WO-0123, audit of 2026-11-15). Read docs/LINT-RULES.md before changing this file.
//
// Three ideas:
//   1. Every rule here is an ERROR. There are no warnings, and inline `eslint-disable` comments are switched off (noInlineConfig).
//   2. Code that broke a rule when the rule was added is listed in eslint-suppressions.json (the baseline). ESLint fails on any NEW
//      violation and also fails when a baseline entry is no longer needed, so the baseline can only shrink. The audit work orders
//      (workflow/work-orders/Audit.md) burn it down. Never add to it by hand: `npx eslint . --suppress-rule <rule>` needs a work order.
//   3. The boundaries below (who may read a secret, who may reach the network, who may import the server-only modules) are the same
//      ones the regex source scans test (source.test.ts, network-scan.ts). The lint reads the syntax tree, so a string cannot dodge it.

const TESTS = ['**/*.test.ts', '**/*.test.tsx', '**/test-support/**', '**/fixtures/**'];
const WEB = 'apps/web';

// ---- syntax selectors (no-restricted-syntax) ----
const FOCUSED_TEST = {
  selector: "MemberExpression[property.name=/^(only|skip|todo|fails)$/][object.name=/^(it|test|describe|bench|suite)$/]",
  message: 'No focused, skipped or todo tests: they hide failures. Use describe.skipIf(condition) only for a missing local stack; GATE_STRICT=1 fails on those too.',
};
const UNSAFE_HTML = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Never inject HTML. Render text or elements (the legal pages use lib/markdown.ts, which builds elements).' },
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Never assign HTML strings to the DOM.' },
  { selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/][callee.object.name=/^(document|el|node|element)$/]", message: 'Never write HTML strings to the DOM.' },
];
const ANY_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'process.env is read only in the configuration modules (lib/supabase/config.ts, lib/engine-config.ts, lib/pilot-config.ts), the secret-key module and the worker route. Import the value from there.',
};
const SECRET_ENV = {
  selector: "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^(?!NEXT_PUBLIC_)/]",
  message: 'Only NEXT_PUBLIC_ variables may be read here. A server-only variable (secret key, worker token, data path) is read in lib/server/admin.ts or the worker route and nowhere else.',
};
const COMPUTED_ENV = {
  selector: "MemberExpression[computed=true][object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
  message: 'No computed process.env[...] reads: Next cannot inline them and the secret scans cannot see them.',
};
const UNTYPED_CLIENT = {
  selector: "TSTypeReference[typeName.name='SupabaseClient']:not([typeArguments])",
  message: 'Name the database: SupabaseClient<Database>, with `import type { Database }` from lib/supabase/database.types. Through an untyped client every row is an unchecked value and a renamed column still compiles (audit finding A6, WO-0126, WO-0149).',
};
const UNTYPED_FACTORY = {
  selector: "CallExpression[callee.name=/^(createBrowserClient|createServerClient|createClient)$/]:not([typeArguments])",
  message: 'Name the database in the call: createBrowserClient<Database>(url, key) (likewise createServerClient and createClient), with `import type { Database }` from lib/supabase/database.types. Without the type argument the client is untyped and a renamed column still compiles (WO-0153, follow-up 14).',
};
const SERVER_ONLY_IMPORTS = {
  patterns: [{
    group: ['**/lib/server', '**/lib/server/*', './server/*', '../server/*', '../../server/*'],
    message: 'lib/server holds the secret-key client and the handlers that use it. Only route handlers under app/api and lib/server itself may import it.',
  }],
};
const SUPABASE_FACTORIES = {
  paths: [
    { name: '@supabase/supabase-js', importNames: ['createClient'], allowTypeImports: true, message: 'Build Supabase clients only in lib/supabase/{browser,server,proxy-session}.ts and lib/server/admin.ts.' },
    { name: '@supabase/ssr', importNames: ['createServerClient', 'createBrowserClient'], allowTypeImports: true, message: 'Build Supabase clients only in lib/supabase/{browser,server,proxy-session}.ts.' },
  ],
};
// WO-0153: fetch wrappers dodge the no-restricted-globals rule below (their names hold a hyphen or are not the global), so they are named too.
const FETCH_WRAPPER_NAMES = ['node-fetch', 'cross-fetch', 'ofetch', 'axios', 'ky', 'got'];
const FETCH_WRAPPER_MESSAGE = 'No fetch wrapper (node-fetch, cross-fetch, ofetch, axios, ky, got): the no-network rule applies to wrappers too. The engine packages never reach the network; the app does it only in the three files listed in eslint.config.js.';
const FETCH_WRAPPERS = {
  // exact names as paths (a bare gitignore-style pattern such as 'got' would also match './got' and '@acme/got'); subpaths as patterns
  paths: FETCH_WRAPPER_NAMES.map((name) => ({ name, message: FETCH_WRAPPER_MESSAGE })),
  patterns: [{ group: FETCH_WRAPPER_NAMES.map((name) => `${name}/*`), message: FETCH_WRAPPER_MESSAGE }],
};
// WO-0154: no-restricted-imports sees static imports only, so require('axios') and import('axios') (also a subpath, as a string literal) are named here. Every block that sets no-restricted-syntax lists these two,
// because flat config replaces a rule's options per block. A computed argument (require(name)) or a template literal is not seen.
const FETCH_WRAPPER_CALLED = String.raw`/^(${FETCH_WRAPPER_NAMES.join('|')})(\/.*)?$/`;
const DYNAMIC_FETCH_WRAPPER = [
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${FETCH_WRAPPER_CALLED}]`, message: FETCH_WRAPPER_MESSAGE },
  { selector: `ImportExpression[source.value=${FETCH_WRAPPER_CALLED}]`, message: FETCH_WRAPPER_MESSAGE },
];
// Flat config replaces a rule's options per block, so every block that restricts imports builds its options with this: it joins the `paths` and `patterns` of its parts.
const restrictImports = (...parts) => ['error', { paths: parts.flatMap((p) => p.paths ?? []), patterns: parts.flatMap((p) => p.patterns ?? []) }];
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name, message: 'No direct network call here. The engine packages never reach the network; the app does it only in the three files listed in eslint.config.js.',
}));

// WO-0129: the recommended rule sets of the two new plugins, with every rule forced to 'error' (the project has no warnings).
// Only the plugin's own rules (a recommended set may also switch on a core rule: that would be a new rule that is not the plugin's).
const asErrors = (rules, prefix) => Object.fromEntries(Object.entries(rules).filter(([name]) => name.startsWith(prefix)).map(([name, setting]) => [name, ['error', ...(Array.isArray(setting) ? setting.slice(1) : [])]]));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'data/**',
      'workflow/evidence/**',
      'docs/**',
      '.claude/**',
      '**/.next/**',
      '**/next-env.d.ts',
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

  // ---- 1. everywhere: no escape hatches, no dynamic code, no hidden tests ----
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': ['error', FOCUSED_TEST],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true, minimumDescriptionLength: 10 }],
    },
  },

  // ---- 2. the web app (not its tests): secrets, HTML, network, console ----
  {
    files: [`${WEB}/**/*.{ts,tsx}`],
    ignores: TESTS,
    rules: {
      'no-console': 'error',
      'no-alert': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': ['error', FOCUSED_TEST, ...UNSAFE_HTML, ANY_ENV, COMPUTED_ENV, UNTYPED_CLIENT, UNTYPED_FACTORY, ...DYNAMIC_FETCH_WRAPPER],
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
      '@typescript-eslint/no-restricted-imports': restrictImports(SERVER_ONLY_IMPORTS, SUPABASE_FACTORIES, FETCH_WRAPPERS),
    },
  },
  {
    // WO-0168: the end-to-end suite and its Playwright config. They are test code that drives the built app from outside: they read the run's settings from process.env
    // (set by playwright.config.ts, local stack only) and call the local mail catcher and Auth API with fetch. Focused or skipped tests, HTML writes and fetch wrappers stay errors.
    files: [`${WEB}/e2e/**/*.ts`, `${WEB}/playwright.config.ts`],
    rules: {
      'no-restricted-syntax': ['error', FOCUSED_TEST, ...UNSAFE_HTML, COMPUTED_ENV, ...DYNAMIC_FETCH_WRAPPER],
      'no-restricted-globals': 'off',
    },
  },
  {
    // The configuration modules: the only readers of process.env, and only of NEXT_PUBLIC_ names.
    files: [`${WEB}/lib/supabase/config.ts`, `${WEB}/lib/engine-config.ts`, `${WEB}/lib/pilot-config.ts`],
    rules: { 'no-restricted-syntax': ['error', FOCUSED_TEST, ...UNSAFE_HTML, SECRET_ENV, COMPUTED_ENV, UNTYPED_CLIENT, UNTYPED_FACTORY, ...DYNAMIC_FETCH_WRAPPER] },
  },
  {
    // The two readers of server-only variables (LLD 6): the secret-key module and the worker route.
    files: [`${WEB}/lib/server/admin.ts`, `${WEB}/lib/server/hm-demo.ts`, `${WEB}/app/api/worker/signed-urls/route.ts`],
    rules: { 'no-restricted-syntax': ['error', FOCUSED_TEST, ...UNSAFE_HTML, COMPUTED_ENV, UNTYPED_CLIENT, UNTYPED_FACTORY, ...DYNAMIC_FETCH_WRAPPER] },
  },
  {
    // Who may import lib/server: the route handlers and lib/server itself. They still may not build other Supabase clients.
    files: [`${WEB}/app/api/**/route.ts`, `${WEB}/app/hm-image/[[]id]/route.ts`, `${WEB}/lib/server/**/*.ts`],
    ignores: TESTS,
    rules: { '@typescript-eslint/no-restricted-imports': restrictImports(SUPABASE_FACTORIES, FETCH_WRAPPERS) },
  },
  {
    // The client factories.
    files: [`${WEB}/lib/supabase/browser.ts`, `${WEB}/lib/supabase/server.ts`, `${WEB}/lib/supabase/proxy-session.ts`],
    rules: { '@typescript-eslint/no-restricted-imports': restrictImports(SERVER_ONLY_IMPORTS, FETCH_WRAPPERS) },
  },
  {
    files: [`${WEB}/lib/server/admin.ts`],
    rules: { '@typescript-eslint/no-restricted-imports': restrictImports(FETCH_WRAPPERS) },   // the secret-key module may import lib/server and build its client, but not a fetch wrapper
  },
  {
    // The only direct network calls of the app (the same list as test-support/network-scan.ts): the two public JSON files of the
    // learned layer, the storage purge of Leave the pilot, and the admin routes.
    files: [`${WEB}/lib/engine-config.ts`, `${WEB}/components/account/account-actions.ts`, `${WEB}/components/admin/admin-actions.ts`],
    rules: { 'no-restricted-globals': 'off' },
  },

  // ---- 3. the engine packages (not their tests or scripts): browser-safe, no network, no Node, no console ----
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: TESTS,
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', FOCUSED_TEST, ...DYNAMIC_FETCH_WRAPPER],
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS, { name: 'process', message: 'The engine runs in the browser: no process, no environment.' }],
      '@typescript-eslint/no-restricted-imports': restrictImports({ patterns: [
        { group: ['node:*', 'fs', 'path', 'crypto', 'child_process', 'os', 'http', 'https'], message: 'The engine runs in the browser: no Node modules.' },
        { group: ['**/apps/**', '@supabase/*', 'next', 'next/*', 'react', 'react-dom'], message: 'The engine depends on nothing but @sparta/taxonomy.' },
      ] }, FETCH_WRAPPERS),
    },
  },

  // ---- 4. type-aware rules for the app and the packages: promises, unsafe values, unchecked text ----
  {
    files: [`${WEB}/**/*.{ts,tsx}`, 'packages/*/src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
  {
    // Values that came from the database or the network must be narrowed before use (tests may build loose fakes).
    files: [`${WEB}/**/*.{ts,tsx}`, 'packages/*/src/**/*.ts'],
    ignores: TESTS,
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },

  // ---- 5. WO-0129: linters that came with a new development dependency (eslint-plugin-jsx-a11y 6.10.2 could not be installed: see docs/LINT-RULES.md) ----
  {
    // Hooks mistakes: stale closures, missing effect dependencies, state set in render (React compiler rules of react-hooks 7).
    files: [`${WEB}/**/*.{ts,tsx}`],
    ignores: TESTS,
    plugins: { 'react-hooks': reactHooks },
    rules: asErrors(reactHooks.configs.flat['recommended-latest'].rules, 'react-hooks/'),
  },
  {
    // Slow or ambiguous regular expressions (the class of the R2c legal-renderer finding), in all source.
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: { regexp },
    rules: asErrors(regexp.configs['flat/recommended'].rules, 'regexp/'),
  },
);
