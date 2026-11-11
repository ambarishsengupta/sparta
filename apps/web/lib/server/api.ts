/** The fixed JSON error shape of LLD 6: { "error": { "code", "message" } }. No input, path, id or detail is ever echoed. */
export const ERRORS = {
  rate_limited: [429, 'Too many requests. Try again shortly.'],
  unavailable: [503, 'This service is not available.'],
  unauthorised: [401, 'Not authorised.'],
  not_signed_in: [401, 'Sign in first.'],
  forbidden: [403, 'Not allowed.'],
  reauthentication_required: [403, 'Please enter your password again.'],
  bad_request: [400, 'The request is not valid.'],
  method_not_allowed: [405, 'Method not allowed.'],
  job_not_found: [404, 'No such job.'],
  source_not_found: [404, 'No such source.'],
  item_not_found: [404, 'No such catalogue item.'],
  allow_refused: [422, 'A source can be allowed only when robots.txt permits it and the terms note and check date are recorded.'],
  job_not_running: [409, 'The job is not running.'],
  invalid_job_input: [422, 'The job input is not valid.'],
  storage_unavailable: [502, 'Storage did not answer.'],
  purge_incomplete: [500, 'Not every file could be removed.'],
  server_error: [500, 'Something went wrong.'],
} as const;
export type ErrorCode = keyof typeof ERRORS;

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
export const fail = (code: ErrorCode): Response =>
  new Response(JSON.stringify({ error: { code, message: ERRORS[code][1] } }), { status: ERRORS[code][0], headers: HEADERS });
export const ok = (body: Record<string, unknown>): Response => new Response(JSON.stringify(body), { status: 200, headers: HEADERS });

/** The storage calls the handlers need; the real client's `storage` satisfies it (see the routes). */
export interface BucketApi {
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  createSignedUploadUrl(path: string, options?: { upsert?: boolean }): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  list(path: string, options?: { limit?: number; offset?: number }): PromiseLike<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}
export interface StorageLike { from(bucket: string): BucketApi }

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
