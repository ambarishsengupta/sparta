-- WO-0163 (R8b): the read-only backup role `backup_role` and the deletion log `ops.deletion_log` (NFR-8; LLD 4.5, 10 Backups, 13.3).
--
-- THE PASSWORD IS NOT HERE. Like worker_role (20261106110100) the role is created with LOGIN but no password, so nobody can sign in as it
-- until a password is set outside the repository (locally by the rehearsal of WO-0164, which sets a generated one at run time and clears
-- it; on a hosted project by the SA, item H-BACKUP). Roles live outside the database: `supabase db reset` keeps them, so the role is
-- created only if missing and its password is never touched here.
--
-- bypassrls instead of policies (LLD 4.5): pg_dump stops at any table whose rows row-level security would hide, so the role has the
-- `bypassrls` attribute and plain `select`, and no write privilege of any kind. The privileged attributes can only be given by a
-- sufficiently privileged creator, so they are stated once, when the role is created (the local migration role can create a bypassrls role:
-- probed 2026-11-19); the pgTAP suite reads them from the catalog and fails if they ever differ.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'backup_role') then
    create role backup_role with login nosuperuser nocreatedb nocreaterole noinherit bypassrls noreplication connection limit 2;
  else
    alter role backup_role with login noinherit connection limit 2;
  end if;
end $$;
-- a second line of defence: every transaction of this role starts read-only (a session can lift it, so it is not the control; the grants are)
alter role backup_role set default_transaction_read_only = 'on';

-- ---- the deletion log (LLD 13.3) -------------------------------------------------------------------------------------------------------
-- A restore never brings back a deleted account: the id and time of each deletion are kept here, so the team can delete those users again
-- after a restore. EXACTLY two columns, no foreign key (the user row is gone) and no email or other detail: a user id and a time. Written
-- only by ops.delete_participant and app.admin_end_pilot_vendors below; read by no application role (revoked from every API role), and
-- by backup_role (bypassrls and the select grant below) and the table owner.
create table ops.deletion_log (
  user_id uuid not null,
  deleted_at timestamptz not null default now()
);
alter table ops.deletion_log enable row level security;
alter table ops.deletion_log force row level security;
revoke all on ops.deletion_log from public, anon, authenticated, service_role;

