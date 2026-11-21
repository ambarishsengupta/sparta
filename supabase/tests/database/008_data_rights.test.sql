-- WO-0060 / CC2: data rights. app.export_my_data() (FR-62) and app.delete_my_account() (FR-63, FR-66), plus the cascade audit.
-- Everything per table is derived from the catalog, so a new app table without export coverage, a fixture template (helpers.inc)
-- or a cascade chain to auth.users fails here. Users: A and B are eligible consumers with a row in every table.
begin;
\ir helpers.inc
select count(*) as nt from pg_temp.app_tables \gset
select plan(:nt * 11 + 209);   -- WO-0080: +18 = 7 per-table loops x 2 new tables + 2 per zero-argument function x 2 new functions; WO-0158: +3 = 2 for the new zero-argument function app.admin_end_pilot_preview, 1 for the service_role check

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ub());
select pg_temp.seed_user(pg_temp.ua());
select pg_temp.seed_user(pg_temp.ub());
select pg_temp.mk_user('33333333-3333-3333-3333-333333333333');   -- C: an account with no data at all

-- ---- the cascade audit: every app table reaches auth.users through ON DELETE CASCADE keys only ---------------------------------
create temp table reach as
  with recursive e as (select conrelid, confrelid from pg_constraint where contype = 'f' and confdeltype = 'c'),
  r(start, cur) as (select c.oid, c.oid from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')
                    union select r.start, e.confrelid from r join e on e.conrelid = r.cur)
  select start::regclass::text as tbl, array_agg(cur::regclass::text order by cur::regclass::text) as chain from r group by start;
select is((select count(*) from reach), :nt::bigint, 'the cascade audit covers every app table');
select is_empty($$ select tbl from reach where not ('auth.users' = any (chain)) $$, 'every app table reaches auth.users through cascading foreign keys only');
select is((select chain from reach where tbl = 'app.profiles'), array['app.profiles', 'auth.users'], 'app.profiles cascades straight from auth.users');
select is_empty($$ select tbl from reach where tbl <> 'app.profiles' and not ('app.profiles' = any (chain)) $$, 'every other app table cascades from app.profiles');
select is_empty($$ select t.tbl from pg_temp.app_tables t where t.tbl <> 'profiles' and not exists (
    select 1 from pg_constraint c where c.contype = 'f' and c.confdeltype = 'c' and c.conrelid = ('app.' || t.tbl)::regclass
      and c.confrelid = 'app.profiles'::regclass and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['user_id']) $$,
  'every app table has user_id with an ON DELETE CASCADE key to app.profiles');
select is((select array_agg(conrelid::regclass::text || ':' || confdeltype::text order by conrelid::regclass::text) from pg_constraint
           where contype = 'f' and (confrelid = 'auth.users'::regclass or confrelid::regclass::text like 'app.%') and confdeltype <> 'c'),
  array['auth.scim_users:n'], 'the only non-cascading key into auth.users or app.* is auth.scim_users (SET NULL; SCIM is not used)');
-- WO-0098 (R7a) replaces the table list with a stricter check: it now also names ops.aggregate_runs (run times and counts only) and pins that table's columns, so no column can hold a person.
-- WO-0100 (R7a) replaces it again: it also names ops.vendor_query_log and pins its columns (a vendor and vendor-user id, a function name, parameters, a time: no consumer data).
-- WO-0102 (R7a) extends it: ops.reports too, with its columns pinned (no user column; reviewed_by is an admin id with no foreign key, so the 'only non-cascading key' assertion above is unchanged).
-- WO-0163 (R8b) extends it once more: ops.deletion_log too, its two columns pinned (a user id with no foreign key, and a time: no email or other detail, LLD 13.3).
select is((select array_agg(c.relname::text order by c.relname) from pg_class c where c.relnamespace = 'ops'::regnamespace and c.relkind in ('r', 'p'))::text
  || ' / ' || (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'aggregate_runs')::text
  || ' / ' || (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'vendor_query_log')::text
  || ' / ' || (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'reports')::text
  || ' / ' || (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'deletion_log')::text,
  '{admin_audit_log,aggregate_runs,daily_counts,deletion_log,fx_rates,invitations,rate_limit_windows,reports,settings,vendor_query_log,worker_heartbeat} / {id,started_at,finished_at,status,error_code,users_included,items_included,rows_suppressed,duration_ms} / {id,vendor_id,user_id,fn,params,called_at} / {id,period,generated_at,reviewed_by,reviewed_at,payload} / {user_id,deleted_at}',
  'ops holds exactly the three tables this suite checks for personal data, the worker heartbeat (worker id, times, counts), fx_rates (currency, date, rate), the admin audit log (admin id, action, a row id or a count, WO-0083), aggregate_runs (times, counts and a fixed error code, WO-0098) and vendor_query_log (vendor, vendor user, function, parameters, time, WO-0100) and reports (WO-0102: period, times, the reviewing admin and a payload of rounded published figures, pinned by 019) and rate_limit_windows (WO-0130: a server-made bucket key, a window start and a count, pinned by 023): no participant data');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'daily_counts'),
  array['day', 'metric', 'n'], 'ops.daily_counts has a day, a metric and a number: no column can hold a person');
select is_empty($$ select 1 from pg_constraint where contype = 'f' and conrelid::regclass::text in ('ops.settings', 'ops.invitations', 'ops.daily_counts') $$, 'no ops table points at a user');

-- ---- fixtures: every table has data for A and B ---------------------------------------------------------------------------------
select cmp_ok(pg_temp.n_rows(tbl, pg_temp.ua()), '>', 0::bigint, 'A has a fixture row in app.' || tbl) from pg_temp.app_tables order by tbl;

