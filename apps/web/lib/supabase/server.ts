import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieOptions, supabaseEnv } from './config';
import type { Database } from './database.types';

/** The server client for server components and route handlers: the caller's session, read from and written to the request cookies. */
export async function createServerSupabase() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient<Database>(url, key, {
    cookieOptions: cookieOptions(url),
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // A server component cannot set cookies; the proxy refreshes the session on every request, so ignoring that case is safe.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only context */ }
      },
    },
  });
}

/** Used by the page shell to show Sign out; the proxy has already enforced access. */
export async function isSignedIn(): Promise<boolean> {
  const { data } = await (await createServerSupabase()).auth.getUser();
  return data.user !== null;
}

/** A redirect with a relative Location, so it stays on whatever host the person used (127.0.0.1 and localhost keep separate cookies). */
export const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } });
