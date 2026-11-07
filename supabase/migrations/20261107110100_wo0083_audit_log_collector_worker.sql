-- WO-0083 (R6b) migration 2: ops.admin_audit_log (LLD 6), the limited role collector_role (LLD 4.5, 8.1) and the worker's read of the catalogue
-- (LLD 4.5, 7.1).
--
-- THE PASSWORD IS NOT HERE. collector_role is created with LOGIN but no password, so nobody can sign in as it until a password is set outside
-- the repository: locally by the git-ignored supabase/scripts/set-collector-password.sh (reads SPARTA_COLLECTOR_DB_PASSWORD); on a hosted project by
-- hand (O6). Like worker_role it is a member of no role, nobody is a member of it, it has no bypassrls, and every table it touches has an explicit policy.
-- Roles live outside the database (`supabase db reset` keeps them), so it is created only when missing and its password is never touched here.

-- ---- the admin audit log (LLD 6): no grants for anyone; the admin routes will write it through a definer function (WO-0088) ----------
-- `target` is a row id, or a count: the check below keeps free text, spaces and e-mail addresses out of it (no "@", no spaces).
create table ops.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null check (action ~ '^[a-z0-9_.:-]{1,64}$'),
  target text check (target ~ '^[A-Za-z0-9_:+-]{1,64}$'),
  at timestamptz not null default now()
);
alter table ops.admin_audit_log enable row level security;
alter table ops.admin_audit_log force row level security;
revoke all on ops.admin_audit_log from public, anon, authenticated, service_role;

-- ---- collector_role ----------------------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'collector_role') then
    create role collector_role with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication connection limit 3;
  else
    alter role collector_role with login noinherit connection limit 3;
  end if;
end $$;
alter role collector_role set statement_timeout = '60s';
alter role collector_role set idle_in_transaction_session_timeout = '60s';
comment on role collector_role is 'WO-0083: the catalogue collector (LLD 8.1). LOGIN without a password in any migration. Member of no role. Sees catalog.sources, the lookups and source-owned catalogue rows only; never vendor rows.';

-- exactly LLD 4.5 and 8.1: usage on catalog; select on sources and update of last_collected_at only; select on the lookups and colour_family_ref (the colour
-- trigger runs as the caller and reads it); select, insert and update on catalog_items where source_id is not null. No delete (rows are withdrawn, not deleted).
grant usage on schema catalog to collector_role;
grant select on catalog.sources to collector_role;
grant update (last_collected_at) on catalog.sources to collector_role;
grant select, insert, update on catalog.catalog_items to collector_role;
grant select on catalog.colour_family_ref to collector_role;
create policy sources_collector_select on catalog.sources for select to collector_role using (true);
create policy sources_collector_update on catalog.sources for update to collector_role using (true) with check (true);
create policy catalog_items_collector_select on catalog.catalog_items for select to collector_role using (source_id is not null);
create policy catalog_items_collector_insert on catalog.catalog_items for insert to collector_role with check (source_id is not null);
create policy catalog_items_collector_update on catalog.catalog_items for update to collector_role using (source_id is not null) with check (source_id is not null);
create policy colour_family_ref_collector_read on catalog.colour_family_ref for select to collector_role using (true);
do $$
declare t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'catalog'::regnamespace and c.relkind = 'r' and c.relname like 'lk\_%' loop
    execute format('grant select on catalog.%I to collector_role', t);
    execute format('create policy %I on catalog.%I for select to collector_role using (true)', t || '_collector_read', t);
  end loop;
end $$;
-- the colour trigger calls these as the caller (they are revoked from public)
grant execute on function catalog.rgb_hex(int, int, int), catalog.colour_family(int, int, int), catalog.rgb_to_lab(int, int, int), catalog.srgb_lin(float8) to collector_role;

-- ---- worker_role: select on active catalogue rows for the receipt match (LLD 7.1; extensions.similarity is already open to it) -----------------
grant select on catalog.catalog_items to worker_role;
create policy catalog_items_worker_select on catalog.catalog_items for select to worker_role using (status = 'active');
