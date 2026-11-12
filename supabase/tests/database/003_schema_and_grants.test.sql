-- WO-0041: structure, grants and function hygiene of the consumer schema (LLD 4.4, 4.5, 4.9, section 10).
-- Everything is derived from the catalog, so a new table or function that skips RLS, a grant review or search_path fails here.
begin;
\ir helpers.inc
select count(*) + 64 as n from pg_temp.app_tables \gset
select plan(:n);

-- ---- the tables exist (the consumer tables of R2 and app.jobs of R5b; receipts and analytics_events belong to later releases) ----
select is((select array_agg(tbl order by tbl) from pg_temp.app_tables),
  array['collections','consent_records','document_acceptances','item_collections','item_features','item_tags','items','jobs','outfit_items',
        'outfit_logs','outfit_plans','outfits','profiles','purchase_receipts','purchases','receipts','suggestion_feedback','tags','wishlist_entries'],
  'the app schema holds exactly the R2 tables, app.jobs (R5b) and app.receipts and app.purchase_receipts (R6a)');
select has_table('ops', t, 'ops.' || t || ' exists') from unnest(array['settings','invitations','daily_counts']) t;

-- ---- deny by default: RLS enabled AND forced everywhere, per table -----------------------------------------------------
select ok((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = ('app.' || tbl)::regclass), 'RLS is enabled and forced on app.' || tbl)
  from pg_temp.app_tables order by tbl;
select is_empty($$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'ops', 'catalog') and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'no table in app, ops or catalog lacks enabled and forced RLS');
select is_empty($$ select tbl from pg_temp.app_tables where tbl not in (select tablename from pg_policies where schemaname = 'app') $$,
  'every app table has at least one policy');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname in ('app', 'ops', 'catalog')
  and (roles && array['public', 'anon']::name[]) $$, 'no policy applies to public or anon');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname = 'app' and permissive <> 'PERMISSIVE' $$, 'app policies are all permissive (no hidden restrictive mix)');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[]
  and (coalesce(qual, '') || coalesce(with_check, '') ) !~ 'auth\.uid' $$, 'every app policy except the exact {worker_role} ones is tied to auth.uid() (the worker policies are tested in 009)');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[]
  and tablename not in ('profiles', 'consent_records', 'document_acceptances')
  and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'has_consent' $$, 'every gated app policy calls has_consent');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[]
  and tablename not in ('profiles', 'consent_records', 'document_acceptances')
  and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'current_role' $$, 'every gated app policy checks the consumer role');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname = 'app'
  and tablename in ('profiles', 'consent_records', 'document_acceptances')
  and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'has_consent' $$, 'the profile, consent and acceptance policies have no consent gate');

-- ---- table privileges: anon none, authenticated exactly the matrix below, nobody may truncate, reference or trigger ---------
select is_empty($$ select c.relname from pg_class c where c.relnamespace in ('app'::regnamespace, 'ops'::regnamespace)
  and c.relkind in ('r', 'p') and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')) $$, 'anon has no privilege on any app or ops table');
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')
  and has_table_privilege('authenticated', c.oid, 'truncate,references,trigger') $$, 'authenticated cannot truncate, reference or trigger any app table');
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'ops'::regnamespace and c.relkind in ('r', 'p')
  and (has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references') or has_table_privilege('authenticated', c.oid, 'delete,truncate,trigger')
    or has_any_column_privilege('service_role', c.oid, 'select,insert,update,references') or has_table_privilege('service_role', c.oid, 'delete,truncate,trigger')) $$,
  'no client or service role has a privilege on any ops table');
select ok(not has_schema_privilege('authenticated', 'ops', 'usage') and not has_schema_privilege('anon', 'ops', 'usage'), 'no client role has usage on ops');
select ok(has_schema_privilege('supabase_auth_admin', 'ops', 'usage') and has_table_privilege('supabase_auth_admin', 'ops.invitations', 'select')
  and not has_table_privilege('supabase_auth_admin', 'ops.invitations', 'insert,update,delete')
  and not has_any_column_privilege('supabase_auth_admin', 'ops.settings'::regclass, 'select'), 'the auth hook role reads invitations only');

select is_empty($$ select w.tbl from want w where
  has_any_column_privilege('authenticated', ('app.' || w.tbl)::regclass, 'select') is distinct from w.sel
  or has_any_column_privilege('authenticated', ('app.' || w.tbl)::regclass, 'insert') is distinct from w.ins
  or has_any_column_privilege('authenticated', ('app.' || w.tbl)::regclass, 'update') is distinct from w.upd
  or has_table_privilege('authenticated', ('app.' || w.tbl)::regclass, 'delete') is distinct from w.del $$,
  'authenticated holds exactly the documented privilege on each app table');
