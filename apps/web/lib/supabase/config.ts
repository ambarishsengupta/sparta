/// <reference types="node" />
/** `local` keeps the browser-only behaviour with no sign-in; `supabase` turns on sign-in and route gating (WO-0050). */
export const dataBackend = (): 'local' | 'supabase' => (process.env.NEXT_PUBLIC_DATA_BACKEND === 'supabase' ? 'supabase' : 'local');

/** Deleting an item is refused by design when the data lives in the account (the database grants no delete on items, LLD 4.6), so the button is not shown. */
export const canDeleteItems = (): boolean => dataBackend() !== 'supabase';

/** Project URL and publishable key from apps/web/.env.local (git-ignored). The app never holds any other Supabase key. */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local');
  return { url, key };
}

/** Session cookies (LLD 10): SameSite=Lax, Secure whenever the project URL is https (every hosted deployment). Not HttpOnly: the browser client reads them. */
export const cookieOptions = (url: string) => ({ sameSite: 'lax' as const, secure: url.startsWith('https:'), path: '/' });
