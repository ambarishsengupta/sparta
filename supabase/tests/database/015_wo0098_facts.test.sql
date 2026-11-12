-- WO-0098 (R7a) / CC2: the insight lookups, the aggregation tables and analytics_private.build_facts (LLD 5.1 steps 3 and 4).
-- (The R7 spec calls this file 014_wo0098_facts; 014 already exists from WO-0088, so the next free number is used.)
-- Everything is synthetic and rolled back. A fact row is found by (user, kind, sub-type), so each scenario item has its own sub-type.
begin;
\ir helpers.inc
select plan(131);

-- ---- fixtures ----------------------------------------------------------------------------------------------------------------------
create function pg_temp.u(p text) returns uuid language sql immutable as $f$ select md5('wo0098:' || p)::uuid $f$;
create temp table salt (v text);
insert into salt values (repeat('a', 32));
create function pg_temp.h(p_uid uuid) returns text language sql stable as $f$ select encode(extensions.digest(p_uid::text || (select v from salt), 'sha256'), 'hex') $f$;
create function pg_temp.f(p_uid uuid, p_kind text, p_sub text, p_col text) returns text language plpgsql as $f$
declare r text;
begin
  execute format('select string_agg(%I::text, '','' order by %I::text) from analytics_private.facts where user_hash = %L and kind = %L and sub_type = %L',
    p_col, p_col, pg_temp.h(p_uid), p_kind, p_sub) into r;
  return r;
end $f$;
create function pg_temp.n(p_uid uuid, p_kind text default null) returns bigint language sql stable as
  $f$ select count(*) from analytics_private.facts where user_hash = pg_temp.h(p_uid) and (p_kind is null or kind = p_kind) $f$;
create function pg_temp.dig() returns text language sql stable as $f$ select md5(coalesce(string_agg(f::text, ',' order by f::text), '')) from analytics_private.facts f $f$;
create function pg_temp.it(p_uid uuid, p_sub text, j jsonb default '{}') returns void language sql as $f$
  insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, status, fit, brand, size_system, size_value, price, currency, condition, seasons, notes, store)
  select p_uid, 'MySecretName', c.category, c.code, 10, 20, 30, 'manual', coalesce(j->>'status', 'active'), j->>'fit', j->>'brand', j->>'sys', j->>'size',
    (j->>'price')::numeric, j->>'cur', (j->>'cond')::smallint, array(select jsonb_array_elements_text(j->'seasons')), 'private note', 'ShopX'
  from catalog.lk_sub_type c where c.code = p_sub $f$;
create function pg_temp.wl(p_uid uuid, p_sub text, j jsonb default '{}') returns void language sql as $f$
  insert into app.wishlist_entries (user_id, name, category, sub_type, status, origin, brand, target_price, currency, created_at, notes)
  select p_uid, 'MySecretName', c.category, c.code, coalesce(j->>'status', 'open'), coalesce(j->>'origin', 'user'), j->>'brand', (j->>'price')::numeric, j->>'cur',
    coalesce((j->>'created')::timestamptz, now()), 'private note'
  from catalog.lk_sub_type c where c.code = p_sub $f$;
create function pg_temp.pu(p_uid uuid, p_sub text, j jsonb default '{}') returns void language sql as $f$
  insert into app.purchases (id, user_id, item_id, purchase_date, price, currency, quantity, store, created_at)
  select coalesce((j->>'id')::uuid, gen_random_uuid()), p_uid, i.id, (j->>'date')::date, (j->>'price')::numeric, j->>'cur', coalesce((j->>'qty')::int, 1), 'ShopX',
    coalesce((j->>'created')::timestamptz, now())
  from app.items i where i.user_id = p_uid and i.sub_type = p_sub $f$;