-- ---- export: the document ---------------------------------------------------------------------------------------------------------
create temp table exp_a as select pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb as doc;
create temp table exp_b as select pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.export_my_data()')::jsonb as doc;
create temp table exp_c as select pg_temp.val_as('33333333-3333-3333-3333-333333333333', 'authenticated', 'select app.export_my_data()')::jsonb as doc;
select is((select jsonb_typeof(doc) from exp_a), 'object', 'export returns one JSON object');
select is((select doc->>'format_version' from exp_a), '1', 'it carries format version 1');
select ok((select (doc->>'generated_at')::timestamptz between now() - interval '1 minute' and now() + interval '1 minute' from exp_a), 'it carries a generated_at that is now');
select is((select doc->'account' from exp_a), jsonb_build_object('id', pg_temp.ua(), 'email', pg_temp.ua()::text || '@example.test',
  'created_at', (select created_at from auth.users where id = pg_temp.ua())), 'the account block is the caller''s id, email and creation time');
select is((select array_agg(k order by k) from exp_a, jsonb_object_keys(doc) k),
  (select array_agg(k order by k) from (select unnest(array['format_version', 'generated_at', 'account']) k union all select tbl from pg_temp.app_tables) s),
  'the keys are the three header keys and exactly one key per app table (derived from the catalog)');
select is_empty($$ select tbl from pg_temp.app_tables where tbl in ('format_version', 'generated_at', 'account') $$, 'no app table is called like a header key');
select is((select count(*) from exp_a, jsonb_each(doc) e where e.key not in ('format_version', 'generated_at', 'account') and jsonb_typeof(e.value) <> 'array'), 0::bigint, 'every table key holds an array');
select is((select count(*) from exp_a a join exp_b b on true where a.doc - 'generated_at' = b.doc - 'generated_at'), 0::bigint, 'A''s and B''s documents differ');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select (app.export_my_data() - ''generated_at'')::text'), (select (doc - 'generated_at')::text from exp_a), 'two exports of unchanged data are identical apart from generated_at (stable order)');

-- every table, every row of the caller, nothing else
select is(jsonb_array_length(a.doc->t.tbl), pg_temp.n_rows(t.tbl, pg_temp.ua())::int, 'export holds all of A''s rows of app.' || t.tbl) from exp_a a, pg_temp.app_tables t order by t.tbl;
select is((select md5(coalesce(string_agg(e::text, ',' order by e::text), '')) from jsonb_array_elements(a.doc->t.tbl) e), pg_temp.digest(t.tbl, pg_temp.ua()),
  'the exported rows of app.' || t.tbl || ' are byte-identical to the table rows') from exp_a a, pg_temp.app_tables t order by t.tbl;
select is((select count(*) from jsonb_array_elements(a.doc->t.tbl) e where e->>pg_temp.owner_col(t.tbl) <> pg_temp.ua()::text), 0::bigint,
  'no row of another user is in the export of app.' || t.tbl) from exp_a a, pg_temp.app_tables t order by t.tbl;
select is((select md5(coalesce(string_agg(e::text, ',' order by e::text), '')) from jsonb_array_elements(b.doc->t.tbl) e), pg_temp.digest(t.tbl, pg_temp.ub()),
  'B''s export of app.' || t.tbl || ' is B''s rows') from exp_b b, pg_temp.app_tables t order by t.tbl;
select is_empty($$ select t.tbl from exp_a a, pg_temp.app_tables t
  where (select array_agg(e::text order by o) from jsonb_array_elements(a.doc->t.tbl) with ordinality x(e, o))
        is distinct from (select array_agg(e::text order by e::text) from jsonb_array_elements(a.doc->t.tbl) x(e)) $$, 'every exported list is sorted by its row text (stable order)');
select is(position(pg_temp.ub()::text in a.doc::text) + position(pg_temp.ua()::text in b.doc::text), 0, 'neither document mentions the other user''s id anywhere') from exp_a a, exp_b b;
select is((select count(*) from exp_c c, jsonb_each(c.doc) e where e.key <> 'profiles' and (case when jsonb_typeof(e.value) = 'array' then jsonb_array_length(e.value) else 0 end) > 0), 0::bigint, 'an account with no data exports empty lists');
select is((select jsonb_array_length(doc->'profiles') from exp_c), 1, 'and its profile');

-- export works for a participant who fails the consent gate (the reason it is security definer)
create temp table gate_cases (label text primary key, set_sql text, undo_sql text);
insert into gate_cases values
  ('a new notice version', $$ update ops.settings set value = '2' where key = 'current_notice_version' $$, $$ update ops.settings set value = '1' where key = 'current_notice_version' $$),
  ('maintenance mode', $$ update ops.settings set value = 'on' where key = 'maintenance' $$, $$ update ops.settings set value = 'off' where key = 'maintenance' $$),
  ('an unsupported country', $$ update app.profiles set country = 'US' where id = pg_temp.ua() $$, $$ update app.profiles set country = 'IN' where id = pg_temp.ua() $$),
  ('a deletion in progress', $$ update app.profiles set deleting = true where id = pg_temp.ua() $$, $$ update app.profiles set deleting = false where id = pg_temp.ua() $$);
