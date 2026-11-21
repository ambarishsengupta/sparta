-- WO-0182 (R8b) / NFR-8; LLD 4.5, 13.3: backup_role reads the schemas analytics and analytics_private (so the backup covers them) and nothing more. Like 027 this suite cannot
-- `set role backup_role`, so it reads the catalog (has_*_privilege, pg_default_acl, pg_auth_members) and proves the default privileges by creating a table and a sequence.
-- Everything runs in this rolled-back transaction.
begin;
\ir helpers.inc
select plan(16);

create temp table wo0182_rel as
  select c.oid, n.oid as nsp, n.nspname, n.nspname || '.' || c.relname as tbl, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('analytics', 'analytics_private') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');
create temp table wo0182_tab as select * from wo0182_rel where relkind <> 'S';
create temp table wo0182_seq as select * from wo0182_rel where relkind = 'S';

-- ---- 1. usage, and select on every table and sequence ---------------------------------------------------------------------------------------
select is((select count(*) from wo0182_tab where relkind in ('r', 'p')), 7::bigint, 'the two schemas hold the 7 tables the work order names (the checks below are not empty)');
select ok(has_schema_privilege('backup_role', 'analytics', 'usage') and has_schema_privilege('backup_role', 'analytics_private', 'usage'),
  'NFR-8 usage on schema analytics and on schema analytics_private');
select is_empty($$ select tbl from wo0182_tab where not has_table_privilege('backup_role', oid, 'select') $$, 'NFR-8 select on every table of analytics and analytics_private');
select is_empty($$ select tbl from wo0182_seq where not has_sequence_privilege('backup_role', oid, 'select') $$, 'NFR-8 select on every sequence of analytics and analytics_private');

-- ---- 2. nothing else -------------------------------------------------------------------------------------------------------------------------
select is_empty($$ select tbl, p from wo0182_tab, unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p where has_table_privilege('backup_role', oid, p) $$,
  'NFR-8 no insert, update, delete, truncate, references or trigger on any table of the two schemas');
select is_empty($$ select tbl, p from wo0182_tab, unnest(array['insert', 'update', 'references']) p where has_any_column_privilege('backup_role', oid, p) $$,
  'NFR-8 and no column-level write grant either');
select is_empty($$ select tbl, p from wo0182_seq, unnest(array['usage', 'update']) p where has_sequence_privilege('backup_role', oid, p) $$,
  'NFR-8 no usage and no update (no nextval, no setval) on any sequence of the two schemas');
select ok(not has_schema_privilege('backup_role', 'analytics', 'create') and not has_schema_privilege('backup_role', 'analytics_private', 'create'),
  'NFR-8 create on neither schema');
select is_empty($$ select p.proname from pg_proc p, aclexplode(p.proacl) a
  where p.pronamespace in ('analytics'::regnamespace, 'analytics_private'::regnamespace) and a.grantee = 'backup_role'::regrole $$,
  'NFR-8 no execute (no function grant of any kind) for backup_role on the functions of the two schemas');

-- ---- 3. default privileges: a later table or sequence is readable too -----------------------------------------------------------------------
select is_empty($$ select s, k from unnest(array['analytics', 'analytics_private']) s, unnest(array['r', 'S']) k
  where not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = s::regnamespace and d.defaclobjtype = k
                       and a.grantee = 'backup_role'::regrole and a.privilege_type = 'SELECT') $$,
  'NFR-8 pg_default_acl: postgres grants select on future tables and sequences of both schemas to backup_role');
select is_empty($$ select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclnamespace in ('analytics'::regnamespace, 'analytics_private'::regnamespace) and a.grantee = 'backup_role'::regrole and a.privilege_type <> 'SELECT' $$,
  'NFR-8 pg_default_acl: in these schemas the only default privilege backup_role gets is select');
create table analytics_private.wo0182_probe (a int);
create sequence analytics_private.wo0182_probe_seq;
select ok(has_table_privilege('backup_role', 'analytics_private.wo0182_probe', 'select') and has_sequence_privilege('backup_role', 'analytics_private.wo0182_probe_seq', 'select'),
  'NFR-8 a table and a sequence created now in analytics_private are readable by backup_role');
select ok(not has_any_column_privilege('backup_role', 'analytics_private.wo0182_probe', 'insert') and not has_table_privilege('backup_role', 'analytics_private.wo0182_probe', 'delete')
  and not has_sequence_privilege('backup_role', 'analytics_private.wo0182_probe_seq', 'usage'), 'and not writable');

-- ---- 4. the API boundary is unchanged, and no membership --------------------------------------------------------------------------------------
select is_empty($$ select r.rolname, t.tbl, p from (values ('anon'), ('authenticated'), ('service_role')) r(rolname), wo0182_tab t,
  unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p where has_table_privilege(r.rolname, t.oid, p) $$,
  'anon, authenticated and service_role hold no privilege on any table of analytics or analytics_private (the API boundary is unchanged)');
select is_empty($$ select r.rolname, t.tbl from (values ('anon'), ('authenticated'), ('service_role')) r(rolname), wo0182_tab t
  where has_any_column_privilege(r.rolname, t.oid, 'select') or has_any_column_privilege(r.rolname, t.oid, 'insert') or has_any_column_privilege(r.rolname, t.oid, 'update') $$,
  'and none of them holds a column-level privilege there either');
select is_empty($$ select 1 from pg_auth_members m where m.member = 'backup_role'::regrole $$, 'NFR-8 backup_role is still a member of no role (above all not pg_read_all_data)');

select * from finish();
rollback;