select pg_temp.mk_user(pg_temp.u(x)) from unnest(array['A', 'B', 'C', 'G', 'N', 'D', 'O', 'V', 'M']) x;
select pg_temp.make_eligible(pg_temp.u(x)) from unnest(array['A', 'B', 'C', 'G', 'N', 'D', 'O', 'V', 'M']) x;
update ops.settings set value = 'IN,US' where key = 'supported_countries';
delete from app.consent_records where user_id = pg_temp.u('N');                       -- N: no consent
update app.profiles set deleting = true where id = pg_temp.u('D');                     -- D: leaving the pilot
update app.profiles set country = 'FR' where id = pg_temp.u('O');                      -- O: outside the supported countries
update app.profiles set country = 'US' where id = pg_temp.u('G');                      -- G: eligible, in a country with no region
update app.profiles set role = 'vendor' where id = pg_temp.u('V');
update app.profiles set role = 'admin' where id = pg_temp.u('M');

-- ---- 1. lookups (before the test adds rows of its own) ---------------------------------------------------------------------------------
select is((select array_agg(code order by sort) from catalog.lk_price_band), array['<25', '25-50', '50-100', '100-200', '200+', 'Unknown'], 'lk_price_band holds exactly the six codes');
select is((select array_agg(code) from catalog.lk_region), array['South Asia'], 'lk_region holds South Asia');
select is((select array_agg(country || '>' || region) from catalog.country_region), array['IN>South Asia'], 'country_region maps IN to South Asia and nothing else');
select is((select array_agg(size_system || ':' || code order by sort) from catalog.lk_size), array['Letter:XS', 'Letter:S', 'Letter:M', 'Letter:L', 'Letter:XL', 'Letter:XXL', 'Letter:XXXL'], 'lk_size holds the seven Letter sizes');
select is((select count(*) from catalog.lk_brand), 0::bigint, 'lk_brand stays empty (the brand list is the owner''s)');
insert into catalog.lk_brand (code, label) values ('ZRV', 'Zor Vane');
insert into catalog.lk_size (size_system, code, label) values ('Shoe EU', 'M', 'M');
insert into ops.fx_rates (currency, rate_date, per_usd) values ('INR', '2097-12-01', 80), ('INR', '2098-01-01', 100), ('USD', '2098-01-01', 2);

-- ---- 2. shape, grants, function hygiene --------------------------------------------------------------------------------------------
create temp table tbls (t regclass primary key);
insert into tbls values ('ops.aggregate_runs'), ('analytics_private.facts'), ('analytics_private.cube_stage'), ('analytics.cube');
select has_table(n.nspname::name, c.relname::name, n.nspname || '.' || c.relname || ' exists') from tbls join pg_class c on c.oid = t join pg_namespace n on n.oid = c.relnamespace order by c.relname;
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'aggregate_runs'),
  array['id', 'started_at', 'finished_at', 'status', 'error_code', 'users_included', 'items_included', 'rows_suppressed', 'duration_ms'], 'aggregate_runs has the LLD columns');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'analytics_private' and table_name = 'facts'),
  array['user_hash', 'kind', 'period', 'category', 'sub_type', 'colour_family', 'fit', 'brand', 'size', 'season', 'price_band', 'condition_band', 'region'], 'facts has exactly the columns of LLD 5.1 step 4');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'analytics_private' and table_name = 'cube_stage'),
  array['kind', 'period', 'd_category', 'd_colour_family', 'd_fit', 'd_brand', 'f_size', 'f_season', 'f_price_band', 'f_region', 'condition_band', 'users', 'events'], 'cube_stage holds the dimensions and the raw counts');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'analytics' and table_name = 'cube'),
  array['run_id', 'kind', 'period', 'd_category', 'd_colour_family', 'd_fit', 'd_brand', 'f_size', 'f_season', 'f_price_band', 'f_region', 'condition_band', 'users_rounded', 'events_rounded', 'users_floor'],
  'cube holds the rounded values and users_floor only (no users, no events)');
select is_empty($$ select column_name from information_schema.columns where table_schema = 'analytics_private' and table_name = 'facts'
  and column_name ~* 'name|email|note|image|path|receipt|store|rgb|hex|feature|user_id|price$|currency' $$, 'no facts column is named like a name, email, note, image, path, receipt, store, rgb, hex, feature, id or price');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'analytics_private' and table_name = 'facts' and is_nullable = 'YES'),
  array['condition_band'], 'only condition_band can be null in facts');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (select t from tbls)), 'RLS is enabled and forced on all four tables');
select is_empty($$ select tablename from pg_policies where schemaname in ('ops', 'analytics', 'analytics_private') and tablename in ('aggregate_runs', 'facts', 'cube_stage', 'cube') $$, 'the four tables have no policy');
select is_empty($$ select r.r || ' ' || t from tbls cross join (values ('anon'), ('authenticated'), ('service_role')) r(r)
  where has_any_column_privilege(r.r, t, 'select,insert,update,references') or has_table_privilege(r.r, t, 'delete,truncate,trigger') $$,
  'anon, authenticated and service_role hold no privilege on the four tables');
select is_empty($$ select t from tbls join pg_class c on c.oid = t, aclexplode(c.relacl) a where a.grantee = 0 $$, 'public holds no privilege on the four tables');
select ok(not has_sequence_privilege('authenticated', 'ops.aggregate_runs_id_seq', 'usage,select,update') and not has_sequence_privilege('service_role', 'ops.aggregate_runs_id_seq', 'usage,select,update')
  and not has_sequence_privilege('anon', 'ops.aggregate_runs_id_seq', 'usage,select,update'), 'no client role can use the run id sequence');
select is_empty($$ select r.r || ' ' || t from tbls cross join (values ('anon'), ('authenticated'), ('service_role')) r(r)
  where pg_temp.run_as(pg_temp.u('A'), r.r, 'select 1 from ' || t) is distinct from 'err=42501' $$, 'a select on any of the four tables is refused with 42501 for every client role');
select ok(has_schema_privilege('authenticated', 'analytics', 'usage') and not has_schema_privilege('anon', 'analytics', 'usage') and has_schema_privilege('service_role', 'analytics', 'usage'),   -- WO-0102: service_role for build_report only
  'usage on schema analytics: authenticated and service_role only');
select ok(not has_schema_privilege('anon', 'analytics_private', 'usage') and not has_schema_privilege('authenticated', 'analytics_private', 'usage')
  and not has_schema_privilege('service_role', 'analytics_private', 'usage'), 'no client role has usage on analytics_private');
select is_empty($$ select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname in ('analytics', 'analytics_private') and a.grantee = 0 $$, 'public has usage on neither analytics schema');
select is((select p.prosecdef from pg_proc p where p.oid = 'analytics_private.build_facts(text)'::regprocedure), true, 'build_facts is security definer');
select is((select p.proconfig from pg_proc p where p.oid = 'analytics_private.build_facts(text)'::regprocedure), array['search_path=""'], 'build_facts pins search_path to the empty path');
select is((select p.prorettype::regtype::text from pg_proc p where p.oid = 'analytics_private.build_facts(text)'::regprocedure), 'integer', 'build_facts returns int');
select ok(not has_function_privilege('anon', 'analytics_private.build_facts(text)', 'execute') and not has_function_privilege('authenticated', 'analytics_private.build_facts(text)', 'execute')
  and not has_function_privilege('service_role', 'analytics_private.build_facts(text)', 'execute'), 'execute on build_facts is revoked from anon, authenticated and service_role');
select is_empty($$ select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'analytics_private.build_facts(text)'::regprocedure and a.grantee = 0 $$, 'execute on build_facts is revoked from public');
select is_empty($$ select r from (values ('anon'), ('authenticated'), ('service_role')) v(r) where pg_temp.run_as(pg_temp.u('A'), r, 'select analytics_private.build_facts(''x'')') is distinct from 'err=42501' $$,
  'no client role can call build_facts (42501)');
select ok((select prosrc !~* 'receipt|outfit|item_features|jobs' from pg_proc where oid = 'analytics_private.build_facts(text)'::regprocedure), 'build_facts reads no receipt, outfit, feature or job table');
select is((select array_agg(distinct m[1] order by m[1]) from regexp_matches((select prosrc from pg_proc where oid = 'analytics_private.build_facts(text)'::regprocedure), 'app\.([a-z_]+)', 'g') m),
  array['items', 'profiles', 'purchases', 'wishlist_entries'], 'build_facts names only items, profiles, purchases and wishlist_entries of the app schema');
select is(pg_temp.run_as(null, 'postgres', 'insert into ops.aggregate_runs default values'), 'rows=1', 'a run row can be inserted by the owner');
select is((select status || '/' || (finished_at is null) from ops.aggregate_runs order by id desc limit 1), 'running/true', 'status defaults to running with no finish time');
select throws_ok($$ insert into ops.aggregate_runs (status) values ('error') $$, '23514', null, 'status error needs an error code');
select throws_ok($$ insert into ops.aggregate_runs (status, finished_at) values ('weird', now()) $$, '23514', null, 'status is running, ok or error');
select throws_ok($$ insert into ops.aggregate_runs (status) values ('ok') $$, '23514', null, 'a finished run needs a finish time');

-- ---- 3. fixtures for the facts -------------------------------------------------------------------------------------------------------
-- A: kinds. T-shirt is a plain active item; Boxers is archived but bought; Shirt's purchase has no date
select pg_temp.it(pg_temp.u('A'), 'T-shirt', '{"brand":"zor vane","sys":"Letter","size":"m","seasons":["Summer"],"price":2000,"cur":"INR","cond":5,"fit":"Slim"}');
select pg_temp.it(pg_temp.u('A'), 'Boxers', '{"status":"archived","price":10,"cur":"USD"}');
select pg_temp.it(pg_temp.u('A'), 'Shirt');
select pg_temp.pu(pg_temp.u('A'), 'Boxers', jsonb_build_object('id', pg_temp.oid('purchase', pg_temp.u('A'), 0), 'date', '2026-09-20', 'price', 300, 'cur', 'USD', 'qty', 3));
select pg_temp.pu(pg_temp.u('A'), 'Shirt', '{"created":"2026-07-04T10:00:00Z","price":40,"cur":"USD"}');
select pg_temp.wl(pg_temp.u('A'), 'Jeans', '{"created":"2026-08-15T10:00:00Z","price":150,"cur":"USD","brand":"Whatever Typed"}');
select pg_temp.wl(pg_temp.u('A'), 'Chinos', '{"status":"bought","created":"2026-08-20T10:00:00Z"}');
select pg_temp.wl(pg_temp.u('A'), 'Trousers', '{"origin":"unlock"}');
select pg_temp.wl(pg_temp.u('A'), 'Shorts', '{"origin":"unlock","status":"bought"}');
select pg_temp.wl(pg_temp.u('A'), 'Joggers');
-- B: price bands, one item each (the Belt has no price of its own: the purchase carries 300 USD)
select pg_temp.it(pg_temp.u('B'), s, jsonb_build_object('price', p, 'cur', c)) from (values ('Sweater', 24.99, 'USD'), ('Cardigan', 25, 'USD'), ('Hoodie', 49.99, 'USD'), ('Jacket', 50, 'USD'),
  ('Blazer', 100, 'USD'), ('Coat', 199.99, 'USD'), ('Sneakers', 200, 'USD'), ('Formal shoes', 0, 'USD'), ('Boots', 2000, 'INR'), ('Sandals', 2500, 'INR'), ('Watch', 500, 'ZZZ'),
  ('Tie', 30, null), ('Scarf', 30, 'USD')) v(s, p, c);
select pg_temp.it(pg_temp.u('B'), 'Belt');
select pg_temp.pu(pg_temp.u('B'), 'Belt', '{"price":300,"cur":"USD","date":"2026-10-02"}');
select pg_temp.wl(pg_temp.u('B'), 'Bag', '{"price":150,"cur":"USD"}');
-- C: brand, size, season and condition rules
select pg_temp.it(pg_temp.u('C'), s, jsonb_build_object('brand', b)) from (values ('Shirt', 'zor vane'), ('Polo', 'ZORVANE'), ('Sweater', 'Brandless Unlisted'), ('Hoodie', '   ')) v(s, b);
select pg_temp.it(pg_temp.u('C'), 'Cardigan');
select pg_temp.it(pg_temp.u('C'), s, jsonb_build_object('sys', y, 'size', z)) from (values ('Jeans', 'Letter', 'm'), ('Chinos', 'Letter', ' X l '), ('Trousers', 'Shoe EU', 'M'),
  ('Shorts', 'Letter', 'XXXXL'), ('Joggers', 'Waist and length', '32'), ('Blazer', 'Letter', '  ')) v(s, y, z);
select pg_temp.it(pg_temp.u('C'), 'Jacket');
select pg_temp.it(pg_temp.u('C'), s, jsonb_build_object('seasons', q::jsonb)) from (values ('Coat', '["Summer"]'), ('Sneakers', '["Summer","Winter"]'), ('Formal shoes', '["Winter","Summer"]'),
  ('Boots', '[]'), ('Sandals', '["Summer","All year"]'), ('Watch', '["Summer","Summer"]')) v(s, q);
select pg_temp.it(pg_temp.u('C'), s, jsonb_build_object('cond', k)) from (values ('Belt', 5), ('Tie', 35), ('Scarf', 85), ('Bag', 84), ('Briefs', 0), ('Vest', 100), ('Socks', 10)) v(s, k);
select pg_temp.it(pg_temp.u('C'), 'Cap');
-- G: a supported country with no region; N, D, O, V, M: each has one row of every kind that would exist if the user counted
select pg_temp.it(pg_temp.u('G'), 'T-shirt');
select pg_temp.it(pg_temp.u(x), 'Polo') from unnest(array['N', 'D', 'O', 'V', 'M']) x;
select pg_temp.wl(pg_temp.u(x), 'Jeans') from unnest(array['N', 'D', 'O', 'V', 'M']) x;
select pg_temp.pu(pg_temp.u(x), 'Polo', '{"price":20,"cur":"USD"}') from unnest(array['N', 'D', 'O', 'V', 'M']) x;

create temp table built as select analytics_private.build_facts((select v from salt)) as r;
select is((select r from built), (select count(*)::int from analytics_private.facts), 'build_facts returns the number of fact rows it wrote');

-- ---- 4. who is included ------------------------------------------------------------------------------------------------------------
select cmp_ok(pg_temp.n(pg_temp.u('A')), '>', 0::bigint, 'an eligible consumer adds rows');
select is(pg_temp.n(pg_temp.u('N')), 0::bigint, 'a consumer without consent adds no row');
select is(pg_temp.n(pg_temp.u('D')), 0::bigint, 'a consumer with deleting = true adds no row');
select is(pg_temp.n(pg_temp.u('O')), 0::bigint, 'a consumer outside the supported countries adds no row');
select is(pg_temp.n(pg_temp.u('V')), 0::bigint, 'a vendor adds no row');
select is(pg_temp.n(pg_temp.u('M')), 0::bigint, 'an admin adds no row');
select is((select count(distinct user_hash) from analytics_private.facts where user_hash in (select pg_temp.h(pg_temp.u(x)) from unnest(array['A', 'B', 'C', 'G']) x)), 4::bigint, 'the four eligible users are all present');
update ops.settings set value = 'on' where key = 'maintenance';
select analytics_private.build_facts((select v from salt));
select cmp_ok(pg_temp.n(pg_temp.u('A')), '>', 0::bigint, 'maintenance mode does not change who is included');
update ops.settings set value = 'off' where key = 'maintenance';
select analytics_private.build_facts((select v from salt));

-- ---- 5. the four kinds ------------------------------------------------------------------------------------------------------------
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'category'), 'Tops', 'an active item adds an owned row');
select is(pg_temp.n(pg_temp.u('A'), 'owned'), 2::bigint, 'owned: the two active items only (the archived one adds nothing)');
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'Boxers', 'period'), null, 'an archived item adds no owned row');
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'period'), date_trunc('month', now() at time zone 'UTC')::date::text, 'owned period is the current month');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Jeans', 'category'), 'Bottoms', 'an open user entry adds a wishlist_open row');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Jeans', 'period'), date_trunc('month', now() at time zone 'UTC')::date::text, 'wishlist_open period is the current month, not the month created');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Chinos', 'period'), null, 'a bought entry is not wishlist_open');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist', 'Chinos', 'period'), '2026-08-01', 'a bought user entry is in wishlist, by the month created');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist', 'Jeans', 'period'), '2026-08-01', 'an open user entry is in wishlist too, by the month created');
select is(pg_temp.n(pg_temp.u('A'), 'wishlist'), 3::bigint, 'wishlist: Jeans, Chinos and Joggers (the two unlock entries add nothing)');
select is(pg_temp.n(pg_temp.u('A'), 'wishlist_open'), 2::bigint, 'wishlist_open: Jeans and Joggers');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Trousers', 'kind') || pg_temp.f(pg_temp.u('A'), 'wishlist', 'Trousers', 'kind'), null, 'an open unlock entry adds no wishlist_open or wishlist row');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Shorts', 'kind') || pg_temp.f(pg_temp.u('A'), 'wishlist', 'Shorts', 'kind'), null, 'a bought unlock entry adds no wishlist_open or wishlist row');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Boxers', 'category'), 'Underwear and socks', 'a purchase of an archived item adds a purchase row with the item''s attributes');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Boxers', 'period'), '2026-09-01', 'purchase period is the purchase month');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Shirt', 'period'), '2026-07-01', 'a purchase with no date falls back to the month it was recorded');
select is(pg_temp.n(pg_temp.u('A'), 'purchase'), 2::bigint, 'purchase: one row per purchase, whatever the quantity');
select is((select count(*) from analytics_private.facts where kind <> 'owned' and condition_band is not null), 0::bigint, 'condition_band is null for every kind but owned');
select is((select count(*) from analytics_private.facts where kind = 'owned' and condition_band is null), 0::bigint, 'condition_band is never null for owned');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Boxers', 'colour_family'), 'Black', 'colour family comes from the item''s colour trigger');

-- ---- 6. privacy of the facts -------------------------------------------------------------------------------------------------------
select is((select count(*) from analytics_private.facts f where to_jsonb(f)::text ~* 'MySecretName|private note|ShopX|Whatever Typed|Brandless|@example|^#|http'), 0::bigint, 'no typed name, note, store, brand or address reaches the facts');
select is_empty($$ select 1 from analytics_private.facts where user_hash !~ '^[0-9a-f]{64}$' $$, 'every user_hash is 64 hex characters');
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'user_hash'), encode(extensions.digest(pg_temp.u('A')::text || (select v from salt), 'sha256'), 'hex'), 'user_hash is the sha256 of user id and salt');
select is_empty($$ select 1 from analytics_private.facts where user_hash = any (select pg_temp.u(x)::text from unnest(array['A', 'B', 'C', 'G']) x) $$, 'a user id never appears as a hash');
select is_empty($$ select 1 from analytics_private.facts where brand not in (select code from catalog.lk_brand union select 'Other' union select 'Unknown')
  or category not in (select code from catalog.lk_category) or colour_family not in (select code from catalog.lk_colour_family union select 'Unknown')
  or fit not in (select code from catalog.lk_fit union select 'Unknown') or price_band not in (select code from catalog.lk_price_band)
  or season not in (select code from catalog.lk_season union select 'Multi-season') or region not in (select code from catalog.lk_region union select 'Unknown')
  or size not in (select size_system || ':' || code from catalog.lk_size union select 'Other' union select 'Unknown') $$, 'every grouped value is a lookup code or one of Other, Unknown, Multi-season');
create temp table before as select pg_temp.dig() as d, (select count(*) from analytics_private.facts) as n;
do $$ begin
  execute pg_temp.tpl('outfits', pg_temp.u('A'), 0);
  execute pg_temp.tpl('outfit_logs', pg_temp.u('A'), 0);
  insert into app.receipts (id, user_id, storage_path, store, total, currency)
    values (pg_temp.oid('receipt', pg_temp.u('A'), 0), pg_temp.u('A'), pg_temp.u('A')::text || '/' || pg_temp.oid('rcp', pg_temp.u('A'), 0)::text || '.jpg', 'ShopX', 99, 'USD');
  execute pg_temp.tpl('purchase_receipts', pg_temp.u('A'), 0);
end $$;
select analytics_private.build_facts((select v from salt));
select is(pg_temp.dig(), (select d from before), 'a receipt row, its purchase link and an outfit log change no fact');
select is((select count(*) from analytics_private.facts), (select n from before), 'and no fact row appears or disappears');
update salt set v = repeat('b', 32);
select analytics_private.build_facts((select v from salt));
select is((select count(*) from analytics_private.facts), (select n from before), 'a second build replaces the first (no rows added)');
select ok(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'user_hash') <> encode(extensions.digest(pg_temp.u('A')::text || repeat('a', 32), 'sha256'), 'hex'), 'a different salt gives a different hash');
select is((select count(*) from analytics_private.facts where user_hash in (select encode(extensions.digest(u::text || repeat('a', 32), 'sha256'), 'hex') from unnest(array[pg_temp.u('A'), pg_temp.u('B'), pg_temp.u('C')]) u)), 0::bigint, 'no hash of the first salt survives the second build');
select throws_ok($$ select analytics_private.build_facts(null) $$, '22023', 'invalid_salt', 'a null salt is refused');
select throws_ok($$ select analytics_private.build_facts('') $$, '22023', 'invalid_salt', 'an empty salt is refused');
select is((select count(*) from analytics_private.facts), (select n from before), 'a refused call leaves the facts as they were');
select is_empty($$ select 1 from pg_attribute a where a.attrelid in (select t from tbls) and a.attnum > 0 and a.attname ~* 'salt' $$, 'no column of the four tables holds a salt');
update salt set v = repeat('a', 32);
select analytics_private.build_facts((select v from salt));