select is_empty($$ select tbl from pg_temp.app_tables where tbl not in (select tbl from want) $$, 'the privilege matrix covers every app table');
-- each privilege has a matching policy, and no policy exists without its privilege
select is_empty($$ select w.tbl || ' ' || o.op from want w cross join (values ('select', 'SELECT'), ('insert', 'INSERT'), ('update', 'UPDATE'), ('delete', 'DELETE')) o(op, cmd)
  where (case o.op when 'select' then w.sel when 'insert' then w.ins when 'update' then w.upd else w.del end)
  is distinct from exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = w.tbl and p.cmd = o.cmd and p.roles <> array['worker_role']::name[]) $$,
  'every granted operation has a policy and every policy has its grant');
select is_empty($$ select tbl from pg_temp.app_tables where not has_table_privilege('service_role', ('app.' || tbl)::regclass, 'select,insert,update,delete') $$,
  'service_role holds select, insert, update and delete on every app table');

-- profiles: column grants protect role, age_confirmed, deleting, deletion_requested_at
select ok(not has_table_privilege('authenticated', 'app.profiles', 'insert') and not has_table_privilege('authenticated', 'app.profiles', 'update'), 'no table-level insert or update on profiles');
select ok(not has_column_privilege('authenticated', 'app.profiles', c, 'update'), 'authenticated cannot update profiles.' || c)
  from unnest(array['id','role','age_confirmed','deleting','deletion_requested_at','created_at']) c;
select ok(has_column_privilege('authenticated', 'app.profiles', c, 'update'), 'authenticated can update profiles.' || c)
  from unnest(array['display_name','country','hemisphere','currency','occasions']) c;
select ok(has_column_privilege('authenticated', 'app.consent_records', 'notice_version', 'insert') and has_column_privilege('authenticated', 'app.consent_records', 'user_id', 'insert')
  and not has_column_privilege('authenticated', 'app.consent_records', 'accepted_at', 'insert')
  and not has_column_privilege('authenticated', 'app.consent_records', 'id', 'insert'), 'consent records accept only user_id and notice_version from clients');

-- ---- functions: nothing executable by anon beyond supported_countries; definer functions pin search_path -----------------
create temp table fn as
  select p.oid, n.nspname || '.' || p.proname as name, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args, p.prorettype = 'trigger'::regtype as is_trigger
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'ops', 'catalog', 'analytics', 'analytics_private') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');   -- WO-0100: the analytics schemas are now covered too
select is_empty($$ select name from fn where has_function_privilege('anon', oid, 'execute') and name <> 'app.supported_countries' $$,
  'anon can execute nothing but app.supported_countries');
select ok(has_function_privilege('anon', 'app.supported_countries()', 'execute'), 'anon can execute app.supported_countries');
select is((select array_agg(name order by name) from fn where has_function_privilege('authenticated', oid, 'execute')),
  array['analytics.coverage','analytics.filter_options','analytics.ownership_mix','app.accept_documents','app.complete_onboarding','app.confirm_receipt','app.current_role','app.delete_my_account','app.export_my_data','app.has_consent','app.insert_item_from_json','app.insert_purchase_from_json','app.is_recent_sign_in','app.job_input_ok','app.latest_fx_rates','app.public_setting','app.recent_job_count','app.storage_used','app.supported_countries','app.wishlist_bought',
        'catalog.colour_family','catalog.rgb_hex','catalog.rgb_to_lab','catalog.set_colour_fields','catalog.srgb_lin','catalog.take_down_source'],
  'authenticated can execute exactly the documented functions');
select is((select array_agg(name order by name) from fn where has_function_privilege('service_role', oid, 'execute')), array['app.write_admin_audit','catalog.colour_family','catalog.rgb_hex','catalog.rgb_to_lab','catalog.set_colour_fields','catalog.srgb_lin'],
  'service_role can execute exactly the colour functions its catalogue writes run (WO-0083) and the audit-log writer of WO-0088 (the secret-key routes reach ops only through it)');
select is_empty($$ select name from fn where is_trigger and name like 'app.%' and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute')) $$,
  'no client role can execute an app trigger function');
