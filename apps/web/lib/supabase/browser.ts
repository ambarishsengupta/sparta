import { createBrowserClient } from '@supabase/ssr';
import { cookieOptions, supabaseEnv } from './config';
import type { Database } from './database.types';

/** The browser client: publishable key, the signed-in user's own session (cookies set by @supabase/ssr). */
export function createBrowserSupabase() {
  const { url, key } = supabaseEnv();
  return createBrowserClient<Database>(url, key, { cookieOptions: cookieOptions(url) });
}
