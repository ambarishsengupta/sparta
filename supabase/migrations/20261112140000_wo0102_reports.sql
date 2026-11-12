-- WO-0102 (R7a): vendor reports (LLD 5.5; FR-78, FR-79). A report is a stored snapshot of published, rounded figures only.
-- ops.reports has no client grant. analytics.build_report is executable by service_role only (it runs no vendor checks; the admin route calls it, a vendor never does)
-- and builds its payload from the internal q_* functions of 5.4 plus the cube's first and last period, so it holds only what a vendor could see. Vendors read through
-- analytics.reports() and analytics.report(p_id) behind the WO-0100 guard, reviewed rows only. Marking a report reviewed has no function in this release (the admin
-- routes are Release 1); the demo seed does it with a direct update as postgres.
-- service_role had no usage on schema analytics (WO-0098), so this migration grants exactly that and execute on build_report; every other function stays closed to it.
-- Decisions where the documents are silent (workflow/evidence/R7/WO-0102-NOTES.md): the gaps are those of the latest cube period (p_period names the report and the
-- rising month); the payload keys are fixed here; a null period raises unsupported_period.

create table ops.reports (
  id uuid primary key default gen_random_uuid(),
  period date not null check (period = date_trunc('month', period)::date),
  generated_at timestamptz not null default now(),
  reviewed_by uuid,   -- the reviewing admin's id; no foreign key (a report outlives the admin, and test 008 allows no non-cascading key into app.*)
  reviewed_at timestamptz,
  payload jsonb not null
);
alter table ops.reports enable row level security;
alter table ops.reports force row level security;
revoke all on table ops.reports from public, anon, authenticated, service_role;

-- top 10 gaps on category x colour family, top 10 rising wishlist categories (this month above last month, both rows visible, ranked by the increase), the condition
-- spectrum of every category, coverage, the run time and the cube's first and last period. Every count is a rounded value or a difference of two; every share is a multiple of 5.
create function analytics.build_report(p_period date) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_period date := date_trunc('month', p_period)::date; v_cov record; v_id uuid;
begin
  if p_period is null then raise exception 'unsupported_period'; end if;
  select c.users_rounded, c.last_run_at into v_cov from analytics_private.q_coverage() c;
  insert into ops.reports (period, payload) values (v_period, jsonb_build_object(
    'period', v_period,
    'coverage', jsonb_build_object('users_rounded', v_cov.users_rounded, 'last_run_at', v_cov.last_run_at),
    'cube_first_period', (select min(c.period) from analytics.cube c), 'cube_last_period', (select max(c.period) from analytics.cube c),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('segment', g.segment, 'owner_users_rounded', g.o, 'wishlist_users_rounded', g.w, 'gap_score', g.score, 'label', g.label) order by g.n)
                      from analytics_private.q_gaps('category_colour_family', null, null, 10) with ordinality g(segment, o, w, score, label, n)), '[]'::jsonb),
    'rising_wishlist', coalesce((with t as (select x.period, x.segment, x.users_rounded from analytics_private.q_trend('wishlist', 'category', 'month', null, null) x)
      select jsonb_agg(jsonb_build_object('segment', r.segment, 'users_rounded', r.u, 'previous_users_rounded', r.p, 'increase', r.u - r.p) order by r.u - r.p desc, r.segment)
      from (select a.segment, a.users_rounded u, b.users_rounded p from t a join t b on b.segment = a.segment and b.period = (v_period - interval '1 month')::date
            where a.period = v_period and a.users_rounded > b.users_rounded order by a.users_rounded - b.users_rounded desc, a.segment limit 10) r), '[]'::jsonb),
    'condition_spectrum', (select jsonb_agg(jsonb_build_object('category', k.code, 'bands',
        (select jsonb_agg(jsonb_build_object('band', s.band, 'share', s.share) order by s.n) from analytics_private.q_condition_spectrum(k.code) with ordinality s(band, share, n))) order by k.sort, k.code)
      from catalog.lk_category k where k.active)
  )) returning id into v_id;
  return v_id;
end $$;

-- reviewed reports only, nothing about who reviewed
create function analytics_private.q_reports() returns table (id uuid, period date, reviewed_at timestamptz)
language sql stable set search_path = '' as $$
  select r.id, r.period, r.reviewed_at from ops.reports r where r.reviewed_at is not null order by r.period desc, r.reviewed_at desc, r.id $$;
create function analytics_private.q_report(p_id uuid) returns table (id uuid, period date, reviewed_at timestamptz, payload jsonb)
language sql stable set search_path = '' as $$
  select r.id, r.period, r.reviewed_at, r.payload from ops.reports r where r.id = p_id and r.reviewed_at is not null $$;

create function analytics.reports() returns table (id uuid, period date, reviewed_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('reports', '{}'::jsonb);
  return query select * from analytics_private.q_reports();
end $$;
create function analytics.report(p_id uuid) returns table (id uuid, period date, reviewed_at timestamptz, payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform analytics_private.vendor_guard('report', jsonb_build_object('id', p_id));
  return query select * from analytics_private.q_report(p_id);
end $$;

revoke execute on function analytics_private.q_reports(), analytics_private.q_report(uuid) from public, anon, authenticated, service_role;
revoke execute on function analytics.reports(), analytics.report(uuid) from public, anon, service_role;
grant execute on function analytics.reports(), analytics.report(uuid) to authenticated;
revoke execute on function analytics.build_report(date) from public, anon, authenticated;
grant usage on schema analytics to service_role;
grant execute on function analytics.build_report(date) to service_role;
