import type { SupabaseClient } from '@supabase/supabase-js';
import { sharedRepository } from '../local-repository';
import type { WardrobeRepository } from '../repository';
import { createBrowserSupabase } from './browser';
import { dataBackend } from './config';
import { RepositoryError } from './errors';
import type { FailureKind } from './errors';
import type { GateState } from './gate';
import { loadGateState } from './gate-state';
import { SupabaseRepository } from './repository';

export type Choice = 'local' | 'supabase' | 'blocked';

/**
 * Which repository the screens use. The account-backed one only when the app is set to `supabase` AND the person is ready (signed in,
 * documents accepted, notice accepted, onboarded in a supported country). When the app is not set to `supabase` it is the browser-local
 * one, as before. When it IS set to `supabase` but the person is not ready, the answer is `blocked`, never `local`: falling back to the
 * browser here would quietly keep an account holder's wardrobe on this device only.
 */
export const pickBackend = (backend: 'local' | 'supabase', state: GateState | null): Choice =>
  backend !== 'supabase' ? 'local' : state === 'ready' ? 'supabase' : 'blocked';

/** A repository whose every call fails with the sentence for `kind`, so each screen shows it where it would show data. */
export function blockedRepository(kind: FailureKind): WardrobeRepository {
  const fail = () => Promise.reject(new RepositoryError(kind, false));
  const collection = { list: fail, get: fail, create: fail, update: fail, remove: fail };
  const purchases = { page: fail, totals: fail, forItem: fail, create: fail, update: fail, remove: fail };
  return { items: { ...collection, archive: fail, restore: fail }, outfits: collection, wishlist: { ...collection, bought: fail }, purchases, prices: { currency: fail, rates: fail }, catalogue: { page: fail, brands: fail, byGtin: fail } };
}

export async function selectRepository(backend: 'local' | 'supabase', makeClient: () => Pick<SupabaseClient, 'auth' | 'schema'>, local: () => WardrobeRepository): Promise<WardrobeRepository> {
  if (backend !== 'supabase') return local();
  const client = makeClient();
  let state: GateState | null;
  try { state = await loadGateState(client); } catch { return blockedRepository('network'); }
  const choice = pickBackend(backend, state);
  return choice === 'supabase' ? new SupabaseRepository(client) : blockedRepository('session');
}

let chosen: Promise<WardrobeRepository> | null = null;
/** One choice per page load, shared by every component that asks. */
export const chooseRepository = (): Promise<WardrobeRepository> => (chosen ??= selectRepository(dataBackend(), createBrowserSupabase, sharedRepository));