create function pg_temp.gate_case(p_label text, p_set boolean) returns void language plpgsql as $f$
begin execute (select case when p_set then set_sql else undo_sql end from gate_cases where label = p_label); end $f$;
select pg_temp.gate_case(label, true) from gate_cases where label = 'a new notice version';
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'false', 'with a new notice version A fails the consent gate');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from app.items'), 'rows=0', 'and RLS hides A''s items from A');
select is(jsonb_array_length((pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb)->'items'), pg_temp.n_rows('items', pg_temp.ua())::int, 'yet the export still holds every item');
select pg_temp.gate_case(label, false) from gate_cases where label = 'a new notice version';
select pg_temp.gate_case(label, true) from gate_cases where label = 'maintenance mode';
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'false', 'in maintenance mode A fails the consent gate');
select is(jsonb_array_length((pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb)->'outfits'), pg_temp.n_rows('outfits', pg_temp.ua())::int, 'yet the export still holds every outfit');
select pg_temp.gate_case(label, false) from gate_cases where label = 'maintenance mode';
select pg_temp.gate_case(label, true) from gate_cases where label = 'an unsupported country';
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'false', 'with an unsupported country A fails the consent gate');
select is(jsonb_array_length((pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb)->'purchases'), pg_temp.n_rows('purchases', pg_temp.ua())::int, 'yet the export still holds every purchase');
select pg_temp.gate_case(label, false) from gate_cases where label = 'an unsupported country';
select pg_temp.gate_case(label, true) from gate_cases where label = 'a deletion in progress';
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'false', 'while deleting is set A fails the consent gate (WO-0060: not deleting)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from app.items'), 'rows=0', 'and RLS hides A''s items from A');
select is(jsonb_array_length((pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()')::jsonb)->'wishlist_entries'), pg_temp.n_rows('wishlist_entries', pg_temp.ua())::int, 'yet the export still holds every wishlist entry');
select pg_temp.gate_case(label, false) from gate_cases where label = 'a deletion in progress';
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'true', 'with every case undone A passes the gate again (the `not deleting` change keeps eligible users eligible)');

-- export refuses the wrong callers
select is(pg_temp.run_as(null, 'anon', 'select app.export_my_data()'), 'err=42501', 'anon cannot export');
select is(pg_temp.val_as(null, 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'a signed-in role with no user ID cannot export');
select is(pg_temp.val_as('99999999-9999-9999-9999-999999999999', 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'a token for a user with no profile cannot export');
update app.profiles set role = 'vendor' where id = pg_temp.ub();
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'a vendor cannot use the consumer export');
update app.profiles set role = 'admin' where id = pg_temp.ub();
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'an admin cannot use the consumer export');
update app.profiles set role = 'consumer' where id = pg_temp.ub();
select alike(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.export_my_data(%L)', pg_temp.ub())), 'err=42883: function app.export_my_data(%) does not exist', 'export takes no user ID: it cannot be pointed at another user');

-- WO-0062 item 5: a claim the person can edit never picks the user. The caller is A; the token's metadata (and extra top-level claims) all name B.
create temp table spoof as select jsonb_build_object(
  'user_metadata', jsonb_build_object('sub', pg_temp.ub(), 'id', pg_temp.ub(), 'user_id', pg_temp.ub(), 'uid', pg_temp.ub(), 'email', pg_temp.ub()::text || '@example.test'),
  'app_metadata', jsonb_build_object('sub', pg_temp.ub(), 'id', pg_temp.ub(), 'user_id', pg_temp.ub(), 'role', 'consumer'),
  'user_id', pg_temp.ub(), 'uid', pg_temp.ub(), 'email', pg_temp.ub()::text || '@example.test') as extra;
create temp table exp_spoof as select pg_temp.val_claims(pg_temp.ua(), 'authenticated', (select extra from spoof), 'select app.export_my_data()')::jsonb as doc;
select is((select doc - 'generated_at' from exp_spoof), (select doc - 'generated_at' from exp_a), 'export with claims that name B in metadata returns exactly A''s document');
select is((select doc->'account'->>'id' from exp_spoof), pg_temp.ua()::text, 'the account block is A''s, not the one the metadata names');
select is(position(pg_temp.ub()::text in (select doc::text from exp_spoof)) + position(pg_temp.ub()::text || '@example.test' in (select doc::text from exp_spoof)), 0, 'and nothing of B''s is in it');
select is((select count(*) from exp_spoof s, jsonb_each(s.doc) e, jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) r
           where e.key <> 'profiles' and r->>'user_id' = pg_temp.ub()::text), 0::bigint, 'no exported row has B as its owner');

-- every function with no arguments (callable by a signed-in person with nothing to name a user) gives the same answer for A with and without
-- claims that name B. This runs the code, so a user id assembled from pieces of text ('user_' || 'metadata') is caught as well as a plain read.
-- delete_my_account is the one exception here (it has its own tests below: D, who deletes with claims naming B).
create temp table fn0 as select p.oid::regprocedure::text as sig, n.nspname::text as sch, p.proname::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'ops', 'catalog') and p.pronargs = 0 and p.prorettype <> 'trigger'::regtype and p.proname <> 'delete_my_account';
select is((select array_agg(sch || '.' || name order by sch, name) from fn0), array['app.admin_end_pilot_preview', 'app.claim_job', 'app.current_role', 'app.export_my_data', 'app.has_consent', 'app.is_recent_sign_in', 'app.latest_fx_rates', 'app.purge_receipt_jobs', 'app.reap_stuck_jobs', 'app.recent_job_count', 'app.storage_used', 'app.supported_countries'],
  'the functions without arguments are the twelve known ones (a new one must be added to this check on purpose; WO-0158 added app.admin_end_pilot_preview, read-only counts for the admin end-of-pilot route)');
select is_empty($$ select sig from fn0 where has_function_privilege('service_role', sig::regprocedure, 'execute') and sig <> 'app.admin_end_pilot_preview()' $$, 'the secret-key role can execute none of the argument-free functions except the WO-0158 preview (its other functions, the WO-0088 audit writer among them, take an explicit admin id and check it)');
select is((select array_agg(sig order by sig) from fn0 where has_function_privilege('service_role', sig::regprocedure, 'execute')), array['app.admin_end_pilot_preview()'], 'and the one argument-free function it can execute is the WO-0158 preview, which takes no user id and returns only counts');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select (' || sig || ')::text'), pg_temp.val_claims(pg_temp.ua(), 'authenticated', (select extra from spoof), 'select (' || sig || ')::text'),
  sig || ' answers the same for A with and without claims that name B') from fn0 order by sig;
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.current_role()'), 'consumer', 'and the check is not vacuous: A is a consumer');
-- the same with a caller whose answers differ from B's (a vendor who is not eligible): a function that read B from the claims would answer as B
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000a3');
update app.profiles set role = 'vendor' where id = '99999999-0000-0000-0000-0000000000a3';
select is(pg_temp.val_as('99999999-0000-0000-0000-0000000000a3', 'authenticated', 'select (' || sig || ')::text'), pg_temp.val_claims('99999999-0000-0000-0000-0000000000a3', 'authenticated', (select extra from spoof), 'select (' || sig || ')::text'),
  sig || ' answers the same for the vendor W with and without claims that name B') from fn0 order by sig;
