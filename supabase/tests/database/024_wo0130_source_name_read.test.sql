-- WO-0130 part (4): a consumer reads id and name of a source with an active catalogue item, and no other column; a source with no active item is invisible; anon reads nothing.
-- u1 eligible consumer, u2 consumer without consent. Synthetic and rolled back.
begin;
\ir helpers.inc
select plan(14);

create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('01300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $f$;
select pg_temp.mk_user(pg_temp.u(n)) from generate_series(1, 2) n;
select pg_temp.make_eligible(pg_temp.u(1));

insert into catalog.sources (id, name, site_url, robots_allowed, terms_note, allowed, checked_on) values
  (-301, 'Zor Active Source', 'https://active.example.test/', true, 'terms', true, current_date),
  (-302, 'Zor Review Only Source', 'https://review.example.test/', true, 'terms', true, current_date),
  (-303, 'Zor Empty Source', 'https://empty.example.test/', true, 'terms', true, current_date);
insert into catalog.catalog_items (source_id, sku, name, category, sub_type, colour_r, colour_g, colour_b, product_url, status) values
  (-301, 'Z-1', 'Zor tee', 'Tops', 'Shirt', 0, 0, 139, 'https://active.example.test/p/1', 'active'),
  (-302, 'Z-2', 'Zor shirt', null, null, 0, 0, 139, 'https://review.example.test/p/2', 'review');

select is((select array_agg(policyname || ':' || cmd || ':' || roles::text order by policyname) from pg_policies where schemaname = 'catalog' and tablename = 'sources' and 'authenticated' = any (roles)),
  array['sources_consumer_name_select:SELECT:{authenticated}'], 'authenticated has exactly one policy on catalog.sources: select');
select is((select string_agg(c, ',' order by c) from unnest(array['id', 'name', 'site_url', 'robots_allowed', 'terms_note', 'allowed', 'checked_on', 'contact', 'last_collected_at', 'takedown_at', 'takedown_note']) c where has_column_privilege('authenticated', 'catalog.sources', c, 'select')), 'id,name', 'authenticated may select id and name only');
select ok(not has_table_privilege('authenticated', 'catalog.sources', 'select') and not has_any_column_privilege('authenticated', 'catalog.sources', 'insert,update,references') and not has_table_privilege('authenticated', 'catalog.sources', 'delete,truncate,trigger'), 'authenticated has no table-wide select and no write grant on catalog.sources');
select ok(not has_any_column_privilege('anon', 'catalog.sources', 'select,insert,update,references') and not has_table_privilege('anon', 'catalog.sources', 'delete,truncate,trigger'), 'anon has no privilege on catalog.sources');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select id || '':'' || name from catalog.sources where id = -301'), '-301:Zor Active Source', 'a consumer reads id and name of a source with an active item');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from catalog.sources where id in (-301, -302, -303)'), '1', 'and sees no source without an active item (review only, or no items)');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select count(*) from catalog.sources where id = -302'), '0', 'a source whose only item is in review is invisible');
select is(pg_temp.val_as(pg_temp.u(2), 'authenticated', 'select count(*) from catalog.sources where id = -301'), '0', 'a consumer without consent sees no source (it sees no active catalogue row either)');
select is(pg_temp.val_as(pg_temp.u(1), 'authenticated', 'select s.name from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where i.sku = ''Z-1'''), 'Zor Active Source', 'the name reaches the catalogue read through the foreign key');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select site_url from catalog.sources'), 'err=42501', 'site_url is unreadable');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select takedown_note, terms_note, contact from catalog.sources'), 'err=42501', 'the notes, contact and take-down fields are unreadable');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'select * from catalog.sources'), 'err=42501', 'select * is refused (it names the other columns)');
select is(pg_temp.run_as(pg_temp.u(1), 'authenticated', 'update catalog.sources set name = ''x'''), 'err=42501', 'a consumer can not rename a source');
select is(pg_temp.run_as(null, 'anon', 'select id, name from catalog.sources'), 'err=42501', 'anon reads nothing');

select * from finish();
rollback;