-- ---- ops.delete_participant: the one deletion of a person also writes the log ---------------------------------------------------------------
-- Body of 20261118100000 plus one insert, after the auth.users row is really deleted (so a retry that finds nothing logs nothing).
-- Same signature, owner and grants (create or replace keeps them: execute for nobody).
create or replace function ops.delete_participant(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_deleted boolean;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where (storage.foldername(o.name))[1] = p_user::text;
  perform set_config('storage.allow_delete_query', 'false', true);

  delete from auth.users u where u.id = p_user returning u.email into v_email;
  v_deleted := found;
  delete from auth.audit_log_entries a
   where position(p_user::text in lower(a.payload::text)) > 0
      or (v_email is not null and v_email <> '' and position(lower(v_email) in lower(a.payload::text)) > 0);
  if not v_deleted then
    return 'already_deleted';
  end if;
  insert into ops.deletion_log (user_id, deleted_at) values (p_user, now());
  if v_email is not null then
    delete from ops.invitations i where i.email = lower(v_email);
  end if;
  insert into ops.daily_counts (day, metric, n) values (current_date, 'deletions', 1)
  on conflict (day, metric) do update set n = ops.daily_counts.n + 1;
  return 'deleted';
end $$;

-- ---- app.admin_end_pilot_vendors: one log row per deleted vendor user (security review of WO-0159) -----------------------------------------
-- Body of 20261118110000; the only change is the auth.users delete, which now writes ops.deletion_log in the same statement (a data-changing
-- CTE), one row per row it really deleted. Same signature, owner and grants.
create or replace function app.admin_end_pilot_vendors(p_admin uuid, p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw text := (select s.value from ops.settings s where s.key = 'pilot_end_date');
  v_end date;
  v_outcome text := (select s.value from ops.settings s where s.key = 'pilot_outcome');
  v_items bigint;
  v_users bigint := 0;
  v_remaining bigint;
  v_ids uuid[];
  v_emails text[];
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_end := case when v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_raw::date end;
  if v_end is null or current_date < v_end then
    raise exception 'pilot_not_ended' using errcode = '55000';
  end if;
  if v_outcome is distinct from 'close' then
    raise exception 'not_closing' using errcode = '55000';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if exists (select 1 from app.profiles p where p.role = 'consumer') then
    raise exception 'participants_remaining' using errcode = '55000';
  end if;

  -- 1. the vendors' feed items leave the consumer catalogue (the rows stay, withdrawn)
  update catalog.catalog_items ci set status = 'withdrawn' where ci.vendor_id is not null and ci.status <> 'withdrawn';
  get diagnostics v_items = row_count;

  -- 2. the vendor query log, in full
  delete from ops.vendor_query_log where true;

  -- 3. up to p_limit vendor users: invitation rows, the auth.users rows (each one logged), then the Auth audit-log entries that name them
  select coalesce(array_agg(x.id), '{}'), coalesce(array_agg(lower(x.email)) filter (where x.email is not null and x.email <> ''), '{}')
    into v_ids, v_emails
    from (select p.id, u.email from app.profiles p left join auth.users u on u.id = p.id
           where p.role = 'vendor' order by p.id limit p_limit) x;
  if cardinality(v_ids) > 0 then
    delete from ops.invitations i where i.email = any (v_emails);
    with d as (delete from auth.users u where u.id = any (v_ids) returning u.id),
         l as (insert into ops.deletion_log (user_id, deleted_at) select d.id, now() from d returning user_id)
    select count(*) into v_users from l;
    delete from auth.audit_log_entries a
     where exists (select 1 from unnest(v_ids) d(id) where position(d.id::text in lower(a.payload::text)) > 0)
        or exists (select 1 from unnest(v_emails) e(addr) where position(e.addr in lower(a.payload::text)) > 0);
  end if;
  select count(*) into v_remaining from app.profiles p where p.role = 'vendor';

  perform app.write_admin_audit(p_admin, 'pilot.end_vendors', v_items::text || ':' || v_users::text || ':' || v_remaining::text);
  return jsonb_build_object('vendor_items_withdrawn', v_items, 'vendor_users_deleted', v_users, 'remaining', v_remaining);
end $$;

-- ---- backup_role: usage, select, nothing else -------------------------------------------------------------------------------------------
-- Schemas the dump needs: app, catalog, ops, public, supabase_migrations, and auth and storage (auth.users, which every app table
-- references, and storage.objects). Usage on the schemas and select on every table and sequence that this migration role may grant on
-- (LLD 4.5). Two things the migration role cannot do, because Supabase owns the objects:
--  1. `usage on schema auth` cannot be granted by postgres (supabase_admin owns the schema; postgres holds plain usage, no grant option).
--     It is granted out of band by supabase_admin: on a hosted project by the SA (item H-BACKUP); locally the restore rehearsal (WO-0164)
--     runs the same one line, `grant usage on schema auth to backup_role`, as supabase_admin at run time. Table-level select on auth.users
--     IS granted here; the schema usage completes it. No test asserts the schema usage.
--  2. select on 21 tables that Supabase's Auth and Storage platform features own, which give postgres no grant option: auth.oauth_authorizations,
--     oauth_clients, oauth_consents, oauth_client_states, custom_oauth_providers, webauthn_credentials, webauthn_challenges, scim_users,
--     scim_tokens, mfa_recovery_code_sets, mfa_recovery_codes; storage.iceberg_namespaces, iceberg_tables, buckets_analytics,
--     lifecycle_abandoned_artifacts, bucket_lifecycle_states, migrations, s3_multipart_uploads, s3_multipart_uploads_parts, buckets_vectors,
--     vector_indexes. They hold no pilot data. The dump uses `--exclude-table-data` for them, and the roles come from
--     `pg_dumpall --roles-only --no-role-passwords` (backup_role cannot read password hashes, and must not).
-- Deliberately NOT done: membership of pg_read_all_data. It would give usage on every schema and let the role read pg_authid (password
-- verifiers) and delete from cron.job_run_details (PUBLIC holds delete there): neither is a read-only backup role (security review).
-- No create on any schema, no insert, update, delete, truncate, references or trigger on any table or view in any schema.
grant usage on schema app, catalog, ops, public, supabase_migrations, storage to backup_role;
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('app', 'catalog', 'ops', 'public', 'auth', 'storage', 'supabase_migrations')
       and c.relkind in ('r', 'p', 'S')
       and has_table_privilege('postgres', c.oid, 'select with grant option')
  loop
    execute format('grant select on %s %I.%I to backup_role', case when r.relkind = 'S' then 'sequence' else 'table' end, r.nspname, r.relname);
  end loop;
end $$;

-- a table or sequence a LATER migration creates (run as postgres) is readable too (LLD 4.5)
alter default privileges for role postgres in schema app, catalog, ops, public, supabase_migrations grant select on tables to backup_role;
alter default privileges for role postgres in schema app, catalog, ops, public, supabase_migrations grant select on sequences to backup_role;
