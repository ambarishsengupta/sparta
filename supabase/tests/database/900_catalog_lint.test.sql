-- WO-0123 (audit of 2026-11-15): the database lint. Every check reads the system catalog and covers EVERY schema that is not part of the
-- platform, so a new schema, table, function, policy, view or bucket is checked from the day it is created without anyone adding it to a list.
-- (003_schema_and_grants names app, ops and catalog; the analytics schemas and anything added later are covered here.)
-- The two short lists below are the only exceptions. Each is compared as a whole, so fixing an entry or adding one both fail until the list is edited.
begin;
\ir helpers.inc
select plan(13);

create temp view lint_schemas as
  select n.oid, n.nspname from pg_namespace n
  where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public', 'auth', 'storage', 'realtime', '_realtime', 'vault', 'extensions', 'graphql',
    'graphql_public', 'cron', 'pgbouncer', 'supabase_functions', 'supabase_migrations', 'net', 'pgsodium', 'pgsodium_masks', '_analytics', 'tap', 'pgtap');
create temp view lint_rels as
  select c.oid, s.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.reloptions, s.nspname || '.' || c.relname as name
  from pg_class c join lint_schemas s on s.oid = c.relnamespace where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');
create temp view lint_fns as
  select p.oid, s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name, s.nspname || '.' || p.proname as short,
         p.prosecdef, coalesce(p.proconfig, '{}') @> array['search_path=""'] as pinned, p.proacl
  from pg_proc p join lint_schemas s on s.oid = p.pronamespace;

-- 1. row-level security
select is_empty($$ select name from lint_rels where relkind in ('r', 'p') and not (relrowsecurity and relforcerowsecurity) order by 1 $$,
  'every table in every project schema has row-level security enabled AND forced');
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1 $$,
  'the public schema holds no table or view (the platform grants anon rights there by default)');
select is_empty($$ select name from lint_rels where relkind in ('v', 'm') and not (coalesce(reloptions, '{}') @> array['security_invoker=true']) order by 1 $$,
  'every view runs with the caller''s rights (security_invoker), so it cannot read past row-level security');

-- 2. functions
select is_empty($$ select name from lint_fns where prosecdef and not pinned order by 1 $$,
  'every security definer function pins an empty search_path');
select is((select coalesce(array_agg(short order by short), '{}') from lint_fns where not prosecdef and not pinned),
  array[]::text[],
  'no function in any project schema leaves search_path open (the WO-0128 exception list is empty)');
select is((select coalesce(array_agg(name order by name), '{}') from lint_fns where has_function_privilege('anon', oid, 'execute')),
  array['app.supported_countries()'],
  'anon can run exactly one function: the country list of the sign-up page (LLD 4.9)');
select is_empty($$ select name from lint_fns f where f.proacl is null or exists (select 1 from aclexplode(f.proacl) a where a.grantee = 0) order by 1 $$,
  'no function is executable by PUBLIC (every create function is followed by a revoke)');

-- 3. grants and policies
select is_empty($$ select name from lint_rels where relkind <> 'S' and (has_table_privilege('anon', oid, 'select,insert,update,delete,truncate,references,trigger')
    or has_any_column_privilege('anon', oid, 'select,insert,update,references')) order by 1 $$,
  'anon holds no privilege on any table, view or column');
select is((select coalesce(array_agg(nspname order by nspname), '{}') from lint_schemas where has_schema_privilege('anon', oid, 'usage')), array['app']::name[],
  'anon has usage on the app schema only (for the one function above)');
select is_empty($$ select schemaname || '.' || tablename || ':' || policyname from pg_policies p join lint_schemas s on s.nspname = p.schemaname
    where p.roles && array['anon', 'public']::name[] order by 1 $$,
  'no policy applies to anon or to every role');
select is_empty($$ select schemaname || '.' || tablename || ':' || policyname from pg_policies p join lint_schemas s on s.nspname = p.schemaname
    where 'authenticated' = any(p.roles) and (p.qual = 'true' or p.with_check = 'true')
      and not (p.schemaname = 'catalog' and p.cmd = 'SELECT' and (p.tablename ~ '^lk_' or p.tablename in ('colour_family_ref', 'country_region'))) order by 1 $$,
  'a signed-in person gets an unconditional policy only to READ the public lookup lists; every other policy has a condition');

-- 4. roles and storage
-- WO-0163 (R8b): backup_role is the one login that HAS bypassrls (LLD 4.5; pg_dump needs it; 027 pins it); it is still held to the other four attributes here.
select is_empty($$ select rolname from pg_roles where rolname ~ '_role$' and rolname <> 'service_role' and (rolsuper or (rolbypassrls and rolname <> 'backup_role') or rolcreaterole or rolcreatedb or rolreplication) order by 1 $$,
  'the worker, collector and exchange-rate logins cannot bypass row-level security or create roles or databases');
select is_empty($$ select id from storage.buckets where public or file_size_limit is null or allowed_mime_types is null or cardinality(allowed_mime_types) = 0 order by 1 $$,
  'every storage bucket is private, with a size limit and a list of allowed file types');

select * from finish();
rollback;
