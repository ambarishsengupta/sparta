-- WO-0098 (R7a) migration 1: the aggregation tables of LLD 5.1 and 5.2 and the schema grant the vendor functions will need (LLD 4.1, section 10).
-- The lookup rows (price bands, region map, Letter sizes) come from supabase/seed/lookups.sql, generated from packages/taxonomy.
-- All four tables are deny by default: RLS enabled and forced, no policy, no grant to anon, authenticated or service_role. Only the migration role
-- (the owner of the security definer functions that come in WO-0099 and later) touches them.

-- One row per aggregation run (FR-86). The run function (WO-0099) inserts it as 'running' and finishes it as 'ok' or 'error' with a fixed code.
create table ops.aggregate_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  users_included int check (users_included >= 0),
  items_included int check (items_included >= 0),
  rows_suppressed int check (rows_suppressed >= 0),
  duration_ms int check (duration_ms >= 0),
  check ((status = 'running') = (finished_at is null)),
  check ((status = 'error') = (error_code is not null))
);

-- The anonymised fact table (LLD 5.1 step 4): exactly these columns, grouped columns never null, no name, email, note, image, path, receipt,
-- store, colour value or feature. user_hash is a salted digest; the salt is a parameter of build_facts and is never stored.
create table analytics_private.facts (
  user_hash text not null check (user_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('owned', 'wishlist_open', 'wishlist', 'purchase')),
  period date not null check (period = date_trunc('month', period)::date),
  category text not null,
  sub_type text not null,
  colour_family text not null,
  fit text not null,
  brand text not null,
  size text not null,
  season text not null,
  price_band text not null,
  condition_band text,                      -- owned only: a band code or 'Unrated'; null for the other kinds
  region text not null,
  check ((kind = 'owned') = (condition_band is not null))
);

-- The staging table of the run (LLD 5.2): raw counts, emptied at the start of every run and truncated after publishing.
-- A null in a dimension column means "all"; facts never hold nulls there, so a null comes only from the grouping.
create table analytics_private.cube_stage (
  kind text not null, period date not null,
  d_category text, d_colour_family text, d_fit text, d_brand text,
  f_size text, f_season text, f_price_band text, f_region text,
  condition_band text,
  users int not null check (users >= 0),
  events int not null check (events >= 0)
);

-- The published cube (LLD 5.2): rounded values and users_floor only, never the raw counts. users_floor serves the second minimum-group check
-- of LLD 5.4 and is never returned to a vendor.
create table analytics.cube (
  run_id bigint not null references ops.aggregate_runs(id),
  kind text not null, period date not null,
  d_category text, d_colour_family text, d_fit text, d_brand text,
  f_size text, f_season text, f_price_band text, f_region text,
  condition_band text,
  users_rounded int not null check (users_rounded > 0),
  events_rounded int not null check (events_rounded > 0),
  users_floor int not null check (users_floor >= 0)
);

alter table ops.aggregate_runs enable row level security;
alter table ops.aggregate_runs force row level security;
alter table analytics_private.facts enable row level security;
alter table analytics_private.facts force row level security;
alter table analytics_private.cube_stage enable row level security;
alter table analytics_private.cube_stage force row level security;
alter table analytics.cube enable row level security;
alter table analytics.cube force row level security;
revoke all on ops.aggregate_runs, analytics_private.facts, analytics_private.cube_stage, analytics.cube from public, anon, authenticated, service_role;
revoke all on sequence ops.aggregate_runs_id_seq from public, anon, authenticated, service_role;

-- Signed-in users may reach the vendor functions that WO-0100 puts in schema analytics (each function checks the role itself); the tables stay
-- closed. analytics_private gets no usage for anyone but its owner, and service_role gets none on analytics until a service-only function needs it.
grant usage on schema analytics to authenticated;
revoke usage on schema analytics from anon, service_role;
revoke usage on schema analytics_private from public, anon, authenticated, service_role;
