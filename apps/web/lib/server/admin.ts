/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

/**
 * THE ONLY MODULE THAT READS THE SUPABASE SECRET KEY (R5b decision after the WO-0070 review; LLD 6).
 *
 * The secret key acts as the `service_role` Postgres role and bypasses row-level security. It exists only in the server environment
 * (`SUPABASE_SECRET_KEY`, never `NEXT_PUBLIC_*`) and only route handlers may import this module (source test: source.test.ts). This file
 * throws in a browser context, and the built client bundle is scanned for the key's name and its prefix (build-output.test.ts).
 * It exports a client factory and nothing else; each call makes a fresh client that keeps no session.
 */
/** True in a browser (or any page with a `window`); the check does not need the DOM types. */
const inBrowser = (): boolean => typeof (globalThis as { window?: unknown }).window !== 'undefined';

export function createAdminSupabase(): SupabaseClient<Database> {
  if (inBrowser()) throw new Error('The admin client is for the server only.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('The admin client is not configured.');
  // A publishable key (or anything else) put here by mistake would run with the wrong rights without any error; refuse it by its prefix.
  if (!key.startsWith('sb_secret_')) throw new Error('The admin client needs a secret key.');
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** True when a route can build the client (server side, URL and a secret key present). Never returns or logs the key. */
export const adminConfigured = (): boolean =>
  !inBrowser() && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SECRET_KEY);
