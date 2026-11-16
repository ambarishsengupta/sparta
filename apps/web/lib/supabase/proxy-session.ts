import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions, supabaseEnv } from './config';
import type { Database } from './database.types';
import type { GateState } from './gate';
import { loadGateState } from './gate-state';

/** Refreshes the session on this request and works out the gate state. The returned response carries any refreshed cookies; a redirect must copy them. */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; state: GateState }> {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const client = createServerClient<Database>(url, key, {
    cookieOptions: cookieOptions(url),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const state = await loadGateState(client);
  return { response, state };
}
