-- WO-0040: schemas, lookup tables, seed rows and lookup access (LLD 4.1, 4.2, 4.5).
begin;
select plan(56);

select has_schema(s, 'schema ' || s || ' exists') from unnest(array['app','catalog','ops','analytics','analytics_private']) s;
select has_table('catalog', t, 'catalog.' || t || ' exists') from unnest(array['lk_category','lk_sub_type','lk_colour_family',
  'lk_fit','lk_material','lk_pattern','lk_season','lk_occasion','lk_size_system','lk_size','lk_brand','lk_condition_band',
  'lk_price_band','lk_region','country_region','colour_family_ref']) t;

-- seeded row counts equal the taxonomy (the exact codes are compared with taxonomy.json in vitest, CC4)
select is((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from catalog.%I', t.name), false, true, '')))[1]::text::int, t.n,
  t.n || ' rows in ' || t.name) from (values ('lk_category', 9), ('lk_sub_type', 40), ('lk_colour_family', 18), ('lk_fit', 5), ('lk_material', 8),
  ('lk_pattern', 6), ('lk_season', 5), ('lk_occasion', 7), ('lk_size_system', 6), ('lk_condition_band', 5), ('colour_family_ref', 32)) as t(name, n);
-- WO-0098 (R7a) replaces "tables without taxonomy data are empty" with exact counts: lk_brand stays empty (the owner's list, O3), the others hold the R7 glossary values
select is((select count(*) from catalog.lk_brand)::text || '/' || (select count(*) from catalog.lk_size) || '/' || (select count(*) from catalog.lk_price_band)
  || '/' || (select count(*) from catalog.lk_region) || '/' || (select count(*) from catalog.country_region), '0/7/6/1/1', 'lk_brand is empty; lk_size, lk_price_band, lk_region and country_region hold exactly their taxonomy rows');

-- shape and order
select col_is_pk('catalog', 'lk_sub_type', array['category','code'], 'lk_sub_type key is (category, code)');
select results_eq($$ select category from catalog.lk_sub_type where code = 'Jeans' $$, array['Bottoms'], 'Jeans belongs to Bottoms');
select is_empty($$ select 1 from catalog.lk_sub_type where category = 'Bottoms' and code = 'T-shirt' $$, 'T-shirt is not a Bottoms sub-type');
select throws_ok($$ insert into catalog.lk_sub_type values ('Nope', 'X', 'X') $$, '23503', null, 'a sub-type needs an existing category');
select throws_ok($$ insert into catalog.lk_sub_type values ('Tops', 'Shirt', 'Shirt') $$, '23505', null, 'a sub-type code is unique within its category');
select is((select array_agg(code order by sort) from catalog.lk_category),
  array['Tops','Bottoms','Outerwear','Footwear','Accessories','Underwear and socks','Activewear','Ethnic wear','Occasion wear'], 'categories keep dictionary order');
select is_empty($$ select 1 from (select min_score, lag(max_score) over (order by sort) as prev from catalog.lk_condition_band) s
  where prev is not null and min_score <> prev + 1 $$, 'condition bands are contiguous');
select is((select min(min_score)::int || '-' || max(max_score)::int from catalog.lk_condition_band), '0-100', 'condition bands cover 0 to 100');

-- access (LLD 4.1, 4.5): signed-in users read, nobody writes through the API, anon sees nothing
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'catalog'::regnamespace and c.relkind = 'r'
  and (c.relname like 'lk\_%' or c.relname in ('country_region','colour_family_ref'))
  and not (c.relrowsecurity and c.relforcerowsecurity) $$, 'RLS is enabled and forced on every lookup table');
select is_empty($$ select c.relname from pg_class c where c.relnamespace = 'catalog'::regnamespace and c.relkind = 'r'
  and (c.relname like 'lk\_%' or c.relname in ('country_region','colour_family_ref'))
  and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'insert,update,delete')) $$,
  'anon has no privilege on a lookup table and signed-in users only select');
select ok(has_schema_privilege('anon', 'app', 'usage'), 'anon has usage on app');
select ok(not has_schema_privilege('anon', 'catalog', 'usage'), 'anon has no usage on catalog');
select ok(not has_schema_privilege('authenticated', 'ops', 'usage') and not has_schema_privilege('service_role', 'ops', 'usage'), 'no usage on ops');
-- WO-0098 (R7a) replaces "no usage on analytics or analytics_private" with the grant matrix: usage on analytics for authenticated only, none on analytics_private for anyone
select ok(has_schema_privilege('authenticated', 'analytics', 'usage') and not has_schema_privilege('anon', 'analytics', 'usage') and has_schema_privilege('service_role', 'analytics', 'usage')   -- WO-0102: service_role for build_report only
  and not has_schema_privilege('anon', 'analytics_private', 'usage') and not has_schema_privilege('authenticated', 'analytics_private', 'usage') and not has_schema_privilege('service_role', 'analytics_private', 'usage')
  and not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname in ('analytics', 'analytics_private') and a.grantee = 0),
  'usage on analytics for authenticated and service_role only (WO-0102: build_report); no usage on analytics_private for anon, authenticated, service_role or public');
select ok(not has_function_privilege('anon', 'catalog.colour_family(int,int,int)', 'execute')
  and has_function_privilege('authenticated', 'catalog.colour_family(int,int,int)', 'execute'), 'colour_family is executable by signed-in users only');

set local role anon;
select throws_ok($$ select * from catalog.lk_category $$, '42501', null, 'anon cannot read lookups');
reset role;
set local role authenticated;
select is((select count(*) from catalog.lk_category), 9::bigint, 'a signed-in user reads the lookups');
select is((select count(*) from catalog.colour_family_ref), 32::bigint, 'a signed-in user reads the swatches');
select throws_ok($$ insert into catalog.lk_fit (code, label) values ('Baggy', 'Baggy') $$, '42501', null, 'a signed-in user cannot insert a lookup row');
select throws_ok($$ update catalog.lk_fit set label = 'x' $$, '42501', null, 'a signed-in user cannot update a lookup row');
select throws_ok($$ delete from catalog.lk_fit $$, '42501', null, 'a signed-in user cannot delete a lookup row');
select throws_ok($$ update catalog.colour_family_ref set family = 'Red' $$, '42501', null, 'a signed-in user cannot change a swatch');
reset role;
select is((select count(*) from catalog.lk_fit), 5::bigint, 'lookup data unchanged after the refused writes');

select * from finish();
rollback;
