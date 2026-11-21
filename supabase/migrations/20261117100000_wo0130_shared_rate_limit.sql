-- WO-0130 (A13), part 2: a rate limit that holds across server instances. The routes keep their per-process limiter as the first brake; this table and
-- function are the second one, shared by every instance because the count lives in the database (LLD 10; same pattern as ops.vendor_query_log).
--
-- ops.rate_limit_windows: one row per (bucket, fixed window). `bucket` is a short lower-case key made by the server (for example worker.ok,
-- purge:<user id>, admin:<user id>); it holds no personal text beyond a user id the server took from a verified session.
-- No grant to any client role and none to service_role: RLS is on and forced, and the only code that touches the table is app.rate_limit_hit
-- (security definer, search_path pinned), which the secret-key routes may execute and nobody else.
create table ops.rate_limit_windows (
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  window_start timestamptz not null,
  hits bigint not null check (hits >= 1),
  primary key (bucket, window_start)
);
create index on ops.rate_limit_windows (window_start);
alter table ops.rate_limit_windows enable row level security;
alter table ops.rate_limit_windows force row level security;
revoke all on ops.rate_limit_windows from public, anon, authenticated, service_role;

-- Counts one call in the current fixed window of p_bucket and says whether it is within p_max: true = allowed, false = over the limit.
-- A refused call is counted as well (a caller that keeps knocking stays refused until the window ends). Windows are aligned to the epoch, so every
-- instance computes the same window. Windows older than one day are deleted on the way (a delete on an indexed column; nothing to do most of the time).
-- The arguments are checked, not trusted: a bad bucket, limit or window raises 22023 and counts nothing.
create function app.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_start timestamptz; v_hits bigint;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_.:-]{0,63}$' then raise exception 'invalid_rate_bucket' using errcode = '22023'; end if;
  if p_max is null or p_max < 1 or p_max > 100000 then raise exception 'invalid_rate_max' using errcode = '22023'; end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'invalid_rate_window' using errcode = '22023'; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  delete from ops.rate_limit_windows where window_start < now() - interval '1 day';
  insert into ops.rate_limit_windows as w (bucket, window_start, hits) values (p_bucket, v_start, 1)
    on conflict (bucket, window_start) do update set hits = w.hits + 1
    returning w.hits into v_hits;
  return v_hits <= p_max;
end $$;
revoke execute on function app.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, integer, integer) to service_role;