select isnt(pg_temp.val_as('99999999-0000-0000-0000-0000000000a3', 'authenticated', 'select app.has_consent()'), pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.has_consent()'), 'and the check is not vacuous: W and B get different answers from has_consent');
select isnt(pg_temp.val_as('99999999-0000-0000-0000-0000000000a3', 'authenticated', 'select app.current_role()'), pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.current_role()'), 'and from current_role');
delete from auth.users where id = '99999999-0000-0000-0000-0000000000a3';
-- the two functions that write for the caller
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000a1');
create temp table sp_b as select md5(string_agg(to_jsonb(p)::text, ',')) as d, (select count(*) from app.document_acceptances where user_id = pg_temp.ub()) as n from app.profiles p where p.id = pg_temp.ub();
select is(pg_temp.val_claims('99999999-0000-0000-0000-0000000000a1', 'authenticated', (select extra from spoof), 'select app.complete_onboarding(''IN'', ''north'', ''INR'', ''{}'')'), 'ok', 'a caller with claims naming B completes onboarding for the caller');
select is(pg_temp.val_claims('99999999-0000-0000-0000-0000000000a1', 'authenticated', (select extra from spoof), 'select app.accept_documents(''1'', ''1'', true)'), '', 'and accepts the documents for the caller');
select is((select count(*) from app.document_acceptances where user_id = '99999999-0000-0000-0000-0000000000a1'), 2::bigint, 'the caller has the two acceptances');
select is((select md5(string_agg(to_jsonb(p)::text, ',')) from app.profiles p where p.id = pg_temp.ub()), (select d from sp_b), 'B''s profile did not change');
select is((select count(*) from app.document_acceptances where user_id = pg_temp.ub()), (select n from sp_b), 'and B''s acceptances did not change');
delete from auth.users where id = '99999999-0000-0000-0000-0000000000a1';

-- item 8: an account whose profile row is gone cannot be shown to be a consumer; neither function acts for it
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000a2');
delete from app.profiles where id = '99999999-0000-0000-0000-0000000000a2';
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000a2', 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'an account with no profile row cannot export');
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000a2', 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'an account with no profile row cannot use the deletion either (fail closed)');
select is((select count(*) from auth.users where id = '99999999-0000-0000-0000-0000000000a2'), 1::bigint, 'and nothing was deleted');
delete from auth.users where id = '99999999-0000-0000-0000-0000000000a2';

-- ---- function properties: definer, empty search_path, owner, grants ------------------------------------------------------------
create temp table dr_fn as select p.oid, p.proname::text as name from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('export_my_data', 'delete_my_account');
select is((select count(*) from dr_fn), 2::bigint, 'both functions exist');
select is_empty($$ select name from dr_fn f join pg_proc p using (oid) where not p.prosecdef $$, 'both are security definer (a user who fails the consent gate must still export and delete)');
select is_empty($$ select name from dr_fn f join pg_proc p using (oid) where not (coalesce(p.proconfig, '{}') @> array['search_path=""']) $$, 'both pin an empty search_path');
select is_empty($$ select name from dr_fn f join pg_proc p using (oid) where pg_get_userbyid(p.proowner) <> 'postgres' $$, 'both are owned by postgres');
select is_empty($$ select name from dr_fn f where not has_function_privilege('authenticated', f.oid, 'execute') $$, 'authenticated can execute both');
select is_empty($$ select name from dr_fn f where has_function_privilege('anon', f.oid, 'execute') $$, 'anon can execute neither');
select is_empty($$ select name from dr_fn f join pg_proc p using (oid), aclexplode(p.proacl) a where a.grantee <> p.proowner and a.grantee <> 'authenticated'::regrole $$, 'no other role, and not PUBLIC, holds execute on either');
select is_empty($$ select name from dr_fn f join pg_proc p using (oid) where p.proacl is null $$, 'neither keeps the default PUBLIC execute (acl is explicit)');
select is_empty($$ select name from dr_fn f where has_function_privilege('service_role', f.oid, 'execute') $$, 'the secret-key role has no direct execute either (it uses its own routes)');
select is((select pronargs::int from pg_proc where oid in (select oid from dr_fn where name = 'delete_my_account')), 0, 'delete_my_account takes no arguments: only auth.uid() can be deleted');
select is((select prorettype::regtype::text from pg_proc where proname = 'export_my_data' and pronamespace = 'app'::regnamespace), 'jsonb', 'export returns jsonb');

-- ---- delete: set-up -------------------------------------------------------------------------------------------------------------
-- sessions, refresh tokens and an identity for A and B (Auth rows hang off auth.users)
insert into auth.sessions (id, user_id) values ('a0000000-0000-0000-0000-00000000000a', pg_temp.ua()), ('b0000000-0000-0000-0000-00000000000b', pg_temp.ub());
insert into auth.refresh_tokens (token, user_id, session_id) values ('tok-a', pg_temp.ua()::text, 'a0000000-0000-0000-0000-00000000000a'), ('tok-b', pg_temp.ub()::text, 'b0000000-0000-0000-0000-00000000000b');
insert into auth.identities (provider_id, user_id, identity_data, provider) values (pg_temp.ua()::text, pg_temp.ua(), '{}', 'email'), (pg_temp.ub()::text, pg_temp.ub(), '{}', 'email');
insert into ops.invitations (email) values (pg_temp.ua()::text || '@example.test'), (pg_temp.ub()::text || '@example.test');
create temp table b_before as select t.tbl, pg_temp.digest(t.tbl, pg_temp.ub()) as d, pg_temp.n_rows(t.tbl, pg_temp.ub()) as n from pg_temp.app_tables t;
create temp table dc_before as select coalesce(sum(n), 0) as n from ops.daily_counts where metric = 'deletions' and day = current_date;
create temp table su_before as select coalesce(sum(n), 0) as n from ops.daily_counts where metric = 'signups' and day = current_date;

-- the wrong callers first: nothing is deleted
select is(pg_temp.run_as(null, 'anon', 'select app.delete_my_account()'), 'err=42501', 'anon cannot delete');
select is(pg_temp.val_fresh(null, 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'a signed-in role with no user ID deletes nothing');
select alike(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.delete_my_account(%L)', pg_temp.ub())), 'err=42883: function app.delete_my_account(%) does not exist', 'there is no way to name another user');
update app.profiles set role = 'vendor' where id = pg_temp.ub();
select is(pg_temp.val_fresh(pg_temp.ub(), 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'a vendor cannot use the consumer deletion');
update app.profiles set role = 'admin' where id = pg_temp.ub();
select is(pg_temp.val_fresh(pg_temp.ub(), 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'an admin cannot use the consumer deletion');
update app.profiles set role = 'consumer' where id = pg_temp.ub();
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'the refused callers deleted nothing');
select is((select count(*) from auth.users), 3::bigint, 'still exactly three users (A, B, C)');
select is(pg_temp.val_fresh('99999999-9999-9999-9999-999999999999', 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'a token whose user does not exist deletes nothing and says so');

-- ---- delete: A leaves -----------------------------------------------------------------------------------------------------------
select is(pg_temp.val_fresh(pg_temp.ua(), 'authenticated', 'select app.delete_my_account()'), 'deleted', 'A deletes the account');
select is((select count(*) from auth.users where id = pg_temp.ua()), 0::bigint, 'A''s auth user is gone');
select is(pg_temp.n_rows(tbl, pg_temp.ua()), 0::bigint, 'no row of A remains in app.' || tbl) from pg_temp.app_tables order by tbl;
select is_empty($$ select t.tbl from pg_temp.app_tables t join b_before b using (tbl) where pg_temp.digest(t.tbl, pg_temp.ub()) <> b.d or pg_temp.n_rows(t.tbl, pg_temp.ub()) <> b.n $$, 'B''s rows are unchanged in every table');
select cmp_ok((select min(n) from b_before), '>', 0::bigint, 'and B really had rows in every table');
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'B''s auth user remains');
select is((select count(*) from auth.users where id = pg_temp.ua()), 0::bigint, 'and A''s does not (A and B checked one against the other)');
select is((select count(*) from app.profiles where id = pg_temp.ua()), 0::bigint, 'A''s profile is gone');
select is((select count(*) from app.profiles where id = pg_temp.ub()), 1::bigint, 'B''s profile remains');
select is((select count(*) from auth.sessions where user_id = pg_temp.ua()) + (select count(*) from auth.refresh_tokens where user_id = pg_temp.ua()::text)
        + (select count(*) from auth.identities where user_id = pg_temp.ua()), 0::bigint, 'A''s sessions, refresh tokens and identities are gone (the session ends)');
select is((select count(*) from auth.sessions where user_id = pg_temp.ub()) + (select count(*) from auth.refresh_tokens where user_id = pg_temp.ub()::text)
        + (select count(*) from auth.identities where user_id = pg_temp.ub()), 3::bigint, 'B''s session, token and identity remain');
select is((select count(*) from ops.invitations where email = pg_temp.ua()::text || '@example.test'), 0::bigint, 'A''s invitation entry is gone (FR-63)');
select is((select count(*) from ops.invitations where email = pg_temp.ub()::text || '@example.test'), 1::bigint, 'B''s invitation entry remains');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 1::bigint, 'today''s deletions count went up by exactly 1');
select is((select sum(n) from ops.daily_counts where metric = 'signups' and day = current_date) - (select n from su_before), 0::bigint, 'and the sign-ups count did not move');
select is(position(pg_temp.ua()::text in (select string_agg(to_jsonb(t)::text, ' ') from ops.daily_counts t) || (select string_agg(to_jsonb(t)::text, ' ') from ops.settings t)
  || coalesce((select string_agg(to_jsonb(t)::text, ' ') from ops.invitations t), '')), 0, 'no ops table holds A''s user id');
select is(position('example.test' in (select string_agg(to_jsonb(t)::text, ' ') from ops.daily_counts t)), 0, 'ops.daily_counts holds no email');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.export_my_data()'), 'err=42501: forbidden', 'the deleted user''s old token can no longer export');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select 1 from app.profiles where id = ' || quote_literal(pg_temp.ua())), null, 'nor read a profile');

-- idempotent: the same token again
select is(pg_temp.val_fresh(pg_temp.ua(), 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'a second call is harmless and says already_deleted');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 1::bigint, 'and is not counted twice');
select is_empty($$ select t.tbl from pg_temp.app_tables t join b_before b using (tbl) where pg_temp.digest(t.tbl, pg_temp.ub()) <> b.d $$, 'B is still untouched');

-- ---- delete works for every kind of participant, however the consent gate stands -------------------------------------------------
-- D: the token carries claims that name B; only the real subject goes
select pg_temp.mk_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
select is(pg_temp.val_claims('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', jsonb_build_object('user_metadata', jsonb_build_object('sub', pg_temp.ub(), 'id', pg_temp.ub()), 'app_metadata', jsonb_build_object('sub', pg_temp.ub()), 'amr', jsonb_build_array(pg_temp.amr_entry('password', 0))),
  'select app.delete_my_account()'), 'deleted', 'D deletes with claims that name B in the metadata');
select is((select count(*) from auth.users where id in ('dddddddd-dddd-dddd-dddd-dddddddddddd', pg_temp.ub())), 1::bigint, 'only D went; B remains');
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'B exists after D''s deletion');
select is((select count(*) from auth.users where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 0::bigint, 'and D does not');
-- E: deletion already flagged by a server route that failed (the flag must not block a retry)
select pg_temp.mk_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select pg_temp.make_eligible('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
update app.profiles set deleting = true, deletion_requested_at = now() where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select is(ops.is_eligible('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), false, 'E, with deleting set, is not an eligible participant');
select is(pg_temp.val_fresh('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'E can still complete the deletion (re-entry)');
select is((select count(*) from app.profiles where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 0::bigint, 'E is gone');
-- F: never accepted anything (the not-available user of FR-4 and FR-9)
select pg_temp.mk_user('ffffffff-ffff-ffff-ffff-ffffffffffff');
update app.profiles set country = 'US', hemisphere = 'north' where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select app.has_consent()'), 'false', 'F fails the consent gate');
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select jsonb_array_length(app.export_my_data()->''profiles'')'), '1', 'F can export');
select is(pg_temp.val_fresh('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'F can delete');
-- G: eligible with data, then locked out by a new notice version: every row still goes
select pg_temp.mk_user('99999999-0000-0000-0000-000000000001');
select pg_temp.make_eligible('99999999-0000-0000-0000-000000000001');
select pg_temp.seed_user('99999999-0000-0000-0000-000000000001');
update ops.settings set value = '2' where key = 'current_notice_version';
select is(pg_temp.run_as('99999999-0000-0000-0000-000000000001', 'authenticated', 'select 1 from app.items'), 'rows=0', 'G sees no items (consent gate closed)');
select is(pg_temp.val_fresh('99999999-0000-0000-0000-000000000001', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'G deletes anyway');
select is(pg_temp.n_rows(tbl, '99999999-0000-0000-0000-000000000001'), 0::bigint, 'no row of G remains in app.' || tbl) from pg_temp.app_tables order by tbl;
update ops.settings set value = '1' where key = 'current_notice_version';
-- H: an e-mail address with capitals still loses its (lower-case) invitation entry
insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000002', 'Mixed.Case@Example.test');
insert into ops.invitations (email) values ('mixed.case@example.test');
select is(pg_temp.val_fresh('99999999-0000-0000-0000-000000000002', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'H, whose address has capitals, deletes');
select is((select count(*) from ops.invitations where email = 'mixed.case@example.test'), 0::bigint, 'and the invitation entry goes (matched in lower case)');
-- W: a user with a session in the middle of use: the delete takes the session
insert into auth.sessions (id, user_id) values ('c0000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333');
select is(pg_temp.val_fresh('33333333-3333-3333-3333-333333333333', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'C, an account with no data, deletes');
select is((select count(*) from auth.sessions where user_id = '33333333-3333-3333-3333-333333333333'), 0::bigint, 'and its session ended');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 7::bigint, 'seven real deletions (A, D, E, F, G, H, C) were counted, no more');

-- ---- WO-0062 item 5: the other way round. Y deletes first and X, the other user, is untouched; then X deletes -----------------------------------------
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000b1');
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000b2');
select pg_temp.make_eligible('99999999-0000-0000-0000-0000000000b1');
select pg_temp.make_eligible('99999999-0000-0000-0000-0000000000b2');
select pg_temp.seed_user('99999999-0000-0000-0000-0000000000b1');
select pg_temp.seed_user('99999999-0000-0000-0000-0000000000b2');
create temp table x_before as select t.tbl, pg_temp.digest(t.tbl, '99999999-0000-0000-0000-0000000000b1') as d from pg_temp.app_tables t;
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000b2', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'Y deletes the account');
select is((select count(*) from auth.users where id = '99999999-0000-0000-0000-0000000000b2'), 0::bigint, 'Y is gone');
select is((select count(*) from auth.users where id = '99999999-0000-0000-0000-0000000000b1'), 1::bigint, 'X exists');
select is_empty($$ select tbl from x_before where pg_temp.digest(tbl, '99999999-0000-0000-0000-0000000000b1') <> d $$, 'X''s rows are unchanged in every table');
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000b1', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'X deletes the account');
select is((select count(*) from auth.users where id in ('99999999-0000-0000-0000-0000000000b1', '99999999-0000-0000-0000-0000000000b2')), 0::bigint, 'both are gone');

-- ---- WO-0062 item 1 (F1): the database wants a recent sign-in proof in the token ------------------------------------------------------------------
-- Refused: each leaves the throw-away user in place ('err=42501: reauthentication_required/true').
create temp table reauth_no (label text primary key, extra jsonb);
insert into reauth_no values
  ('no amr claim at all', '{}'),
  ('an empty amr list', '{"amr": []}'),
  ('amr null', '{"amr": null}'),
  ('amr is a string', '{"amr": "password"}'),
  ('amr is a number', '{"amr": 5}'),
  ('amr is an object (not a list)', jsonb_build_object('amr', pg_temp.amr_entry('password', 0))),
  ('amr holds a string', '{"amr": ["password"]}'),
  ('amr holds null', '{"amr": [null]}'),
  ('amr holds a list', jsonb_build_object('amr', jsonb_build_array(jsonb_build_array(pg_temp.amr_entry('password', 0))))),
  ('an entry with no timestamp', '{"amr": [{"method": "password"}]}'),
  ('an entry with no method', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('timestamp', floor(extract(epoch from now())))))),
  ('a method that is a list', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', jsonb_build_array('password'), 'timestamp', floor(extract(epoch from now())))))),
  ('a method that is a number', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 1, 'timestamp', floor(extract(epoch from now())))))),
  ('a timestamp as text', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch from now()))::text)))),
  ('a timestamp that is not a number', '{"amr": [{"method": "password", "timestamp": "yesterday"}]}'),
  ('a timestamp that is null', '{"amr": [{"method": "password", "timestamp": null}]}'),
  ('a timestamp that is true', '{"amr": [{"method": "password", "timestamp": true}]}'),
  ('a timestamp that is a list', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', jsonb_build_array(floor(extract(epoch from now()))))))),
  ('an enormous timestamp', '{"amr": [{"method": "password", "timestamp": 1e300}]}'),
  ('timestamp zero', '{"amr": [{"method": "password", "timestamp": 0}]}'),
  ('a negative timestamp', '{"amr": [{"method": "password", "timestamp": -5}]}'),
  ('a password sign-in 301 seconds ago', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 301)))),
  ('a password sign-in an hour ago', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 3600)))),
  ('a sign-in a day ago', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 86400)))),
  ('a timestamp an hour in the future', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', -3600)))),
  ('a timestamp two minutes in the future', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', -120)))),
  ('a fresh entry with a method that is not a primary sign-in (totp)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('totp', 0)))),
  ('a fresh entry with the method mfa/totp', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('mfa/totp', 0)))),
  ('a fresh entry with the method email/signup (the sign-up confirmation link)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('email/signup', 0)))),
  ('a fresh entry with the method token_refresh', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('token_refresh', 0)))),
  ('a fresh entry with the method anonymous', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('anonymous', 0)))),
  ('a fresh entry with the method recovery', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('recovery', 0)))),
  ('a fresh entry with an empty method', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('', 0)))),
  ('the method in capitals (PASSWORD)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('PASSWORD', 0)))),
  ('an old password entry next to a fresh totp entry', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000), pg_temp.amr_entry('totp', 0)))),
  ('a fresh amr only inside user_metadata', jsonb_build_object('user_metadata', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0))))),
  ('a fresh amr only inside app_metadata', jsonb_build_object('app_metadata', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0))))),
  ('a fresh amr only under another top-level name', jsonb_build_object('amr_list', jsonb_build_array(pg_temp.amr_entry('password', 0)), 'method', 'password', 'timestamp', floor(extract(epoch from now())))),
  ('a stale top-level amr and a fresh one in user_metadata', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000)), 'user_metadata', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0)))));
