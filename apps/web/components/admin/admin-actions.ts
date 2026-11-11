/** The browser side of the admin catalogue routes (WO-0088): same-origin calls with the session cookie, answers read into plain values. Never throws; the person sees the server's fixed sentence. */
export type Send = (path: string, init: RequestInit) => Promise<Response>;
export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string };
export const SOURCES_PATH = '/api/admin/sources';
export const REVIEW_PATH = '/api/admin/catalog/review';
export const takedownPath = (id: number): string => `/api/admin/sources/${id}/takedown`;
export const NO_CONNECTION = 'Could not reach the server. Nothing was changed. Check your connection and try again.';
export const NOT_UNDERSTOOD = 'The server did not answer as expected. Nothing was changed.';

export async function adminCall<T>(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, send: Send = (p, i) => fetch(p, i)): Promise<AdminResult<T>> {
  try {
    const res = await send(path, { method, credentials: 'same-origin', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* not JSON: a redirect page or a gateway error */ }
    if (res.ok && json !== null && typeof json === 'object') return { ok: true, data: json as T };
    const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
    return { ok: false, message: typeof message === 'string' ? message : NOT_UNDERSTOOD };
  } catch { return { ok: false, message: NO_CONNECTION }; }
}
