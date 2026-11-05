import { describe, expect, it } from 'vitest';
import config from './next.config';

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
  it('keeps the workspace transpile setting', () => { expect(config.transpilePackages).toEqual(['@sparta/taxonomy', '@sparta/rules']); });
});
