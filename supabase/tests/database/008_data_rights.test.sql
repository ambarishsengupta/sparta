-- WO-0060 / CC2: data rights. app.export_my_data() (FR-62) and app.delete_my_account() (FR-63, FR-66), plus the cascade audit.
-- Everything per table is derived from the catalog, so a new app table without export coverage, a fixture template (helpers.inc)
-- or a cascade chain to auth.users fails here. Users: A and B are eligible consumers with a row in every table.
begin;
\ir helpers.inc
select count(*) as nt from pg_temp.app_tables \gset
select plan(:nt * 7 + 94);

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
select is((select array_agg(c.relname::text order by c.relname) from pg_class c where c.relnamespace = 'ops'::regnamespace and c.relkind in ('r', 'p')),
  array['daily_counts', 'invitations', 'settings'], 'ops holds exactly the three tables this suite checks for personal data');
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
select is(pg_temp.val_as(null, 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'a signed-in role with no user ID deletes nothing');
select alike(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.delete_my_account(%L)', pg_temp.ub())), 'err=42883: function app.delete_my_account(%) does not exist', 'there is no way to name another user');
update app.profiles set role = 'vendor' where id = pg_temp.ub();
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'a vendor cannot use the consumer deletion');
update app.profiles set role = 'admin' where id = pg_temp.ub();
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'an admin cannot use the consumer deletion');
update app.profiles set role = 'consumer' where id = pg_temp.ub();
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'the refused callers deleted nothing');
select is((select count(*) from auth.users), 3::bigint, 'still exactly three users (A, B, C)');
select is(pg_temp.val_as('99999999-9999-9999-9999-999999999999', 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'a token whose user does not exist deletes nothing and says so');

-- ---- delete: A leaves -----------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.delete_my_account()'), 'deleted', 'A deletes the account');
select is((select count(*) from auth.users where id = pg_temp.ua()), 0::bigint, 'A''s auth user is gone');
select is(pg_temp.n_rows(tbl, pg_temp.ua()), 0::bigint, 'no row of A remains in app.' || tbl) from pg_temp.app_tables order by tbl;
select is_empty($$ select t.tbl from pg_temp.app_tables t join b_before b using (tbl) where pg_temp.digest(t.tbl, pg_temp.ub()) <> b.d or pg_temp.n_rows(t.tbl, pg_temp.ub()) <> b.n $$, 'B''s rows are unchanged in every table');
select cmp_ok((select min(n) from b_before), '>', 0::bigint, 'and B really had rows in every table');
select is((select count(*) from auth.users where id = pg_temp.ub()), 1::bigint, 'B''s auth user remains');
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
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'a second call is harmless and says already_deleted');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 1::bigint, 'and is not counted twice');
select is_empty($$ select t.tbl from pg_temp.app_tables t join b_before b using (tbl) where pg_temp.digest(t.tbl, pg_temp.ub()) <> b.d $$, 'B is still untouched');

-- ---- delete works for every kind of participant, however the consent gate stands -------------------------------------------------
-- D: the token carries claims that name B; only the real subject goes
select pg_temp.mk_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
select is(pg_temp.val_claims('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', jsonb_build_object('user_metadata', jsonb_build_object('sub', pg_temp.ub(), 'id', pg_temp.ub()), 'app_metadata', jsonb_build_object('sub', pg_temp.ub())),
  'select app.delete_my_account()'), 'deleted', 'D deletes with claims that name B in the metadata');
select is((select count(*) from auth.users where id in ('dddddddd-dddd-dddd-dddd-dddddddddddd', pg_temp.ub())), 1::bigint, 'only D went; B remains');
-- E: deletion already flagged by a server route that failed (the flag must not block a retry)
select pg_temp.mk_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select pg_temp.make_eligible('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
update app.profiles set deleting = true, deletion_requested_at = now() where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select is(ops.is_eligible('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), false, 'E, with deleting set, is not an eligible participant');
select is(pg_temp.val_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'E can still complete the deletion (re-entry)');
select is((select count(*) from app.profiles where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 0::bigint, 'E is gone');
-- F: never accepted anything (the not-available user of FR-4 and FR-9)
select pg_temp.mk_user('ffffffff-ffff-ffff-ffff-ffffffffffff');
update app.profiles set country = 'US', hemisphere = 'north' where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select app.has_consent()'), 'false', 'F fails the consent gate');
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select jsonb_array_length(app.export_my_data()->''profiles'')'), '1', 'F can export');
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'F can delete');
-- G: eligible with data, then locked out by a new notice version: every row still goes
select pg_temp.mk_user('99999999-0000-0000-0000-000000000001');
select pg_temp.make_eligible('99999999-0000-0000-0000-000000000001');
select pg_temp.seed_user('99999999-0000-0000-0000-000000000001');
update ops.settings set value = '2' where key = 'current_notice_version';
select is(pg_temp.run_as('99999999-0000-0000-0000-000000000001', 'authenticated', 'select 1 from app.items'), 'rows=0', 'G sees no items (consent gate closed)');
select is(pg_temp.val_as('99999999-0000-0000-0000-000000000001', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'G deletes anyway');
select is(pg_temp.n_rows(tbl, '99999999-0000-0000-0000-000000000001'), 0::bigint, 'no row of G remains in app.' || tbl) from pg_temp.app_tables order by tbl;
update ops.settings set value = '1' where key = 'current_notice_version';
-- H: an e-mail address with capitals still loses its (lower-case) invitation entry
insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000002', 'Mixed.Case@Example.test');
insert into ops.invitations (email) values ('mixed.case@example.test');
select is(pg_temp.val_as('99999999-0000-0000-0000-000000000002', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'H, whose address has capitals, deletes');
select is((select count(*) from ops.invitations where email = 'mixed.case@example.test'), 0::bigint, 'and the invitation entry goes (matched in lower case)');
-- W: a user with a session in the middle of use: the delete takes the session
insert into auth.sessions (id, user_id) values ('c0000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333');
select is(pg_temp.val_as('33333333-3333-3333-3333-333333333333', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'C, an account with no data, deletes');
select is((select count(*) from auth.sessions where user_id = '33333333-3333-3333-3333-333333333333'), 0::bigint, 'and its session ended');
select is((select sum(n) from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc_before), 7::bigint, 'seven real deletions (A, D, E, F, G, H, C) were counted, no more');

-- ---- invariants over the whole database after all deletions ---------------------------------------------------------------------
select is((select count(*) from app.profiles where id not in (select id from auth.users)), 0::bigint, 'no profile is without an auth user');
select is_empty($$ select t.tbl from pg_temp.app_tables t where t.tbl <> 'profiles' and pg_temp.n_rows(t.tbl, pg_temp.ua()) <> 0 $$, 'nothing of A anywhere');
select is((select count(*) from auth.users), 1::bigint, 'only B is left');

select * from finish();
rollback;