select is(pg_temp.try_del(extra), 'err=42501: reauthentication_required/true', 'refused, nothing deleted: ' || label) from reauth_no order by label;
-- WO-0071: app.is_recent_sign_in() (used by the storage purge route) says the same for every token the deletion refuses and for every token it accepts
select is(pg_temp.val_claims(pg_temp.ua(), 'authenticated', extra, 'select app.is_recent_sign_in()'), 'false', 'is_recent_sign_in agrees, refused: ' || label) from reauth_no order by label;
-- Accepted: each of these deletes the throw-away user.
create temp table reauth_yes (label text primary key, extra jsonb);
insert into reauth_yes values
  ('a password sign-in now', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0)))),
  ('a password sign-in 290 seconds ago (inside the 300 second window)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 290)))),
  ('an otp sign-in now', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('otp', 0)))),
  ('an oauth sign-in now', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('oauth', 0)))),
  ('a magiclink sign-in now', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('magiclink', 0)))),
  ('an sso/saml sign-in now', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('sso/saml', 0)))),
  ('a clock 30 seconds ahead (small skew is allowed)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', -30)))),
  ('an old password entry and a fresh otp entry (any entry will do)', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000), pg_temp.amr_entry('otp', 0)))),
  ('a fresh entry after a malformed one', jsonb_build_object('amr', jsonb_build_array('junk'::text, null::text, jsonb_build_object('method', 'password', 'timestamp', 'x'), pg_temp.amr_entry('password', 0)))),
  ('a fresh entry, and extra claims that name someone else', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0)), 'user_metadata', jsonb_build_object('amr', '[]'::jsonb)));
