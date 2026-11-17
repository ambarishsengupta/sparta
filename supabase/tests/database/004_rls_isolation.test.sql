-- WO-0041 / CC3: row-level isolation for EVERY table of the app schema, derived from the catalog. User A is an eligible
-- consumer, B another one, both with one fixture row in every table. A cannot select B's rows, insert for B, update or delete
-- them; an anonymous caller gets nothing; B's rows are byte-identical afterwards. A new table needs an entry in pg_temp.tpl
-- (helpers.inc), or the "every table has a template" assertion fails.
begin;
\ir helpers.inc
select count(*) as nt from pg_temp.app_tables \gset
select count(*) as nv from pg_class where relnamespace = 'app'::regnamespace and relkind in ('v', 'm', 'f') \gset
select plan(:nt * 16 + :nv * 3 + 23);

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ub());
select pg_temp.seed_user(pg_temp.ua());
select pg_temp.seed_user(pg_temp.ub());
select pg_temp.mk_user('cccccccc-cccc-cccc-cccc-cccccccccccc');   -- C: eligible, owns no rows, so nothing hides other users' rows from C's statements
select pg_temp.make_eligible('cccccccc-cccc-cccc-cccc-cccccccccccc');
create temp table before as select tbl, pg_temp.digest(tbl, pg_temp.ub()) as d from pg_temp.app_tables;
create temp table a_digest as select tbl, pg_temp.digest(tbl, pg_temp.ua()) as d from pg_temp.app_tables;
create temp table a_before as select tbl, pg_temp.n_rows(tbl, pg_temp.ua()) as n from pg_temp.app_tables;

-- the test is not vacuous: templates exist, fixtures exist, both users are eligible
select is_empty($$ select tbl from pg_temp.app_tables where pg_temp.tpl(tbl, pg_temp.ua(), 1) is null $$, 'every app table has an insert template in this suite');
select is_empty($$ select tbl from pg_temp.app_tables t where pg_temp.n_rows(t.tbl, pg_temp.ua()) < 1 or pg_temp.n_rows(t.tbl, pg_temp.ub()) < 1 $$, 'both users have a fixture row in every table');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.has_consent()'), 'true', 'A passes the consent gate');
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.has_consent()'), 'true', 'B passes the consent gate');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.current_role()'), 'consumer', 'A is a consumer');

-- 1. select
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from app.%I where %I = %L', tbl, pg_temp.owner_col(tbl), pg_temp.ub())),
  'rows=0', 'A cannot select B''s rows in app.' || tbl) from pg_temp.app_tables order by tbl;
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select count(*) from app.%I', tbl)), (select n::text from a_before b where b.tbl = t.tbl),
  'an unfiltered select in app.' || tbl || ' returns only A''s rows') from pg_temp.app_tables t order by tbl;
select matches(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from app.%I where %I = %L', tbl, pg_temp.owner_col(tbl), pg_temp.ua())),
  '^rows=[1-9]', 'A can select A''s own rows in app.' || tbl) from pg_temp.app_tables order by tbl;

-- 2. anonymous callers get nothing (no privilege at all)
select is(pg_temp.run_as(null, 'anon', format('select 1 from app.%I', tbl)), 'err=42501', 'anon cannot select from app.' || tbl) from pg_temp.app_tables order by tbl;
select is(pg_temp.run_as(null, 'anon', pg_temp.tpl(tbl, pg_temp.ub(), 1)), 'err=42501', 'anon cannot insert into app.' || tbl) from pg_temp.app_tables order by tbl;
select is(pg_temp.run_as(null, 'anon', format('update app.%I set %I = %L', tbl, pg_temp.owner_col(tbl), pg_temp.ua())), 'err=42501', 'anon cannot update app.' || tbl) from pg_temp.app_tables order by tbl;

-- 3. insert for another user: refused, by the policy (42501) or earlier by a BEFORE trigger that cannot see B's parent rows
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.tpl(tbl, pg_temp.ub(), 1)),
  case tbl when 'item_features' then 'err=23503' when 'outfit_items' then 'err=23514' else 'err=42501' end,
  'A cannot insert a row for B into app.' || tbl) from pg_temp.app_tables order by tbl;

