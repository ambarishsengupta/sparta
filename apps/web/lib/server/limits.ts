import { createHash, timingSafeEqual } from 'node:crypto';

/** The shortest worker token the route accepts (LLD 12.3 asks for random values of at least 32 bytes; 32 characters here is the floor). */
export const MIN_BEARER_CHARS = 32;

/** Constant-time comparison of a presented bearer token with the configured one. Both are hashed first, so the lengths never differ and the
 * comparison time does not depend on where they differ. A configured token shorter than the floor matches nothing (the route is then misconfigured). */
export function tokenMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  if (expected.length < MIN_BEARER_CHARS || presented.length < MIN_BEARER_CHARS) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The token of an `Authorization: Bearer <token>` header, or null for anything else (no scheme, other scheme, extra parts). */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer ([^\s]+)$/.exec(header ?? '');
  return m ? m[1]! : null;
}

/** A fixed-window counter per process: `allow()` is true for the first `max` calls in each window. Hosted functions may run several
 * processes, so this is a brake on a runaway or guessing caller, not an exact quota (LLD 10 sets the real limits in the database). */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now): () => boolean {
  let start = now();
  let count = 0;
  return () => {
    const t = now();
    if (t - start >= windowMs || t < start) { start = t; count = 0; }
    count += 1;
    return count <= max;
  };
}
