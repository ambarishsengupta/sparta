-- WO-0163 (R8b) / NFR-8; LLD 4.5, 10 Backups, 13.3: the read-only backup role and the deletion log. This suite cannot `set role backup_role`
-- (it is not a member of that role, see 006), so it reads the catalog: attributes from pg_roles, privileges from has_*_privilege and the
-- ACLs, default privileges from pg_default_acl, and the default privileges are also proved by creating a table and a sequence. The deletion
-- log is then filled by the real paths (self-service deletion, end-of-pilot deletion of a participant, end-of-pilot deletion of vendors).
-- Everything runs in this rolled-back transaction. People: E an admin; K1 and K2 consumers; V1, V2, V3 vendors.
begin;
\ir helpers.inc
select plan(54);

-- ---- 1. the role's attributes ----------------------------------------------------------------------------------------------------------------
select is((select count(*) from pg_roles where rolname = 'backup_role'), 1::bigint, 'NFR-8 backup_role exists');
select ok((select rolbypassrls from pg_roles where rolname = 'backup_role'), 'NFR-8 backup_role has bypassrls (pg_dump stops at a table whose rows RLS hides)');
select is((select rolsuper::text || rolcreaterole::text || rolcreatedb::text || rolreplication::text from pg_roles where rolname = 'backup_role'),
  'falsefalsefalsefalse', 'NFR-8 backup_role is not superuser, cannot create roles or databases, cannot replicate');
select is((select rolcanlogin::text || '|' || rolinherit::text || '|' || rolconnlimit from pg_roles where rolname = 'backup_role'), 'true|false|2',
  'NFR-8 backup_role can log in (no password is set here), does not inherit, and has a connection limit of 2');
select ok((select rolconfig @> array['default_transaction_read_only=on'] from pg_roles where rolname = 'backup_role'), 'NFR-8 its transactions start read-only');
select is_empty($$ select 1 from pg_auth_members m where m.member = 'backup_role'::regrole $$,
  'NFR-8 backup_role is a member of no role (not pg_read_all_data: that would read pg_authid and reach pg_cron tables)');
select is_empty($$ select 1 from pg_auth_members m where m.roleid = 'backup_role'::regrole and (m.set_option or m.inherit_option) $$,
  'NFR-8 no role can become backup_role or inherit it (the creator holds only the admin option, like worker_role)');

-- ---- 2. select on every table, write on none ---------------------------------------------------------------------------------------------------
create temp table dumped as
  select c.oid, n.nspname || '.' || c.relname as tbl, c.relkind, n.nspname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app', 'catalog', 'ops', 'public', 'auth', 'storage', 'supabase_migrations') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');
create temp table dumped_rel as select * from dumped where relkind <> 'S';
select ok((select count(*) from dumped_rel where relkind in ('r', 'p') and nspname in ('app', 'catalog', 'ops')) >= 40, 'the dumped schemas have tables (the checks below are not empty)');
select is_empty($$ select tbl from dumped_rel where relkind in ('r', 'p') and nspname in ('app', 'catalog', 'ops', 'public', 'supabase_migrations')
  and not has_table_privilege('backup_role', oid, 'select') $$, 'NFR-8 select on every table of app, catalog, ops, public and supabase_migrations');
select ok(has_table_privilege('backup_role', 'auth.users', 'select') and has_table_privilege('backup_role', 'storage.objects', 'select'),
  'NFR-8 select on auth.users and storage.objects');
create temp table all_rel as
  select c.oid, n.oid as nsp, n.nspname || '.' || c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and c.relkind in ('r', 'p', 'v', 'm', 'f');
select is_empty($$ select tbl, p from all_rel, unnest(array['insert', 'update', 'delete', 'truncate']) p
  where has_table_privilege('backup_role', oid, p) and has_schema_privilege('backup_role', nsp, 'usage') $$,
  'NFR-8 no insert, update, delete or truncate that backup_role can reach, on any table or view of ANY schema (a PUBLIC grant on cron.job_run_details counts only with usage on schema cron)');
select ok(not has_schema_privilege('backup_role', 'cron', 'usage') and not has_schema_privilege('backup_role', 'vault', 'usage') and not has_schema_privilege('backup_role', 'extensions', 'usage'),
  'NFR-8 and it has no usage on the platform schemas cron, vault and extensions');
select is_empty($$ select tbl, p from dumped_rel, unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
  where has_table_privilege('backup_role', oid, p) $$, 'NFR-8 no insert, update, delete, truncate, references or trigger on any table or view');
select is_empty($$ select tbl, p from dumped_rel, unnest(array['insert', 'update', 'references']) p
  where has_any_column_privilege('backup_role', oid, p) $$, 'NFR-8 and no column-level write grant either');
create temp table dumped_seq as select * from dumped where relkind = 'S';
select is_empty($$ select tbl from dumped_seq where nspname in ('app', 'catalog', 'ops', 'public', 'supabase_migrations') and not has_sequence_privilege('backup_role', oid, 'select') $$,
  'NFR-8 select on every sequence of the app schemas');
select is_empty($$ select tbl, p from dumped_seq, unnest(array['usage', 'update']) p where has_sequence_privilege('backup_role', oid, p) $$,
  'NFR-8 no usage and no update (no nextval, no setval) on any sequence');
-- usage on schema auth is NOT asserted: postgres cannot grant it (supabase_admin owns auth); the SA / WO-0164 grant it out of band (migration header)
select is_empty($$ select s from unnest(array['app', 'catalog', 'ops', 'public', 'storage', 'supabase_migrations']) s where not has_schema_privilege('backup_role', s, 'usage') $$,
  'NFR-8 usage on the six schemas postgres can grant (auth is provided out of band)');
select is_empty($$ select n.nspname from pg_namespace n where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and has_schema_privilege('backup_role', n.oid, 'create') $$,
  'NFR-8 create on no schema');
select ok(not has_database_privilege('backup_role', current_database(), 'create'), 'NFR-8 no create on the database');

-- ---- 3. default privileges: a later table is readable too ---------------------------------------------------------------------------------------
select is_empty($$ select s, k from unnest(array['app', 'catalog', 'ops', 'public', 'supabase_migrations']) s, unnest(array['r', 'S']) k
  where not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = s::regnamespace and d.defaclobjtype = k
                       and a.grantee = 'backup_role'::regrole and a.privilege_type = 'SELECT') $$,
  'NFR-8 pg_default_acl: postgres grants select on future tables and sequences of the five schemas to backup_role');
select is_empty($$ select 1 from pg_default_acl d, aclexplode(d.defaclacl) a where a.grantee = 'backup_role'::regrole and a.privilege_type <> 'SELECT' $$,
  'NFR-8 pg_default_acl: the only default privilege backup_role gets is select');
create table ops.wo0163_probe (a int);
create sequence ops.wo0163_probe_seq;
select ok(has_table_privilege('backup_role', 'ops.wo0163_probe', 'select') and has_sequence_privilege('backup_role', 'ops.wo0163_probe_seq', 'select'),
  'NFR-8 a table and a sequence created now are readable by backup_role');
select ok(not has_any_column_privilege('backup_role', 'ops.wo0163_probe', 'insert') and not has_table_privilege('backup_role', 'ops.wo0163_probe', 'delete')
  and not has_sequence_privilege('backup_role', 'ops.wo0163_probe_seq', 'usage'), 'and not writable');

-- ---- 4. ops.deletion_log ---------------------------------------------------------------------------------------------------------------------
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
  where a.attrelid = 'ops.deletion_log'::regclass and a.attnum > 0 and not a.attisdropped), 'user_id:uuid,deleted_at:timestamp with time zone',
  'LLD 13.3 ops.deletion_log has exactly two columns: user_id uuid and deleted_at timestamptz');
select is_empty($$ select 1 from pg_constraint c where c.contype = 'f' and (c.conrelid = 'ops.deletion_log'::regclass or c.confrelid = 'ops.deletion_log'::regclass) $$,
  'LLD 13.3 ops.deletion_log has no foreign key, in or out');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.deletion_log'::regclass), 'ops.deletion_log has row-level security enabled and forced');
select is_empty($$ select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'ops.deletion_log'::regclass
  and a.grantee <> c.relowner and not (a.grantee = 'backup_role'::regrole and a.privilege_type = 'SELECT') $$,
  'ops.deletion_log: the ACL names only its owner and backup_role (select only); PUBLIC holds nothing');
select ok((select relacl is not null from pg_class where oid = 'ops.deletion_log'::regclass), 'the ACL is explicit (not the default)');
select is_empty($$ select r, p from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
  where has_table_privilege(r, 'ops.deletion_log', p) or (p in ('select', 'insert', 'update', 'references') and has_any_column_privilege(r, 'ops.deletion_log', p)) $$,
  'LLD 13.3 anon, authenticated and service_role hold no privilege on ops.deletion_log');