-- 4. update and delete B's rows: no row is touched (RLS hides it) or the operation is not granted at all
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated',
  case tbl when 'profiles' then format('update app.profiles set display_name = %L where id = %L', 'hacked', pg_temp.ub())
           when 'receipts' then format('update app.receipts set store = %L where user_id = %L', 'hacked', pg_temp.ub())   -- WO-0080: column-limited update grant (user_id is not updatable)
           else format('update app.%I set user_id = %L where user_id = %L', tbl, pg_temp.ua(), pg_temp.ub()) end),
  case when w.upd then 'rows=0' else 'err=42501' end, 'A cannot update B''s rows in app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) order by tbl;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('delete from app.%I where %I = %L', tbl, pg_temp.owner_col(tbl), pg_temp.ub())),
  case when w.del then 'rows=0' else 'err=42501' end, 'A cannot delete B''s rows in app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) order by tbl;

-- 4b. Statements WITHOUT a WHERE clause, so the select policy cannot hide rows and each update/delete policy stands alone. A needs
--     SELECT only to read columns in a WHERE; without one, the update and delete policies alone decide which rows are touched.
--     C owns nothing, so with correct policies these touch no row at all; A owns rows, and must not be able to hand them to B.
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated',
  case tbl when 'profiles' then 'update app.profiles set display_name = ''hacked'''
           when 'receipts' then 'update app.receipts set store = ''hacked'''   -- WO-0080: column-limited update grant
           else format('update app.%I set user_id = %L', tbl, 'cccccccc-cccc-cccc-cccc-cccccccccccc') end),
  case when tbl = 'profiles' then 'rows=1' when w.upd then 'rows=0' else 'err=42501' end,   -- C's own profile is the one row C owns
  'an update with no WHERE by a user who owns nothing touches no row of app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) order by tbl;
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', format('delete from app.%I', tbl)),
  case when w.del then 'rows=0' else 'err=42501' end, 'a delete with no WHERE by a user who owns nothing touches no row of app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) order by tbl;
select is(pg_temp.digest(tbl, pg_temp.ua()), (select d from a_digest a where a.tbl = t.tbl), 'A''s rows in app.' || tbl || ' are unchanged after C''s statements') from pg_temp.app_tables t order by tbl;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated',
  case tbl when 'profiles' then format('update app.profiles set id = %L', pg_temp.ub())
           else format('update app.%I set user_id = %L', tbl, pg_temp.ub()) end),
  case tbl when 'item_features' then 'err=23503' else 'err=42501' end, 'A cannot hand A''s own rows in app.' || tbl || ' to B')
  from pg_temp.app_tables t order by tbl;

-- 5. positive control: A can write own rows exactly where the design grants it (consent_records: the row exists already, so the
--    policy passes and the unique key refuses)
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.tpl(tbl, pg_temp.ua(), 1)),
  case when not w.ins then 'err=42501' when tbl = 'consent_records' then 'err=23505' else 'rows=1' end,
  'A''s own insert into app.' || tbl || ' behaves as designed')
  from pg_temp.app_tables t join want w using (tbl) order by tbl;

-- 6. after all of that, B's data is byte-identical
select is(pg_temp.digest(tbl, pg_temp.ub()), (select d from before b where b.tbl = t.tbl), 'B''s rows in app.' || tbl || ' are unchanged') from pg_temp.app_tables t order by tbl;

-- ---- other leaks: ops tables, helper functions, cross-user links ---------------------------------------------------------
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from ops.settings'), 'err=42501', 'A cannot read ops.settings');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from ops.invitations'), 'err=42501', 'A cannot read ops.invitations');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from ops.daily_counts'), 'err=42501', 'A cannot read ops.daily_counts');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select ops.is_eligible(%L)', pg_temp.ub())), 'err=42501', 'A cannot ask whether B is eligible');
select is(pg_temp.run_as(null, 'anon', 'select app.has_consent()'), 'err=42501', 'anon cannot call app.has_consent');
select is(pg_temp.val_as(null, 'anon', 'select app.supported_countries()::text'), '{IN}', 'anon can read the supported-country list');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.public_setting(''current_notice_version'')'), '1', 'A reads a public setting');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.public_setting(''supported_countries'')'), null, 'a setting outside the whitelist reads as null');

-- A cannot attach A's rows to B's rows (the composite keys include user_id), whatever the policies say: run as the session role
select throws_ok(format('insert into app.item_collections (user_id, item_id, collection_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.oid('coll', pg_temp.ua(), 0)),
  '23503', null, 'an item of B cannot join a collection of A');
select throws_ok(format('insert into app.item_tags (user_id, item_id, tag_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 1), pg_temp.oid('tag', pg_temp.ub(), 0)),
  '23503', null, 'a tag of B cannot be put on an item of A');
select throws_ok(format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)', pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 0), pg_temp.oid('item', pg_temp.ub(), 1), 'top'),
  '23503', null, 'an item of B cannot be put in an outfit of A');
select throws_ok(format('insert into app.outfit_plans (user_id, outfit_id, plan_date) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ub(), 0), '2026-12-02'),
  '23503', null, 'A cannot plan an outfit of B');
select throws_ok(format('insert into app.outfit_logs (user_id, outfit_id) values (%L, %L)', pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ub(), 0)),
  '23503', null, 'A cannot log an outfit of B');
select throws_ok(format('insert into app.purchases (user_id, item_id, price) values (%L, %L, 5)', pg_temp.ua(), pg_temp.oid('item', pg_temp.ub(), 1)),
  '23503', null, 'A cannot record a purchase of B''s item');

-- WO-0042 F5: the same attack from the other side of each link table (the parent that B owns is the second key)
select throws_ok(format('insert into app.item_collections (user_id, item_id, collection_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 1), pg_temp.oid('coll', pg_temp.ub(), 0)),
  '23503', null, 'an item of A cannot join a collection of B');
select throws_ok(format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)', pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ub(), 0), pg_temp.oid('item', pg_temp.ua(), 1), 'top'),
  '23503', null, 'an item of A cannot be put in an outfit of B');
select throws_ok(format('insert into app.item_tags (user_id, item_id, tag_id) values (%L, %L, %L)', pg_temp.ua(), pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.oid('tag', pg_temp.ua(), 0)),
  '23503', null, 'a tag of A cannot be put on an item of B');

-- WO-0042 F3: any view in app joins the loop (none exists today; 003 allows only security_invoker views). A sees none of B's rows through it.
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from app.%I where user_id = %L', relname, pg_temp.ub())), 'rows=0', 'A cannot select B''s rows through app.' || relname)
  from pg_class where relnamespace = 'app'::regnamespace and relkind in ('v', 'm', 'f') order by relname;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from app.%I where user_id <> %L', relname, pg_temp.ua())), 'rows=0', 'an unfiltered select through app.' || relname || ' shows only A''s rows')
  from pg_class where relnamespace = 'app'::regnamespace and relkind in ('v', 'm', 'f') order by relname;
select is(pg_temp.run_as(null, 'anon', format('select 1 from app.%I', relname)), 'err=42501', 'anon cannot select through app.' || relname)
  from pg_class where relnamespace = 'app'::regnamespace and relkind in ('v', 'm', 'f') order by relname;

-- ---- deletion is by cascade: removing B's auth user removes every B row and no A row -----------------------------------
delete from auth.users where id = pg_temp.ub();
select is(pg_temp.n_rows(tbl, pg_temp.ub()), 0::bigint, 'deleting the account removes B''s rows from app.' || tbl) from pg_temp.app_tables order by tbl;
select is_empty($$ select t.tbl from pg_temp.app_tables t join a_before b using (tbl) where pg_temp.n_rows(t.tbl, pg_temp.ua()) < b.n $$, 'A lost no rows when B was deleted');

select * from finish();
rollback;
