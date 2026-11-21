/** The browser side of deleting an item (WO-0183, FR-16): the one same-origin sender of DELETE /api/items/{id}, with the session cookie. Shaped like components/account/account-actions.ts (WO-0071)
 * and components/admin/admin-actions.ts (WO-0088): the app's no-network rule allows exactly one network call here, and lib/supabase/repository.ts holds no request text at all;
 * lib/supabase/backend.ts hands this sender to the repository when it builds it. A test passes a fake instead. */
export type Send = (path: string, init: RequestInit) => Promise<Response>;
export const browserSend: Send = (p, i) => fetch(p, i);
