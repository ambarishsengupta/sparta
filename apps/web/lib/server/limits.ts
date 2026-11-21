import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

/** The shortest worker token the route accepts (LLD 12.3 asks for random values of at least 32 bytes; 32 characters here is the floor). */
export const MIN_BEARER_CHARS = 32;

/** Constant-time comparison of a presented bearer token with the configured one. Both are ALWAYS hashed and the two digests compared with
 * `timingSafeEqual`, whatever the presented value is (missing, too short, too long, wrong): the work done and the comparison time do not depend on
 * the length or on where the values differ (WO-0074: a short token used to skip the hashing). The length floor and the type checks are applied to
 * the result afterwards, never as an early exit. A configured token shorter than the floor matches nothing (the route is then misconfigured). */
export function tokenMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  const a = createHash('sha256').update(typeof presented === 'string' ? presented : '').digest();
  const b = createHash('sha256').update(typeof expected === 'string' ? expected : '').digest();
  const same = timingSafeEqual(a, b);
  return same && typeof presented === 'string' && typeof expected === 'string' && expected.length >= MIN_BEARER_CHARS && presented.length >= MIN_BEARER_CHARS;
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

/**
 * WO-0130 (audit finding A13): the second brake of the worker, purge and admin routes, a count that every server instance shares.
 *
 * `makeLimiter` (limits.ts) counts inside one process, so a host that runs several instances lets a caller use the budget once per instance.
 * This module counts in the database instead: `app.rate_limit_hit(bucket, max, window)` (migration 20261117100000) adds one to the bucket's fixed
 * window and answers whether the call is within the limit. The per-process limiter stays in front of it as the first, cheap brake: a caller that
 * the process already refuses never costs a database call.
 *
 * WHEN THE COUNT CANNOT BE READ (the database does not answer, answers with an error, or answers something that is not true or false) the
 * counter THROWS `RateCountUnavailable` and the route answers 503 `unavailable`. These routes FAIL CLOSED: a limit that cannot be checked
 * is not treated as passed (a caller must not be able to switch the limit off by making the count fail), and nothing the route guards is done.
 */
export class RateCountUnavailable extends Error {
  constructor() { super('The rate-limit count could not be read.'); this.name = 'RateCountUnavailable'; }
}

/** What the count call looks like: the generated `app.rate_limit_hit` through the secret-key client, or a fake in a test. */
export type RateRpc = (bucket: string, max: number, windowSeconds: number) => PromiseLike<{ data: unknown; error: unknown }>;

/** The secret-key client's call of `app.rate_limit_hit` (only the secret-key role may execute it). */
export const rateRpcOf = (admin: Pick<SupabaseClient<Database>, 'schema'>): RateRpc =>
  (bucket, max, windowSeconds) => admin.schema('app').rpc('rate_limit_hit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });

/** The shared count for one kind of call: `true` = within the limit, `false` = over it (429). Throws `RateCountUnavailable` when it cannot say. */
export function sharedCounter(rpc: RateRpc, spec: { max: number; windowSeconds: number }): (bucket: string) => Promise<boolean> {
  return async (bucket) => {
    let r: { data: unknown; error: unknown };
    try { r = await rpc(bucket, spec.max, spec.windowSeconds); } catch { throw new RateCountUnavailable(); }
    if (r.error || typeof r.data !== 'boolean') throw new RateCountUnavailable();
    return r.data;
  };
}

/** One route's two brakes for one request: the process-wide `brake` (made once per module with `makeLimiter`) and the shared `count` (made per request). */
export interface RouteLimit {
  /** The per-process limiter; false = refuse with 429 without asking the database. */
  brake: () => boolean;
  /** The shared count for this bucket; false = refuse with 429; throws `RateCountUnavailable` = refuse with 503. */
  count: (bucket: string) => Promise<boolean>;
}
export const routeLimit = (brake: () => boolean, rpc: RateRpc, spec: { max: number; windowSeconds: number }): RouteLimit =>
  ({ brake, count: sharedCounter(rpc, spec) });