-- (the API roles hold no usage on schema ops, so the refusal comes there; the ACL tests above show the table itself grants them nothing)
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select count(*) from ops.deletion_log'), 'err=42501: permission denied for schema ops', 'authenticated cannot read it');
select is(pg_temp.val_as(null, 'service_role', 'select count(*) from ops.deletion_log'), 'err=42501: permission denied for schema ops', 'service_role cannot read it');
select is(pg_temp.val_as(null, 'anon', 'select count(*) from ops.deletion_log'), 'err=42501: permission denied for schema ops', 'anon cannot read it');
select is_empty($$ select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'ops.delete_participant(uuid)'::regprocedure and a.grantee <> p.proowner $$,
  'ops.delete_participant is still granted to no role at all (its owner only)');

-- ---- 5. the deletions write the log ----------------------------------------------------------------------------------------------------------
delete from auth.users;
delete from ops.deletion_log;
select pg_temp.mk_user(u) from unnest(array['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
  'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'dddddddd-dddd-dddd-dddd-ddddddddddd3']::uuid[]) u;
update app.profiles set role = 'admin' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
update app.profiles set role = 'vendor' where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'dddddddd-dddd-dddd-dddd-ddddddddddd3');
create function pg_temp.sv(p_sql text) returns text language sql as $f$ select pg_temp.val_as(null, 'service_role', p_sql) $f$;
create function pg_temp.logn() returns bigint language sql as $f$ select count(*) from ops.deletion_log $f$;
create function pg_temp.ids() returns text language sql as
  $f$ select coalesce(string_agg(substr(user_id::text, 1, 2) || right(user_id::text, 1), ',' order by user_id), '-') from ops.deletion_log $f$;

-- self-service: K1 deletes their own account
select is(pg_temp.val_fresh('b0000000-0000-4000-8000-000000000001', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'self-service deletion succeeds');
select is(pg_temp.ids(), 'b01', 'LLD 13.3 a self-service deletion adds exactly one row, with the user id');
select ok((select deleted_at between now() - interval '1 minute' and now() + interval '1 minute' from ops.deletion_log), 'with the time of the deletion');
select is(pg_temp.val_fresh('b0000000-0000-4000-8000-000000000001', 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'a retry finds nothing left');
select is(pg_temp.logn(), 1::bigint, 'and a retry adds no second row');

-- end of the pilot, close: K2 is marked, then deleted by the admin function
update ops.settings set value = case key when 'pilot_end_date' then to_char(current_date, 'YYYY-MM-DD') else 'close' end where key in ('pilot_end_date', 'pilot_outcome');
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 5)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), 'err=55000: participants_remaining', 'the vendor end is refused while a consumer is left');
select is(pg_temp.logn(), 1::bigint, 'and a refused call logs nothing');
select is((pg_temp.sv(format('select app.admin_end_pilot_next(%L, 10)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'))::jsonb ->> 'remaining'), '0', 'the batch marks K2');
select is(pg_temp.logn(), 1::bigint, 'marking logs nothing: only a deletion does');
select is(pg_temp.sv(format('select app.admin_end_pilot_delete(%L, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'c0000000-0000-4000-8000-000000000002'))::jsonb ->> 'deleted', 'true',
  'the end-of-pilot deletion of K2 succeeds');
select is(pg_temp.ids(), 'b01,c02', 'LLD 13.3 it adds exactly one row, K2''s');
select is(pg_temp.sv(format('select app.admin_end_pilot_delete(%L, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'c0000000-0000-4000-8000-000000000002')), 'err=55000: not_marked',
  'a repeat is refused');
select is(pg_temp.logn(), 2::bigint, 'and logs nothing');

-- end of the pilot, close: the vendor users (security review of WO-0159)
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 2)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'))::jsonb ->> 'vendor_users_deleted', '2', 'the first vendor call deletes two vendor users');
select is(pg_temp.ids(), 'b01,c02,dd1,dd2', 'WO-0159 review: one deletion-log row per deleted vendor id (the two smallest ids)');
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 2)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'))::jsonb ->> 'vendor_users_deleted', '1', 'the second call deletes the last one');
select is(pg_temp.ids(), 'b01,c02,dd1,dd2,dd3', 'WO-0159 review: and logs it');
select is(pg_temp.sv(format('select app.admin_end_pilot_vendors(%L, 2)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'))::jsonb ->> 'vendor_users_deleted', '0', 'a third call deletes nobody');
select is(pg_temp.logn(), 5::bigint, 'WO-0159 review: and adds no row');
select is((select count(*) from ops.deletion_log where deleted_at < now() - interval '1 minute' or deleted_at > now() + interval '1 minute'), 0::bigint, 'every row carries the time of its deletion');
select is((select count(*) from ops.deletion_log l where exists (select 1 from auth.users u where u.id = l.user_id)), 0::bigint, 'and every logged id is really gone from auth.users (the admin is not logged)');

select * from finish();
rollback;
