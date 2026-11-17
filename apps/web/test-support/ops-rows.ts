import { sql } from './stack';

// WO-0151: the integration suites run against the real local database, so a row they write into ops.vendor_query_log or ops.rate_limit_windows
// stays after the run unless the suite removes it. These helpers remove exactly what a suite created, keyed by the ids or buckets it used (never a whole table).

/** Removes the query log rows written for the given users (a vendor's own calls are logged under its user id). Empty ids are ignored. */
export function deleteQueryLogOf(userIds: string[]): void {
  const ids = userIds.filter(Boolean);
  if (ids.length) sql(`delete from ops.vendor_query_log where user_id = any(string_to_array(:'u', ',')::uuid[])`, { u: ids.join(',') });
}

/** Removes every rate limit window of the given buckets; for a bucket named after the suite's own throwaway user (admin:<id>). */
export function deleteRateWindows(buckets: string[]): void {
  const b = buckets.filter(Boolean);
  if (b.length) sql(`delete from ops.rate_limit_windows where bucket = any(string_to_array(:'b', ','))`, { b: b.join(',') });
}

/** For buckets every caller shares (worker.ok): notes the rows and hit counts as they are NOW (take it after lockStack, so no other suite is writing) and
 * returns the function that puts exactly that back: a window the suite created is deleted, a window that was already there gets its old count again. */
export function snapshotRateWindows(buckets: string[]): () => void {
  const b = buckets.join(',');
  const before = sql(`select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'ws', window_start, 'hits', hits)), '[]'::jsonb) from ops.rate_limit_windows where bucket = any(string_to_array(:'b', ','))`, { b });
  return () => {
    sql(`with old as (select * from jsonb_to_recordset(:'o'::jsonb) as t(bucket text, ws timestamptz, hits bigint)),
      gone as (delete from ops.rate_limit_windows w where w.bucket = any(string_to_array(:'b', ',')) and not exists (select 1 from old where old.bucket = w.bucket and old.ws = w.window_start))
      update ops.rate_limit_windows w set hits = old.hits from old where w.bucket = old.bucket and w.window_start = old.ws and w.hits <> old.hits`, { b, o: before });
  };
}
