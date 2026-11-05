/** Why a repository call failed. The screen shows a fixed sentence for each kind; no server text is ever shown (it can name tables and columns). */
export type FailureKind = 'network' | 'session' | 'refused' | 'rejected' | 'unsupported' | 'unexpected';

const WRITE: Record<FailureKind, string> = {
  network: 'Could not reach the server, so your change was not saved. Check your connection and try again.',
  session: 'Your session has ended, so your change was not saved. Sign in again to continue.',
  refused: 'Your account is not allowed to do that, so your change was not saved. Sign in again; if it keeps happening, finish the sign-up steps.',
  rejected: 'The server did not accept those details, so your change was not saved. Check them and try again.',
  unsupported: 'That is not available yet.',
  unexpected: 'Something went wrong, so your change was not saved. Please try again in a moment.',
};
const READ: Record<FailureKind, string> = {
  ...WRITE,
  network: 'Could not reach the server to load your data. Check your connection and reload the page.',
  session: 'Your session has ended. Sign in again to see your data.',
  refused: 'Your account is not allowed to see that. Sign in again; if it keeps happening, finish the sign-up steps.',
  unexpected: 'Something went wrong while loading your data. Please reload the page.',
};

export class RepositoryError extends Error {
  constructor(readonly kind: FailureKind, readonly write: boolean, message?: string) {
    super(message ?? (write ? WRITE : READ)[kind]);
    this.name = 'RepositoryError';
  }
}

/** The part of a PostgREST or Auth answer that decides the kind. `status` is 0 when the request never got an answer. */
export interface Failure { status?: number; error: { code?: string | null; message?: string | null; name?: string | null } }

export function classify(f: Failure, write: boolean): RepositoryError {
  const { status, error } = f;
  const code = error.code ?? '';
  const retryable = error.name === 'AuthRetryableFetchError';
  if (status === 0 || retryable) return new RepositoryError('network', write);
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(error.message ?? '') || error.name === 'AuthSessionMissingError') return new RepositoryError('session', write);
  if (code === '42501' || status === 403) return new RepositoryError('refused', write);
  if (/^2[23]/.test(code) || status === 400 || status === 409) return new RepositoryError('rejected', write);
  return new RepositoryError('unexpected', write);
}

/** Any thrown value as a RepositoryError: a failed request is a network error; anything else is unexpected. */
export function asRepositoryError(e: unknown, write: boolean): RepositoryError {
  if (e instanceof RepositoryError) return e;
  if (e instanceof TypeError) return new RepositoryError('network', write);
  return new RepositoryError('unexpected', write);
}

/** Runs a change and returns the sentence to show when it failed, or null when it worked. The caller keeps the screen as it was on a failure. */
export async function attempt(change: () => Promise<unknown>): Promise<string | null> {
  try { await change(); return null; } catch (e) { return messageOf(e); }
}

/** The sentence for a screen: the repository's own when it has one, else the generic one. */
export const messageOf = (e: unknown, write = true): string => asRepositoryError(e, write).message;