select is(pg_temp.try_del(extra), 'deleted/false', 'accepted: ' || label) from reauth_yes order by label;
select is(pg_temp.val_claims(pg_temp.ua(), 'authenticated', extra, 'select app.is_recent_sign_in()'), 'true', 'is_recent_sign_in agrees, accepted: ' || label) from reauth_yes order by label;
-- the window is a setting; a bad value means 300
update ops.settings set value = '10' where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 60)))), 'err=42501: reauthentication_required/true', 'with the window at 10 seconds a sign-in 60 seconds ago is refused');
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 5)))), 'deleted/false', 'and one 5 seconds ago is accepted');
update ops.settings set value = '1' where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 5)))), 'err=42501: reauthentication_required/true', 'with the window at 1 second a sign-in 5 seconds ago is refused (the real-stack test uses this)');
update ops.settings set value = '900' where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 600)))), 'deleted/false', 'with the window at 900 seconds a sign-in 600 seconds ago is accepted (the window really is the setting)');
update ops.settings set value = 'soon' where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 600)))), 'err=42501: reauthentication_required/true', 'a setting that is not a number means 300: 600 seconds ago is refused');
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 200)))), 'deleted/false', 'and 200 seconds ago is accepted');
update ops.settings set value = '-5' where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 600)))), 'err=42501: reauthentication_required/true', 'a negative setting means 300 as well');
-- WO-0071: the same window settings and ages as the deletion assertions above (no deletion here, so the counts below are unchanged)
create function pg_temp.fresh_with(p_window text, p_age numeric) returns text language plpgsql as $f$
begin
  update ops.settings set value = p_window where key = 'reauth_window_seconds';
  return pg_temp.val_claims(pg_temp.ua(), 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', p_age))), 'select app.is_recent_sign_in()');
end $f$;
select is(pg_temp.fresh_with(w, a), e, 'is_recent_sign_in with the window at ' || w || ' and a sign-in ' || a || ' seconds ago is ' || e)
from (values ('10', 60, 'false'), ('10', 5, 'true'), ('1', 5, 'false'), ('900', 600, 'true'), ('soon', 600, 'false'), ('soon', 200, 'true'), ('-5', 600, 'false'), ('300', 301, 'false'), ('300', 299, 'true')) v(w, a, e);
delete from ops.settings where key = 'reauth_window_seconds';
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 600)))), 'err=42501: reauthentication_required/true', 'without the setting the window is 300: 600 seconds ago is refused');
select is(pg_temp.try_del(jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 200)))), 'deleted/false', 'and 200 seconds ago is accepted');
select is(pg_temp.fresh_with('300', 600), 'false', 'without the setting is_recent_sign_in also means 300 (600 seconds ago refused)');
select is(pg_temp.val_claims(pg_temp.ua(), 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 200))), 'select app.is_recent_sign_in()'), 'true', 'and 200 seconds ago is accepted');
insert into ops.settings (key, value) values ('reauth_window_seconds', '300');
select is((select value from ops.settings where key = 'reauth_window_seconds'), '300', 'the window setting is back at 300');
select ok(exists (select 1 from ops.settings where key = 'reauth_window_seconds'), 'and the migration seeds it');
-- what else the guard does not change
select is(pg_temp.val_claims(pg_temp.ub(), 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000))), 'select app.export_my_data() is not null'), 'true', 'export does not ask for a recent sign-in (it only reads)');
select is(pg_temp.val_claims(null, 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0))), 'select app.delete_my_account()'), 'err=42501: forbidden', 'a fresh sign-in with no user id is still forbidden');
select is(pg_temp.run_as(null, 'anon', 'select app.delete_my_account()'), 'err=42501', 'anon is still refused before the claim matters');
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'after all this B still exists');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 23::bigint, 'only real deletions were counted: 7 above, X and Y, ten accepted throw-away users and four more under other window settings (the refusals count nothing)');

