import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactEmail, hostingRegion } from './pilot-config';

afterEach(() => vi.unstubAllEnvs());

describe('NEXT_PUBLIC_CONTACT_EMAIL (FR-67)', () => {
  it('is not configured when unset, empty or blank', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', undefined as unknown as string);
    expect(contactEmail()).toBeNull();
    for (const v of ['', '   ', '\n']) { vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', v); expect(contactEmail()).toBeNull(); }
  });
  it('is the address, trimmed, when it is an email address', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', '  privacy@example.org ');
    expect(contactEmail()).toBe('privacy@example.org');
  });
  it.each(['not an address', 'a@b', 'javascript:alert(1)', '<a@b.c>', 'a b@c.de', 'a@b.c, d@e.f', '"x"@y.zz', 'a@b.c\\', `${'a'.repeat(250)}@b.cd`])('treats %j as not configured', (v) => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', v);
    expect(contactEmail()).toBeNull();
  });
});

describe('NEXT_PUBLIC_HOSTING_REGION (FR-67)', () => {
  it('is not configured when unset or empty', () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTING_REGION', undefined as unknown as string);
    expect(hostingRegion()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_HOSTING_REGION', '  ');
    expect(hostingRegion()).toBeNull();
  });
  it('is plain text: trimmed, control characters removed, cut at 100 characters', () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTING_REGION', ' South Asia (Mumbai, India)\u0000\n ');
    expect(hostingRegion()).toBe('South Asia (Mumbai, India)');
    vi.stubEnv('NEXT_PUBLIC_HOSTING_REGION', 'x'.repeat(300));
    expect(hostingRegion()).toHaveLength(100);
  });
});
