import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { purgeMyStorage } from '../components/account/account-actions';
import { BUCKETS, handlePurge, purgeBucket } from '../lib/server/purge';
import type { Stack } from './stack';

/** A client with the local stack's secret key, for tests only (read from `supabase status` at run time, never written anywhere). */
export const adminFor = (s: Stack): SupabaseClient => {
  if (!s.secret) throw new Error('the local stack did not report a secret key');
  return createClient(s.url, s.secret, { auth: { persistSession: false, autoRefreshToken: false } });
};

/** What the browser does on Leave (`purgeMyStorage`), with the network replaced by an in-process call of the route's own handler: the caller is the
 * test's signed-in client, the storage is the secret-key client. Everything between the two (the client mapping, the handler) is the real code. */
export const purgeInProcess = (s: Stack, caller: SupabaseClient, storage: SupabaseClient['storage'] = adminFor(s).storage) =>
  // A browser adds Origin and Sec-Fetch-Site to a same-origin POST; the in-process request carries them too (WO-0074: the handler refuses a request without either).
  purgeMyStorage((path, init) => handlePurge(new Request(`http://127.0.0.1:3000${path}`, { ...init, headers: { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' } }), { caller, storage }));

/** Test clean-up: removes every file of a test user through the Storage API, before the user row is deleted by SQL (which would leave the bytes behind). */
export async function purgeUserFiles(s: Stack, uid: string): Promise<void> {
  const storage = adminFor(s).storage;
  for (const bucket of BUCKETS) await purgeBucket(storage, bucket, uid);
}