-- ---- 7. mapping rules ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Shirt', 'brand'), 'ZRV', 'brand: the label matches ignoring case and spaces and the code is stored');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Polo', 'brand'), 'ZRV', 'brand: upper case, no space matches too');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Sweater', 'brand'), 'Other', 'brand: a typed brand not in the list is Other');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Cardigan', 'brand'), 'Unknown', 'brand: no brand is Unknown');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Hoodie', 'brand'), 'Unknown', 'brand: blank text is Unknown');
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Jeans', 'brand'), 'Other', 'brand: a wishlist brand follows the same rule');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Jeans', 'size'), 'Letter:M', 'size: system:code, matched ignoring case');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Chinos', 'size'), 'Letter:XL', 'size: matched ignoring spaces');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Trousers', 'size'), 'Shoe EU:M', 'size: the same code in another system stays apart');
select isnt(pg_temp.f(pg_temp.u('C'), 'owned', 'Trousers', 'size'), pg_temp.f(pg_temp.u('C'), 'owned', 'Jeans', 'size'), 'size: two systems never merge');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Shorts', 'size'), 'Other', 'size: a Letter size outside the list is Other');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Joggers', 'size'), 'Other', 'size: a system with no listed sizes is Other');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Jacket', 'size'), 'Unknown', 'size: no size is Unknown');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Blazer', 'size'), 'Unknown', 'size: a blank size is Unknown');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Coat', 'season'), 'Summer', 'season: one season');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Sneakers', 'season'), 'Multi-season', 'season: two seasons');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Formal shoes', 'season'), 'Multi-season', 'season: the same two seasons stored the other way round');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Boots', 'season'), 'All year', 'season: none set is All year');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Sandals', 'season'), 'All year', 'season: All year among others is All year');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Watch', 'season'), 'Summer', 'season: a repeated season is one season');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Boxers', 'season'), 'All year', 'season: a purchase uses the linked item''s seasons');
select is(pg_temp.f(pg_temp.u('A'), 'purchase', 'Boxers', 'price_band'), '200+', 'price: a purchase uses its own price (300 USD), not the item''s (10 USD)');
select is(pg_temp.f(pg_temp.u('B'), 'purchase', 'Belt', 'price_band'), '200+', 'price: a purchase price counts when the item has none');
select is(pg_temp.f(pg_temp.u('B'), 'wishlist_open', 'Bag', 'price_band') || '/' || pg_temp.f(pg_temp.u('B'), 'wishlist', 'Bag', 'price_band'), '100-200/100-200', 'price: a wishlist entry uses its target price');
select is(pg_temp.f(pg_temp.u('B'), 'owned', s, 'price_band'), e, 'price: ' || s || ' ' || p || ' ' || coalesce(c, 'no currency') || ' is ' || e)
  from (values ('Sweater', 24.99, 'USD', '<25'), ('Cardigan', 25, 'USD', '25-50'), ('Hoodie', 49.99, 'USD', '25-50'), ('Jacket', 50, 'USD', '50-100'), ('Blazer', 100, 'USD', '100-200'),
  ('Coat', 199.99, 'USD', '100-200'), ('Sneakers', 200, 'USD', '200+'), ('Formal shoes', 0, 'USD', '<25'),
  ('Boots', 2000, 'INR', '<25'), ('Sandals', 2500, 'INR', '25-50'), ('Watch', 500, 'ZZZ', 'Unknown'), ('Tie', 30, null, 'Unknown'), ('Scarf', 30, 'USD', '25-50')) v(s, p, c, e);
select is(pg_temp.f(pg_temp.u('B'), 'owned', 'Belt', 'price_band'), 'Unknown', 'price: no price is Unknown');
select is(pg_temp.f(pg_temp.u('C'), 'owned', 'Shirt', 'price_band'), 'Unknown', 'price: an item with no price or currency is Unknown');
select is(pg_temp.f(pg_temp.u('G'), 'owned', 'T-shirt', 'region'), 'Unknown', 'region: a country with no mapping is Unknown');
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'region'), 'South Asia', 'region: IN maps to South Asia');
select is(pg_temp.f(pg_temp.u('A'), 'owned', 'T-shirt', 'condition_band'), 'Brand new', 'condition: 5 is Brand new');
select is(pg_temp.f(pg_temp.u('C'), 'owned', k, 'condition_band'), e, 'condition ' || k || ' is ' || e)
  from (values ('Belt', 'Brand new'), ('Briefs', 'Brand new'), ('Socks', 'Like new'), ('Tie', 'Good'), ('Bag', 'Worn'), ('Scarf', 'Falling apart'), ('Vest', 'Falling apart'), ('Cap', 'Unrated')) v(k, e);
select is(pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'fit') || '|' || pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'brand') || '|' || pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'size')
  || '|' || pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'price_band') || '|' || pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'colour_family') || '|' || pg_temp.f(pg_temp.u('A'), 'wishlist_open', 'Joggers', 'season'),
  'Unknown|Unknown|Unknown|Unknown|Unknown|All year', 'a bare wishlist entry stores Unknown in every grouped column (never null)');

select * from finish();
rollback;