-- ---- WO-0062 item 2 (F2): the Auth audit log keeps the id and the address; the deletion removes them -----------------------------------------------
insert into auth.users (id, email) values ('99999999-0000-0000-0000-0000000000c1', 'Gina.Q@Example.test'), ('99999999-0000-0000-0000-0000000000c2', 'other.person@example.test');
create temp table audit_case (label text primary key, who text, payload json);
insert into audit_case values
  ('login: actor id and actor username', 'c1', '{"action":"login","actor_id":"99999999-0000-0000-0000-0000000000c1","actor_username":"gina.q@example.test","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}'),
  ('sign-up by the service role: user_email and user_id in traits', 'c1', '{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","log_type":"team","traits":{"provider":"email","user_email":"gina.q@example.test","user_id":"99999999-0000-0000-0000-0000000000c1","user_phone":""}}'),
  ('the id deep inside the payload and nowhere else', 'c1', '{"action":"x","traits":{"deep":{"deeper":["99999999-0000-0000-0000-0000000000C1"]}}}'),
  ('the address only, in capitals, inside a sentence', 'c1', '{"action":"x","msg":"message sent to GINA.Q@EXAMPLE.TEST today"}'),
  ('the address only, as a field value', 'c1', '{"action":"user_recovery_requested","actor_username":"Gina.Q@Example.test"}'),
  ('another person: their id and address', 'c2', '{"action":"login","actor_id":"99999999-0000-0000-0000-0000000000c2","actor_username":"other.person@example.test","log_type":"account"}'),
  ('another person: the id alone', 'c2', '{"action":"token_refreshed","actor_id":"99999999-0000-0000-0000-0000000000c2"}'),
  ('nobody: a log-out', 'none', '{"action":"logout","actor_via_sso":false,"log_type":"account"}');
insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), payload, now(), '203.0.113.7' from audit_case;
create function pg_temp.audit_hits(p_text text) returns bigint language sql as $f$ select count(*) from auth.audit_log_entries where position(lower(p_text) in lower(payload::text)) > 0 $f$;
select is((select count(*) from auth.audit_log_entries where position('99999999-0000-0000-0000-0000000000c1' in lower(payload::text)) > 0 or position('gina.q@example.test' in lower(payload::text)) > 0), 5::bigint,
  'before: five audit entries name Gina by id or address');
create temp table audit_before as select count(*) as n_all, count(*) filter (where payload::text ilike '%0000000000c2%') as n_other, count(*) filter (where payload::text like '%logout%') as n_none from auth.audit_log_entries;
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000c1', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'Gina leaves');
select is(pg_temp.audit_hits('99999999-0000-0000-0000-0000000000c1'), 0::bigint, 'no audit entry contains her user id (payload::text)');
select is(pg_temp.audit_hits('gina.q@example.test'), 0::bigint, 'no audit entry contains her address, in any case (payload::text)');
select is((select n_all from audit_before) - (select count(*) from auth.audit_log_entries), 5::bigint, 'exactly the five entries about her went');
select is((select count(*) from auth.audit_log_entries where payload::text ilike '%0000000000c2%'), (select n_other from audit_before), 'the other person''s audit entries are all still there');
select is((select count(*) from auth.audit_log_entries where payload::text like '%logout%'), (select n_none from audit_before), 'and so is an entry that names nobody');
-- a retry with the same token (account already gone) also clears entries that name the id and writes nothing else
insert into auth.audit_log_entries (instance_id, id, payload, created_at) values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), '{"action":"token_revoked","actor_id":"99999999-0000-0000-0000-0000000000c1"}', now());
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000c1', 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'the retry says already_deleted');
select is(pg_temp.audit_hits('99999999-0000-0000-0000-0000000000c1'), 0::bigint, 'and removes an entry written after the deletion that names the id');
select is((select count(*) from auth.audit_log_entries where payload::text ilike '%0000000000c2%'), (select n_other from audit_before), 'without touching the other person''s entries');
-- refusals touch nothing: a stale token deletes no audit entry
insert into auth.audit_log_entries (instance_id, id, payload, created_at) values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), '{"action":"login","actor_id":"99999999-0000-0000-0000-0000000000c2","actor_username":"other.person@example.test"}', now());
create temp table audit_c2 as select count(*) as n from auth.audit_log_entries where payload::text ilike '%0000000000c2%';
select is(pg_temp.val_claims('99999999-0000-0000-0000-0000000000c2', 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000))), 'select app.delete_my_account()'), 'err=42501: reauthentication_required', 'a stale token is refused');
select is((select count(*) from auth.audit_log_entries where payload::text ilike '%0000000000c2%'), (select n from audit_c2), 'and removes no audit entry');
select is((select count(*) from auth.users where id = '99999999-0000-0000-0000-0000000000c2'), 1::bigint, 'nor the user');
delete from auth.users where id = '99999999-0000-0000-0000-0000000000c2';
delete from auth.audit_log_entries where payload::text ilike '%0000000000c2%' or payload::text like '%logout%';

-- ---- invariants over the whole database after all deletions ---------------------------------------------------------------------
select is((select count(*) from app.profiles where id not in (select id from auth.users)), 0::bigint, 'no profile is without an auth user');
select is_empty($$ select t.tbl from pg_temp.app_tables t where t.tbl <> 'profiles' and pg_temp.n_rows(t.tbl, pg_temp.ua()) <> 0 $$, 'nothing of A anywhere');
select is((select count(*) from auth.users), 1::bigint, 'only B is left');

select * from finish();
rollback;