select ok(not has_function_privilege('authenticated', 'ops.is_eligible(uuid)', 'execute') and not has_function_privilege('anon', 'ops.is_eligible(uuid)', 'execute'), 'ops.is_eligible is not callable by clients');
select ok(has_function_privilege('supabase_auth_admin', 'ops.check_invitation(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'ops.check_invitation(jsonb)', 'execute')
  and not has_function_privilege('anon', 'ops.check_invitation(jsonb)', 'execute'), 'only supabase_auth_admin can execute the invitation hook');
select is_empty($$ select name from fn where prosecdef and not (coalesce(proconfig, '{}') @> array['search_path=""']) $$, 'every security definer function pins search_path to the empty path');
select is_empty($$ select name from fn where name ~ '^(app|ops)\.' and not (coalesce(proconfig, '{}') @> array['search_path=""']) $$, 'every app and ops function pins search_path');
select ok(not (select prosecdef from fn where name = 'ops.check_invitation'), 'the invitation hook is not security definer (LLD 4.9)');

-- ---- WO-0042 F2: nothing may trust a claim the user can edit (user_metadata, raw_user_meta_data) ------------------------------
select is_empty($$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'ops', 'catalog') and p.prosrc ~* 'user_meta_?data' $$, 'no function in app, ops or catalog reads user_metadata or raw_user_meta_data');
select is_empty($$ select tablename || '.' || policyname from pg_policies where schemaname in ('app', 'ops', 'catalog')
  and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'user_meta_?data' $$, 'no policy reads user_metadata');

-- ---- WO-0042 F3: a view runs with its owner's rights and ignores RLS unless it is security_invoker; none may be open to anon ---
select is_empty($$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'ops', 'catalog', 'analytics', 'analytics_private') and c.relkind in ('v', 'm', 'f')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    and (c.relkind <> 'v'
      or not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o where o ~ '^security_invoker=(true|on|1|yes|t)$')
      or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
      or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')) $$,
  'no view, materialized view or foreign table exists unless it is security_invoker with no grant to anon');

-- ---- triggers present --------------------------------------------------------------------------------------------------
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.items'::regclass and tgname = 'items_colour' and not tgisinternal), 1::bigint, 'items has the colour trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.wishlist_entries'::regclass and tgname = 'wishlist_entries_colour' and not tgisinternal), 1::bigint, 'wishlist_entries has the colour trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal), 1::bigint, 'auth.users has the sign-up trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.items'::regclass and tgname = 'items_archive_flag' and not tgisinternal), 1::bigint, 'items has the archive trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.item_features'::regclass and tgname = 'item_features_owner' and not tgisinternal), 1::bigint, 'item_features has the ownership trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.outfit_items'::regclass and tgname = 'outfit_items_active' and not tgisinternal), 1::bigint, 'outfit_items has the active-item trigger');
select is((select count(*) from pg_trigger t where t.tgrelid = 'app.profiles'::regclass and tgname = 'profiles_protect' and not tgisinternal), 1::bigint, 'profiles has the protected-column trigger');
select is((select array_agg(c.relname::text order by c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where t.tgname like '%\_taxonomy' and not t.tgisinternal), array['items','outfits','profiles','wishlist_entries'], 'the taxonomy array check is on every table with seasons or occasions');

-- ---- shape (LLD 4.4) ---------------------------------------------------------------------------------------------------
select col_default_is('app', 'wishlist_entries', 'origin', 'user', 'wishlist_entries.origin defaults to user');
select col_not_null('app', 'wishlist_entries', 'origin', 'wishlist_entries.origin is not null');
select has_column('app', 'suggestion_feedback', 'engine_config', 'suggestion_feedback has engine_config');
select hasnt_column('app', 'suggestion_feedback', 'item_id', 'suggestion_feedback holds no item id');
select col_is_pk('app', 'item_features', 'item_id', 'item_features is keyed by item_id');
select has_column('app', 'items', 'is_never_worn', 'items has the generated never-worn flag');
select ok(exists (select 1 from pg_attribute where attrelid = 'app.items'::regclass and attname = 'is_never_worn' and attgenerated = 's'), 'is_never_worn is a stored generated column');
select is((select string_agg(key || '=' || value, ',' order by key) from ops.settings where key in ('supported_countries', 'maintenance', 'min_group_size')),
  'maintenance=off,min_group_size=10,supported_countries=IN', 'ops.settings is seeded (supported_countries IN, maintenance off, min_group_size 10)');
select is((select count(*) from ops.settings where key in ('current_notice_version','current_terms_version','current_privacy_version','current_vendor_agreement_version',
  'pilot_end_date','pilot_outcome','pilot_end_notice_sent_at')), 7::bigint, 'the other LLD 4.9 settings keys are seeded');

select * from finish();
rollback;
