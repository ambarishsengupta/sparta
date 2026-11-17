import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy, supabaseOrigin } from './lib/supabase/config';
import type { GateState } from './lib/supabase/gate';

// WO-0130 part 1: the Content-Security-Policy with a per-request script nonce, set by the proxy. The proxy() wrapper is called as a function with the
// session updater stubbed (as in proxy.test.ts); the real server is checked once with a build and curl (see the work order's evidence).
const updateSession = vi.fn();
vi.mock('./lib/supabase/proxy-session', () => ({ updateSession: (...a: unknown[]) => updateSession(...a) }));
const { proxy } = await import('./proxy');

const SUPABASE = 'http://127.0.0.1:54321';
const at = (path: string, init?: { method?: string; headers?: Record<string, string> }) => new NextRequest(`http://127.0.0.1:3000${path}`, init);
const answers = (state: GateState) => updateSession.mockImplementation(async (req: NextRequest) => ({ response: NextResponse.next({ request: req }), state }));
const SIGNED_IN: GateState = 'ready';
const csp = (res: Response) => res.headers.get('Content-Security-Policy') ?? '';
const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
const nonceOf = (policy: string) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(directive(policy, 'script-src'))?.[1] ?? '';

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE); updateSession.mockReset(); answers(SIGNED_IN); });
afterEach(() => vi.unstubAllEnvs());

describe('the policy text', () => {
  const policy = contentSecurityPolicy('AbC123+/=', SUPABASE);
  it('script-src is self, this request\'s nonce and strict-dynamic: no unsafe-inline, no unsafe-eval, no host, no data:', () => {
    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'nonce-AbC123+/=' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*(unsafe-inline|unsafe-eval|https?:|\*|data:)/);
    expect(policy).not.toContain('unsafe-eval');
  });
  it("default-src is 'self'; connect-src is this site and the Supabase origin; img-src is this site, blob: and the Supabase origin", () => {
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'connect-src')).toBe(`connect-src 'self' ${SUPABASE}`);
    expect(directive(policy, 'img-src')).toBe(`img-src 'self' blob: ${SUPABASE}`);
  });
  it('keeps the four directives of the static header, and unsafe-inline appears in style-src alone', () => {
    for (const d of ["frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'", "object-src 'none'"]) expect(policy.split('; ')).toContain(d);
    expect(policy.split('; ').filter((d) => d.includes('unsafe-inline')).map((d) => d.split(' ')[0])).toEqual(['style-src']);
  });
  it('an unset or unreadable Supabase URL leaves the origin out (stricter), and a path or credentials in the URL never reach the policy', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    for (const bad of [undefined, '', 'not a url', 'ftp://x.test', 'javascript:alert(1)']) { const p = contentSecurityPolicy('n', bad); expect(directive(p, 'connect-src')).toBe("connect-src 'self'"); expect(directive(p, 'img-src')).toBe("img-src 'self' blob:"); }
    expect(supabaseOrigin('https://user:pw@abc.supabase.co/rest/v1?x=1')).toBe('https://abc.supabase.co');
    expect(contentSecurityPolicy('n', 'https://user:pw@abc.supabase.co/rest/v1')).not.toMatch(/user|pw|rest/);
  });
});

describe('proxy(): the header on the response', () => {
  it.each(['/', '/outfits', '/items/new', '/privacy', '/terms', '/api/admin/sources'])('GET %s carries a policy whose script-src has a nonce and no unsafe-inline', async (path) => {
    const policy = csp(await proxy(at(path)));
    expect(directive(policy, 'script-src')).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'$/);
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
  });
  it('two requests get two different nonces (and 200 requests, 200 different ones)', async () => {
    const a = nonceOf(csp(await proxy(at('/outfits')))); const b = nonceOf(csp(await proxy(at('/outfits'))));
    expect(a).not.toBe(''); expect(b).not.toBe(''); expect(a).not.toBe(b);
    const many = new Set<string>();
    for (let i = 0; i < 200; i++) many.add(nonceOf(csp(await proxy(at(i % 2 ? '/privacy' : '/outfits')))));
    expect(many.size).toBe(200);
  });
  it('a redirect and the 503 of an outage carry the policy too', async () => {
    answers('unauthenticated');
    const redirect = await proxy(at('/outfits'));
    expect(redirect.headers.get('location')).not.toBeNull(); expect(nonceOf(csp(redirect))).not.toBe('');
    updateSession.mockRejectedValue(new Error('down'));
    const down = await proxy(at('/outfits'));
    expect(down.status).toBe(503); expect(nonceOf(csp(down))).not.toBe('');
  });
});

describe('proxy(): the same policy and nonce go to Next on the forwarded request (that is how Next puts the nonce on its scripts)', () => {
  it('a gated page: the session updater is handed a request whose Content-Security-Policy and x-nonce headers are the response\'s', async () => {
    const res = await proxy(at('/outfits'));
    const forwarded = updateSession.mock.calls[0]![0] as NextRequest;
    expect(forwarded.headers.get('content-security-policy')).toBe(csp(res));
    expect(forwarded.headers.get('x-nonce')).toBe(nonceOf(csp(res)));
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp(res));
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp(res)));
  });
  it('a public page (no session check): the forwarded headers are set the same way', async () => {
    const res = await proxy(at('/privacy'));
    expect(updateSession).not.toHaveBeenCalled();
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp(res));
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp(res)));
  });
  it('a nonce or policy sent by the client is replaced, never used', async () => {
    const res = await proxy(at('/privacy', { headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" } }));
    expect(nonceOf(csp(res))).not.toBe('attacker');
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp(res)));
    expect(directive(res.headers.get('x-middleware-request-content-security-policy') ?? '', 'script-src')).not.toContain('unsafe-inline');
  });
  it('the request the updater sees still carries the original request (cookies, path, method)', async () => {
    await proxy(at('/outfits?x=1', { headers: { cookie: 'sb-a=1' } }));
    const forwarded = updateSession.mock.calls[0]![0] as NextRequest;
    expect([forwarded.nextUrl.pathname, forwarded.nextUrl.search, forwarded.method, forwarded.cookies.get('sb-a')?.value]).toEqual(['/outfits', '?x=1', 'GET', '1']);
  });
});

describe('proxy(): the local no-login demo', () => {
  it('sets no nonce policy (its pages are prerendered and can carry no nonce); the static headers of next.config.ts still apply', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    const res = await proxy(at('/'));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
