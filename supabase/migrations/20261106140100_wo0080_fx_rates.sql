-- WO-0080 (R6a) migration 2: ops.fx_rates, app.latest_fx_rates() and the limited role fx_role (LLD 4.5; FR-33).
--
-- THE ROLE CANNOT SIGN IN: it is created NOLOGIN, with no password anywhere. Giving it a login and FX_DATABASE_URL belongs to the owner (O3)
-- and to the day fx.yml exists. Until then rates are inserted by hand and shown by the app. Like worker_role it is a member of no role, has
-- no bypassrls, and gets exactly: usage on schema ops, select/insert/update on ops.fx_rates (select is needed by an upsert), each with a policy.
-- It has no usage on schema app, so it cannot reach app.items or any other table.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fx_role') then
    create role fx_role with nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
  else
    alter role fx_role with nologin noinherit;
  end if;
end $$;
alter role fx_role set statement_timeout = '30s';
comment on role fx_role is 'WO-0080: the limited exchange-rate writer (LLD 4.5). NOLOGIN until the owner decides on a login (O3). Member of no role; the only table it touches is ops.fx_rates.';

create table ops.fx_rates (
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_date date not null,
  per_usd numeric(18,8) not null check (per_usd > 0),   -- units of this currency per 1 USD
  primary key (currency, rate_date)
);
alter table ops.fx_rates enable row level security;
alter table ops.fx_rates force row level security;
revoke all on ops.fx_rates from public, anon, authenticated, service_role;

grant usage on schema ops to fx_role;
grant select, insert, update on ops.fx_rates to fx_role;
create policy fx_rates_select on ops.fx_rates for select to fx_role using (true);
create policy fx_rates_insert on ops.fx_rates for insert to fx_role with check (true);
create policy fx_rates_update on ops.fx_rates for update to fx_role using (true) with check (true);

-- the newest row per currency, for the display conversion (LLD 4.5 text, search_path pinned to the empty path like every definer function)
create function app.latest_fx_rates() returns table (currency char(3), rate_date date, per_usd numeric)
language sql stable security definer set search_path = '' as $$
  select distinct on (f.currency) f.currency, f.rate_date, f.per_usd
  from ops.fx_rates f order by f.currency, f.rate_date desc $$;
revoke execute on function app.latest_fx_rates() from public, anon;
grant execute on function app.latest_fx_rates() to authenticated;
