import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_TEST } from 'next/constants';
import { describe, expect, it } from 'vitest';
import nextConfigDefault, { configFor as nextConfig, DEMO_BUILD_HEADER } from './next.config';
import { hostableConfigProblem } from './lib/supabase/config';

const ACCOUNTS = { backend: 'supabase', url: 'http://127.0.0.1:54321', key: 'sb_publishable_x' };
const DEMO = { backend: 'local', demoNoLogin: '1' };
const config = nextConfig(PHASE_PRODUCTION_BUILD, ACCOUNTS);

// WO-0053 M3 (partial): response headers on every route. The built app is checked with curl -I (workflow/evidence/R2b/TRANSCRIPT.md).
describe('next.config: security headers', () => {
  it('sends the four headers on every path, with these values', async () => {
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/:path*');
    expect(Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]))).toEqual({
      'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });
  it('the policy is the partial one: it has no script-src (a nonce policy is later work, stated in the notes) and nothing that allows framing or other hosts', async () => {
    const csp = (await config.headers!())[0]!.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp.split('; ').map((d) => d.split(' ')[0]).sort()).toEqual(['base-uri', 'form-action', 'frame-ancestors', 'object-src']);
    expect(csp).not.toMatch(/\*|https?:|unsafe|data:/);
  });
  // WO-0130: the script-src with a per-request nonce is NOT here (a static header can not hold a per-request value): proxy.ts sets the full policy, see proxy-csp.test.ts.
  it('the static header never carries a script-src or a nonce: a script policy here would be a second, per-build policy beside the proxy\'s per-request one', async () => {
    const csp = (await config.headers!())[0]!.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).not.toMatch(/script-src|nonce|default-src/);
  });
  it('keeps the workspace transpile setting', () => { expect(config.transpilePackages).toEqual(['@sparta/taxonomy', '@sparta/rules']); });
});

// WO-0130 (audit finding A13): a production build or server without accounts used to run with no sign-in at all, silently.
describe('next.config: fails closed on configuration (WO-0130)', () => {
  const PRODUCTION = [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER];

  it('refuses to build and to start without the accounts backend, and says what to set', () => {
    for (const phase of PRODUCTION) {
      for (const env of [{}, { backend: '' }, { backend: 'local' }, { backend: 'Supabase' }, { backend: 'local', url: ACCOUNTS.url, key: ACCOUNTS.key }]) {
        expect(() => nextConfig(phase, env), `${phase} ${JSON.stringify(env)}`).toThrow(/Sparta refuses to (build|start): This build would have no sign-in at all/);
      }
    }
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD, {})).toThrow(/refuses to build: .*NEXT_PUBLIC_DATA_BACKEND is not set.*NEXT_PUBLIC_DATA_BACKEND=supabase.*start-demo\.sh --no-login/);
    expect(() => nextConfig(PHASE_PRODUCTION_SERVER, { backend: 'local' })).toThrow(/refuses to start: .*NEXT_PUBLIC_DATA_BACKEND is "local"/);
  });

  it('refuses the accounts backend without its two variables, naming the missing ones', () => {
    for (const phase of PRODUCTION) {
      expect(() => nextConfig(phase, { backend: 'supabase' })).toThrow(/set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\./);
      expect(() => nextConfig(phase, { backend: 'supabase', url: ACCOUNTS.url })).toThrow(/set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\./);
      expect(() => nextConfig(phase, { backend: 'supabase', url: '', key: ACCOUNTS.key })).toThrow(/set NEXT_PUBLIC_SUPABASE_URL\./);
    }
  });

  it('accepts exactly two configurations: accounts fully set, or the local demo that says it has no sign-in', () => {
    for (const phase of PRODUCTION) {
      expect(() => nextConfig(phase, ACCOUNTS)).not.toThrow();
      expect(() => nextConfig(phase, DEMO)).not.toThrow();
      expect(() => nextConfig(phase, { demoNoLogin: '1' })).not.toThrow();
      // the flag and the accounts backend contradict each other, and the flag has one valid value
      expect(() => nextConfig(phase, { ...ACCOUNTS, demoNoLogin: '1' })).toThrow(/Set one or the other/);
      for (const v of ['true', '0', 'yes', ' 1']) expect(() => nextConfig(phase, { backend: 'local', demoNoLogin: v }), v).toThrow(/must be 1 or unset/);
    }
    expect(hostableConfigProblem(ACCOUNTS)).toBeNull();
    expect(hostableConfigProblem(DEMO)).toBeNull();
    expect(hostableConfigProblem({ ...ACCOUNTS, demoNoLogin: '' })).toBeNull();
  });

  it('the default export ignores the second argument Next passes ({ defaultConfig }) and reads the process environment (a first version took it for the environment and refused every build)', () => {
    const keep = { ...process.env };
    const call = nextConfigDefault as unknown as (phase: string, context: { defaultConfig: object }) => unknown;
    try {
      Object.assign(process.env, { NEXT_PUBLIC_DATA_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: ACCOUNTS.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ACCOUNTS.key });
      delete process.env.NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN;
      expect(() => call(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })).not.toThrow();
      delete process.env.NEXT_PUBLIC_DATA_BACKEND;
      expect(() => call(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })).toThrow(/NEXT_PUBLIC_DATA_BACKEND is not set/);
      process.env.NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN = '1';
      expect(() => call(PHASE_PRODUCTION_SERVER, { defaultConfig: {} })).not.toThrow();
    } finally {
      for (const k of ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN']) {
        if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
      }
    }
  });

  it('does not hold `next dev` or the tests to it (the browser-only backend stays the default for development)', () => {
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_TEST]) expect(() => nextConfig(phase, {})).not.toThrow();
  });

  it('marks a no-login demo build with a response header on every path, and no other build', async () => {
    const headersOf = async (phase: string, env: Parameters<typeof nextConfig>[1]) => (await nextConfig(phase, env).headers!())[0]!.headers.map((h) => `${h.key}: ${h.value}`);
    expect(DEMO_BUILD_HEADER).toEqual({ key: 'X-Sparta-Build', value: 'demo-no-login' });
    for (const phase of [...PRODUCTION, PHASE_DEVELOPMENT_SERVER]) expect(await headersOf(phase, DEMO), phase).toContain('X-Sparta-Build: demo-no-login');
    expect((await headersOf(PHASE_PRODUCTION_BUILD, DEMO)).length).toBe(5);   // the four security headers stay
    for (const env of [ACCOUNTS, { backend: 'local' }, {}]) expect((await headersOf(PHASE_DEVELOPMENT_SERVER, env)).join('\n'), JSON.stringify(env)).not.toMatch(/x-sparta-build/i);
  });
});
