-- WO-0083 (R6b) / CC5: catalogue tables, consumer visibility, take-down, audit log, collector_role and the worker's read of the catalogue.
-- Users: A, B eligible consumers; C no consent; D vendor; E admin. Roles are exercised inside this rolled-back transaction. Rows are keyed by their own
-- fixture ids and sources, so the file does not depend on what else the local catalogue holds (for example the demo seed).
begin;
\ir helpers.inc
select plan(186);

grant collector_role to postgres with set true, inherit false;
grant worker_role to postgres with set true, inherit false;
select pg_temp.mk_user(u) from unnest(array[pg_temp.ua(), pg_temp.ub(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[]) u;
select pg_temp.make_eligible(u) from unnest(array[pg_temp.ua(), pg_temp.ub()]::uuid[]) u;
update app.profiles set role = 'vendor' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
update app.profiles set role = 'admin' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return 'err=' || sqlstate; end $f$;
create temp table s (n int primary key, id int);
insert into s (n, id) select 1, id from (select nextval('catalog.sources_id_seq') id) q union all select 2, nextval('catalog.sources_id_seq');
insert into catalog.sources (id, name, site_url, robots_allowed, terms_note, allowed, checked_on)
  select id, 'S' || n, 'https://shop' || n || '.example.test/', true, 'terms read', n = 1, current_date from s;
insert into catalog.vendors (id, name) values ('a0000000-0000-0000-0000-000000000001', 'Vendor One');
create function pg_temp.sid(p_n int) returns int language sql as $f$ select id from s where n = p_n $f$;
-- a catalogue row: active rows carry a category and sub-type; the colour is the same dark blue everywhere
create function pg_temp.ci(p_n int, p_src int, p_vendor uuid, p_status text, p_name text) returns uuid language plpgsql as $f$
declare i uuid := ('c0000000-0000-0000-0000-00000000000' || p_n)::uuid;
begin
  insert into catalog.catalog_items (id, source_id, vendor_id, sku, name, brand, category, sub_type, colour_r, colour_g, colour_b, product_url, status)
  values (i, p_src, p_vendor, 'T-' || p_n, p_name, 'Zorvane', case when p_status = 'review' then null else 'Tops' end, case when p_status = 'review' then null else 'Shirt' end,
          0, 0, 139, 'https://shop.example.test/p/' || p_n, p_status);
  return i;
end $f$;
select pg_temp.ci(1, pg_temp.sid(1), null, 'active', 'Linen shirt');
select pg_temp.ci(2, pg_temp.sid(1), null, 'review', 'Linen shirt');
select pg_temp.ci(3, pg_temp.sid(1), null, 'withdrawn', 'Linen shirt');
select pg_temp.ci(4, null, 'a0000000-0000-0000-0000-000000000001', 'active', 'Vendor jacket');
select pg_temp.ci(5, pg_temp.sid(2), null, 'active', 'Denim jeans');
create function pg_temp.vis(p_uid uuid, p_role text, p_where text) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, p_role, 'select count(*) from catalog.catalog_items where sku like ''T-%'' and ' || p_where) $f$;

-- ======== 1. shape ======================================================================================================================
select is((select array_agg(c::text order by c) from (select relname c from pg_class where relnamespace = 'catalog'::regnamespace and relkind = 'r' and relname !~ '^lk_|^colour_family_ref$|^country_region$') q),
  array['catalog_items', 'sources', 'vendor_agreement_acceptances', 'vendor_members', 'vendors'], 'the catalog schema holds the four R6b tables and the WO-0100 acceptances table next to the lookups');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'catalog' and table_name = 'sources'),
  array['id','name','site_url','robots_allowed','terms_note','allowed','checked_on','contact','last_collected_at','takedown_at','takedown_note'], 'sources has the LLD 4.8 columns');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'catalog' and table_name = 'catalog_items'),
  array['id','source_id','vendor_id','sku','name','brand','gtin','category','sub_type','colour_r','colour_g','colour_b','colour_hex','colour_family','is_multicolour','secondary_colour_hex',
        'fit','material','pattern','sizes_available','price','currency','seasons','occasions','product_url','collected_at','missed_runs','status'], 'catalog_items has the LLD 4.8 columns');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid = any (array['catalog.sources'::regclass, 'catalog.vendors'::regclass, 'catalog.vendor_members'::regclass, 'catalog.catalog_items'::regclass, 'catalog.vendor_agreement_acceptances'::regclass, 'ops.admin_audit_log'::regclass])),
  'RLS is enabled and forced on every new table');
select is((select string_agg(conrelid::regclass || ':' || confdeltype::text || convalidated::text, ',' order by conrelid::regclass::text) from pg_constraint where confrelid = 'catalog.catalog_items'::regclass),
  'app.items:ntrue,app.wishlist_entries:ntrue', 'items and wishlist_entries point at catalog_items, validated, on delete set null');
select is((select string_agg(confrelid::regclass || ':' || confdeltype::text, ',' order by confrelid::regclass::text) from pg_constraint where conrelid = 'catalog.catalog_items'::regclass and contype = 'f'),
  'catalog.sources:c,catalog.vendors:c', 'catalog_items cascades from its source and its vendor');
select ok(exists (select 1 from pg_indexes where schemaname = 'catalog' and tablename = 'catalog_items' and indexdef ~ 'USING gin \(name gin_trgm_ops\)'), 'index: trigram on name');
select ok(exists (select 1 from pg_indexes where schemaname = 'catalog' and tablename = 'catalog_items' and indexdef ~ 'USING gin \(brand gin_trgm_ops\)'), 'index: trigram on brand');
select ok(exists (select 1 from pg_indexes where schemaname = 'catalog' and tablename = 'catalog_items' and indexdef ~ 'USING btree \(category, colour_family\)'), 'index: category and colour family');
select ok(exists (select 1 from pg_indexes where schemaname = 'catalog' and tablename = 'catalog_items' and indexdef ~ 'USING btree \(gtin\) WHERE \(gtin IS NOT NULL\)'), 'index: gtin, partial where not null');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'catalog.catalog_items'::regclass and contype = 'u'), 'UNIQUE NULLS NOT DISTINCT (source_id, vendor_id, sku)', 'the unique key treats nulls as equal');
select is(pg_temp.try(format('insert into catalog.catalog_items (source_id, sku, name, product_url, status) values (%s, %L, %L, %L, ''review'')', pg_temp.sid(1), 'T-1', 'again', 'https://x.example.test/')), 'err=23505', 'a second row with the same source and sku is refused');
select is(pg_temp.try(format('insert into catalog.catalog_items (source_id, sku, name, product_url, status) values (%s, %L, %L, %L, %L)', pg_temp.sid(1), 'T-new', 'ok', 'https://x.example.test/', 'review')), 'ok', 'a new sku is accepted');
select is(pg_temp.try(format('insert into catalog.catalog_items (source_id, sku, name, product_url, status) values (%s, %L, %L, %L, %L)', pg_temp.sid(2), 'T-1', 'ok', 'https://x.example.test/', 'review')), 'ok', 'the same sku at another source is accepted');
select is(pg_temp.try('insert into catalog.catalog_items (vendor_id, sku, name, product_url, status) values (''a0000000-0000-0000-0000-000000000001'', ''T-1'', ''dup'', ''https://x.example.test/'', ''review'')'), 'ok', 'a vendor row with that sku is accepted (a different key)');
select is(pg_temp.try('insert into catalog.catalog_items (vendor_id, sku, name, product_url, status) values (''a0000000-0000-0000-0000-000000000001'', ''T-1'', ''dup'', ''https://x.example.test/'', ''review'')'), 'err=23505', 'but not twice for the same vendor');

create temp table ck (n int, label text, st text, cols text, vals text, code text);
insert into ck values
  (1, 'a 13-digit gtin', 'review', 'gtin', '''2900000000000''', 'err=23514'), (2, 'a gtin with letters', 'review', 'gtin', '''0290000000000a''', 'err=23514'), (3, 'a 14-digit gtin', 'review', 'gtin', '''02900000000013''', 'ok'),
  (4, 'no gtin', 'review', 'gtin', 'null', 'ok'), (5, 'an unknown status', 'hidden', 'brand', '''b''', 'err=23514'), (6, 'an active row without a category', 'active', 'brand', '''b''', 'err=23514'),
  (7, 'a colour channel of 256', 'review', 'colour_r', '256', 'err=23514'), (8, 'a negative colour channel', 'review', 'colour_g', '-1', 'err=23514'), (9, 'a negative price', 'review', 'price', '-1', 'err=23514'),
  (10, 'a NaN price', 'review', 'price', '''NaN''', 'err=23514'), (11, 'an infinite price', 'review', 'price', '''Infinity''', 'err=22003'), (12, 'a price of zero', 'review', 'price', '0', 'ok'),
  (13, 'a secondary colour that is not a hex code', 'review', 'secondary_colour_hex', '''blue''', 'err=23514'), (14, 'a malformed secondary hex code', 'review', 'secondary_colour_hex', '''#12345G''', 'err=23514'),
  (15, 'a valid secondary hex code', 'review', 'secondary_colour_hex', '''#1A2b3C''', 'ok');
select is(pg_temp.try(format('insert into catalog.catalog_items (source_id, sku, name, product_url, status, %s) values (%s, %L, %L, %L, %L, %s)', cols, pg_temp.sid(1), 'ck' || n, 'x', 'https://x.example.test/', st, vals)), code, 'catalog_items: ' || label) from ck order by n;
select is(pg_temp.try(format('insert into catalog.catalog_items (source_id, vendor_id, sku, name, product_url, status) values (%s, %L, %L, %L, %L, %L)', pg_temp.sid(1), 'a0000000-0000-0000-0000-000000000001', 'both', 'x', 'https://x.example.test/', 'review')), 'err=23514', 'a row with both a source and a vendor is refused');
select is(pg_temp.try('insert into catalog.catalog_items (sku, name, product_url, status) values (''none'', ''x'', ''https://x.example.test/'', ''review'')'), 'err=23514', 'a row with neither is refused');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, checked_on) values (''Z'', ''ftp://x'', true, ''t'', current_date)'), 'err=23514', 'a source site must be an http(s) address');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, checked_on) values (''Z'', ''https://z.example.test/'', false, ''t'', current_date)'), 'ok', 'a source can be registered without being allowed');
select is((select allowed from catalog.sources where name = 'Z'), false, 'and allowed defaults to false');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values (''Z2'', ''https://z.example.test/'', false, ''t'', true, current_date)'), 'err=23514', 'allowed needs robots_allowed (policy section 4)');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values (''Z2'', ''https://z.example.test/'', true, '' '', true, current_date)'), 'err=23514', 'allowed needs a terms note');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on, takedown_at) values (''Z2'', ''https://z.example.test/'', true, ''t'', true, current_date, now())'), 'err=23514', 'a source that was taken down cannot be allowed');
select is(pg_temp.try('insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on) values (''Z2'', ''https://z.example.test/'', true, ''t'', true, current_date)'), 'ok', 'a fully recorded source can be allowed');
select is(pg_temp.try(format('update catalog.sources set takedown_note = %L where id = %s', repeat('n', 501), pg_temp.sid(2))), 'err=23514', 'a takedown note over 500 characters is refused');

-- ======== 2. the colour trigger ==========================================================================================================
select is((select colour_hex || '/' || colour_family from catalog.catalog_items where id = 'c0000000-0000-0000-0000-000000000001'), '#00008B/Navy', 'the trigger derives the hex code and the family (golden vector #00008B is Navy)');
select pg_temp.ci(6, pg_temp.sid(2), null, 'review', 'Mixed');
select is((select colour_hex || '/' || colour_family from catalog.catalog_items where id = 'c0000000-0000-0000-0000-000000000006'), '#00008B/Navy', 'also for a review row that has a colour');
update catalog.catalog_items set is_multicolour = true where id = 'c0000000-0000-0000-0000-000000000006';
select is((select colour_family from catalog.catalog_items where id = 'c0000000-0000-0000-0000-000000000006'), 'Multi', 'is_multicolour gives Multi');
update catalog.catalog_items set is_multicolour = false, colour_r = null, colour_g = null, colour_b = null where id = 'c0000000-0000-0000-0000-000000000006';
select is((select coalesce(colour_hex, 'null') || '/' || coalesce(colour_family, 'null') from catalog.catalog_items where id = 'c0000000-0000-0000-0000-000000000006'), 'null/null', 'null RGB gives a null hex code and family (a row held for review)');
update catalog.catalog_items set colour_r = 255, colour_g = 255, colour_b = 255, colour_hex = '#000000', colour_family = 'Red' where id = 'c0000000-0000-0000-0000-000000000006';
select is((select colour_hex || '/' || colour_family from catalog.catalog_items where id = 'c0000000-0000-0000-0000-000000000006'), '#FFFFFF/White', 'a supplied hex code or family is overwritten on update');
select is(pg_temp.val_as(null, 'service_role', format('insert into catalog.catalog_items (source_id, sku, name, product_url, status, colour_r, colour_g, colour_b, colour_hex, colour_family) values (%s, ''T-sr'', ''x'', ''https://x.example.test/'', ''review'', 0, 0, 0, ''#FFFFFF'', ''Red'') returning colour_family', pg_temp.sid(1))), 'Black', 'and on insert, also for service_role');

-- ======== 3. what consumers see ==========================================================================================================
select is(pg_temp.vis(pg_temp.ua(), 'authenticated', 'true'), '3', 'consumer A sees exactly the three active rows (two from sources, one from a vendor)');
select is(pg_temp.vis(pg_temp.ua(), 'authenticated', 'status <> ''active'''), '0', 'and never a review or withdrawn row');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select string_agg(sku, '','' order by sku) from catalog.catalog_items where sku like ''T-%'''), 'T-1,T-4,T-5', 'namely T-1, T-4 and T-5');
select is(pg_temp.vis(pg_temp.ub(), 'authenticated', 'true'), '3', 'consumer B sees the same');
select is(pg_temp.vis('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', 'true'), '0', 'a signed-in user without consent sees no catalogue rows');
select is(pg_temp.vis('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', 'true'), '0', 'a vendor sees none through the consumer policy');
select is(pg_temp.vis('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'true'), '0', 'an admin sees none through the consumer policy');
select is(pg_temp.run_as(null, 'anon', 'select 1 from catalog.catalog_items'), 'err=42501', 'anon cannot read the catalogue');
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.vis(pg_temp.ua(), 'authenticated', 'true'), '0', 'maintenance mode hides the catalogue from consumers');
update ops.settings set value = 'off' where key = 'maintenance';
select ok(has_table_privilege('authenticated', 'catalog.catalog_items', 'select') and not has_table_privilege('authenticated', 'catalog.catalog_items', 'insert,update,delete,truncate,references,trigger'), 'authenticated: select only on catalog_items');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'catalog' and tablename = 'catalog_items' and roles = array['authenticated']::name[]),
  array['catalog_items_consumer_select:SELECT'], 'one policy for authenticated: select');
select ok((select qual ~ 'active' and qual ~ 'current_role' and qual ~ 'has_consent' from pg_policies where policyname = 'catalog_items_consumer_select'), 'the policy checks active, consumer and consent');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'insert into catalog.catalog_items (source_id, sku, name, product_url) values (1, ''x'', ''x'', ''https://x.example.test/'')'), 'err=42501', 'a consumer cannot insert catalogue rows');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'update catalog.catalog_items set name = ''x'''), 'err=42501', 'nor update them');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'delete from catalog.catalog_items'), 'err=42501', 'nor delete them');
select is(pg_temp.run_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'delete from catalog.catalog_items'), 'err=42501', 'an admin cannot delete them directly either (take-down is the route)');

-- ======== 4. no client grants on sources, vendors, members and the audit log ============================================================
select ok(not has_any_column_privilege(r, t, 'select,insert,update,references') and not has_table_privilege(r, t, 'delete,truncate,trigger'), r || ' has no privilege on ' || t)
  from unnest(array['anon', 'authenticated']) r, unnest(array['catalog.sources', 'ops.admin_audit_log']) t;
-- WO-0112 replaces "authenticated has no privilege on catalog.vendors": anon still has none; authenticated has select on (id, name) only (own vendor by policy, 021 tests it)
select ok(not has_any_column_privilege('anon', 'catalog.vendors', 'select,insert,update,references') and not has_table_privilege('anon', 'catalog.vendors', 'delete,truncate,trigger'), 'anon has no privilege on catalog.vendors');
select ok(not has_any_column_privilege('authenticated', 'catalog.vendors', 'insert,update,references') and not has_table_privilege('authenticated', 'catalog.vendors', 'delete,truncate,trigger') and not has_table_privilege('authenticated', 'catalog.vendors', 'select')
  and has_column_privilege('authenticated', 'catalog.vendors', 'id', 'select') and has_column_privilege('authenticated', 'catalog.vendors', 'name', 'select') and not has_column_privilege('authenticated', 'catalog.vendors', 'created_at', 'select'), 'authenticated may select catalog.vendors (id, name) only: no created_at, no write');
-- WO-0100 (R7a) replaces "authenticated has no privilege on catalog.vendor_members": anon still has none; authenticated has select only (own rows by policy, 017 tests it)
select ok(not has_any_column_privilege('anon', 'catalog.vendor_members', 'select,insert,update,references') and not has_table_privilege('anon', 'catalog.vendor_members', 'delete,truncate,trigger'), 'anon has no privilege on catalog.vendor_members');
select ok(has_table_privilege('authenticated', 'catalog.vendor_members', 'select') and not has_any_column_privilege('authenticated', 'catalog.vendor_members', 'insert,update,references') and not has_table_privilege('authenticated', 'catalog.vendor_members', 'delete,truncate,trigger'), 'authenticated has select and nothing else on catalog.vendor_members');
select ok(has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert') and has_table_privilege('service_role', t, 'update') and has_table_privilege('service_role', t, 'delete'),
  'service_role holds select, insert, update and delete on ' || t) from unnest(array['catalog.sources', 'catalog.vendors', 'catalog.vendor_members', 'catalog.catalog_items']) t;
select ok(not has_any_column_privilege('service_role', 'ops.admin_audit_log', 'select,insert,update,references') and not has_table_privilege('service_role', 'ops.admin_audit_log', 'delete,truncate'), 'service_role has nothing on ops.admin_audit_log (LLD 4.1: ops is reached through functions)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from catalog.sources'), 'err=42501', 'a consumer cannot read the source register');
select is(pg_temp.run_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'select 1 from catalog.sources'), 'err=42501', 'nor can an admin through the client role');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from catalog.vendors'), 'rows=0', 'a consumer sees no vendor row (WO-0112: the select policy shows a member its own vendor only)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from catalog.vendor_members'), 'rows=0', 'a consumer sees no vendor member row (WO-0100: the select policy shows each user their own rows only)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from ops.admin_audit_log'), 'err=42501', 'nor the audit log');
select is(pg_temp.run_as(null, 'anon', 'select 1 from catalog.sources'), 'err=42501', 'anon cannot read sources');

-- ======== 5. the audit log ===============================================================================================================
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'ops' and table_name = 'admin_audit_log'), array['id','admin_id','action','target','at'], 'admin_audit_log has the LLD 6 columns');
select ok((select is_identity = 'YES' and identity_generation = 'ALWAYS' from information_schema.columns where table_schema = 'ops' and table_name = 'admin_audit_log' and column_name = 'id'), 'its id is generated always as identity');
create temp table au (n int, label text, act text, tgt text, code text);
insert into au values
  (1, 'a row id', 'source.takedown', '7', 'ok'), (2, 'a uuid target', 'vendor.end', 'a0000000-0000-0000-0000-000000000001', 'ok'), (3, 'a count', 'invitation.add', '+3', 'ok'), (4, 'no target', 'settings.update', null, 'ok'),
  (5, 'an e-mail address as target', 'source.takedown', 'someone@example.test', 'err=23514'), (6, 'free text as target', 'source.takedown', 'too many sources here', 'err=23514'),
  (7, 'a target of 65 characters', 'source.takedown', repeat('a', 65), 'err=23514'), (8, 'an upper-case action', 'Source.Takedown', '7', 'err=23514'), (9, 'an action with a space', 'source takedown', '7', 'err=23514'),
  (10, 'an empty action', '', '7', 'err=23514');
select is(pg_temp.try(format('insert into ops.admin_audit_log (admin_id, action, target) values (%L, %L, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', act, tgt)), code, 'audit log: ' || label) from au order by n;
select is(pg_temp.try('insert into ops.admin_audit_log (admin_id, action) values (null, ''x'')'), 'err=23502', 'an audit row needs an admin id');
select is(pg_temp.try('insert into ops.admin_audit_log (id, admin_id, action) values (99, ''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'', ''x'')'), 'err=428C9', 'the id cannot be chosen');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'insert into ops.admin_audit_log (admin_id, action) values (null, ''x'')'), 'err=42501', 'a client cannot write the audit log');
select ok((select at between now() - interval '1 minute' and now() + interval '1 minute' from ops.admin_audit_log order by id limit 1), 'its time defaults to now()');

-- ======== 6. take-down ===================================================================================================================
-- A has an item and a wishlist entry linked to T-1 (source 1); B has an item linked to T-5 (source 2)
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, catalog_item_id, brand)
  values (pg_temp.oid('item', pg_temp.ua(), 50), pg_temp.ua(), 'My linen shirt', 'Tops', 'Shirt', 0, 0, 139, 'catalogue', 'c0000000-0000-0000-0000-000000000001', 'Zorvane'),
         (pg_temp.oid('item', pg_temp.ub(), 50), pg_temp.ub(), 'B jeans', 'Bottoms', 'Jeans', 1, 2, 3, 'catalogue', 'c0000000-0000-0000-0000-000000000005', 'Zorvane');
insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, catalog_item_id)
  values (pg_temp.oid('wish', pg_temp.ua(), 50), pg_temp.ua(), 'Linen shirt wish', 'Tops', 'Shirt', 0, 0, 139, 'c0000000-0000-0000-0000-000000000001');
create temp table before_td as select i.name, i.category, i.sub_type, i.colour_hex, i.colour_family, i.brand, i.origin, i.status from app.items i where i.id = pg_temp.oid('item', pg_temp.ua(), 50);
create temp table cnt as select (select count(*) from catalog.catalog_items where source_id = pg_temp.sid(1)) n1, (select count(*) from catalog.catalog_items where source_id = pg_temp.sid(2)) n2;
create function pg_temp.td(p_uid uuid, p_role text, p_src int, p_note text) returns text language sql as
  $f$ select pg_temp.val_as(p_uid, p_role, format('select catalog.take_down_source(%s, %L)', p_src, p_note)) $f$;
create function pg_temp.src_state(p_src int) returns text language sql as
  $f$ select allowed || '/' || (takedown_at is not null) || '/' || coalesce(takedown_note, '-') || '/' || (select count(*) from catalog.catalog_items where source_id = p_src) from catalog.sources where id = p_src $f$;
select is(pg_temp.src_state(pg_temp.sid(1)), 'true/false/-/' || (select n1 from cnt), 'before: source 1 is allowed, not taken down, and holds its rows');
select cmp_ok((select n1 from cnt), '>=', 8::bigint, 'and that is more than the three fixtures (the check is not vacuous)');
select is(pg_temp.td(pg_temp.ua(), 'authenticated', pg_temp.sid(1), 'x'), 'err=42501: forbidden', 'a consumer cannot take a source down');
select is(pg_temp.td('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', pg_temp.sid(1), 'x'), 'err=42501: forbidden', 'a vendor cannot');
select is(pg_temp.td(gen_random_uuid(), 'authenticated', pg_temp.sid(1), 'x'), 'err=42501: forbidden', 'a signed-in user with no profile cannot');
select is(pg_temp.td(null, 'anon', pg_temp.sid(1), 'x'), 'err=42501: permission denied for schema catalog', 'anon cannot even call it');
select is(pg_temp.td(null, 'service_role', pg_temp.sid(1), 'x'), 'err=42501: permission denied for function take_down_source', 'the secret-key client cannot call it without an admin session');
select is(pg_temp.src_state(pg_temp.sid(1)), 'true/false/-/' || (select n1 from cnt), 'after those refusals nothing changed');
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 0, 'x'), 'err=P0002: source_not_found', 'an unknown source raises source_not_found');
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.sid(1), repeat('n', 501)), 'err=22023: invalid_note', 'a note over 500 characters raises invalid_note');
select is(pg_temp.src_state(pg_temp.sid(1)), 'true/false/-/' || (select n1 from cnt), 'and neither changed anything');
-- all or nothing: a failing delete rolls the source update back
create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'boom'; end $f$;
create trigger boom before delete on catalog.catalog_items for each row execute function pg_temp.boom();
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.sid(1), 'x'), 'err=P0001: boom', 'a failing delete makes the call fail');
select is(pg_temp.src_state(pg_temp.sid(1)), 'true/false/-/' || (select n1 from cnt), 'and the source is untouched: one transaction');
drop trigger boom on catalog.catalog_items;
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.sid(1), 'owner asked'), (select n1::text from cnt), 'the admin takes source 1 down and is told how many catalogue rows were deleted');
select is(pg_temp.src_state(pg_temp.sid(1)), 'false/true/owner asked/0', 'the source row is kept: allowed false, takedown_at and the note set, no items left');
select is((select count(*) from catalog.sources where id = pg_temp.sid(1)), 1::bigint, 'the source row is still in the register');
select is((select count(*) from catalog.catalog_items where id in ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000005')), 2::bigint, 'another source''s rows and the vendor''s row are untouched');
select is(pg_temp.src_state(pg_temp.sid(2)), 'false/false/-/' || (select n2 from cnt), 'source 2 is untouched');
select is((select row(i.name, i.category, i.sub_type, i.colour_hex, i.colour_family, i.brand, i.origin, i.status)::text from app.items i where i.id = pg_temp.oid('item', pg_temp.ua(), 50)),
  (select row(name, category, sub_type, colour_hex, colour_family, brand, origin, status)::text from before_td), 'A''s item keeps every attribute after the take-down');
select is((select catalog_item_id::text from app.items where id = pg_temp.oid('item', pg_temp.ua(), 50)), null, 'and loses only the catalogue link');
select is((select name || '/' || sub_type || '/' || coalesce(catalog_item_id::text, '-') from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 50)), 'Linen shirt wish/Shirt/-', 'A''s wishlist entry keeps its attributes and loses the link too');
select is((select catalog_item_id::text from app.items where id = pg_temp.oid('item', pg_temp.ub(), 50)), 'c0000000-0000-0000-0000-000000000005', 'B''s item, linked to another source, keeps its link');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select count(*) from app.items where id = ''' || pg_temp.oid('item', pg_temp.ua(), 50) || ''''), '1', 'and A still sees the item through RLS');
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.sid(2), null), (select n2::text from cnt), 'a null note is accepted; source 2 loses its rows');
select is(pg_temp.src_state(pg_temp.sid(2)), 'false/true/-/0', 'with the note left empty');
select is(pg_temp.td('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.sid(2), 'again'), '0', 'a second take-down is harmless and deletes nothing');
select ok(p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('worker_role', p.oid, 'execute') and not has_function_privilege('collector_role', p.oid, 'execute'),
  'take_down_source is security definer, pins search_path, and only authenticated may execute it') from pg_proc p where p.oid = 'catalog.take_down_source(int, text)'::regprocedure;
select is(pg_temp.try(format('update catalog.sources set allowed = true where id = %s', pg_temp.sid(2))), 'err=23514', 'a source that was taken down cannot be switched back to allowed');

-- ======== 7. collector_role ==============================================================================================================
select ok((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit and rolcanlogin and rolconnlimit = 3 from pg_roles where rolname = 'collector_role'),
  'collector_role: login, connection limit 3, and no superuser, createdb, createrole, replication, bypassrls or inherit');
select ok((select rolconfig @> array['statement_timeout=60s', 'idle_in_transaction_session_timeout=60s'] from pg_roles where rolname = 'collector_role'), 'it has statement and idle-in-transaction timeouts');
select is((select count(*) from pg_auth_members where member = 'collector_role'::regrole), 0::bigint, 'collector_role is a member of no role');
select is((select count(*) from pg_auth_members where roleid = 'collector_role'::regrole and member <> 'postgres'::regrole), 0::bigint, 'no role other than its creator is a member of collector_role');
select ok(not pg_has_role('authenticator', 'collector_role', 'member') and not pg_has_role('authenticated', 'collector_role', 'member') and not pg_has_role('service_role', 'collector_role', 'member')
  and not pg_has_role('anon', 'collector_role', 'member') and not pg_has_role('worker_role', 'collector_role', 'member'), 'the API roles and worker_role cannot become collector_role');
select is((select array_agg(nspname::text order by nspname) from pg_namespace where has_schema_privilege('collector_role', oid, 'usage') and nspname not like 'pg\_%' and nspname <> 'information_schema'),
  array['catalog', 'public'], 'usage on catalog only (public is open to everyone and holds no application table)');
select is_empty($$ select nspname from pg_namespace where has_schema_privilege('collector_role', oid, 'create') and nspname not like 'pg\_temp\_%' $$, 'create on no schema');
create temp table cr as
  select n.nspname || '.' || c.relname as rel, c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp\_%' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_schema_privilege('collector_role', n.oid, 'usage') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    and (has_any_column_privilege('collector_role', c.oid, 'select,insert,update,references') or has_table_privilege('collector_role', c.oid, 'delete,truncate,trigger'));
select is((select array_agg(rel order by rel) from cr where rel not like 'catalog.lk\_%'), array['catalog.catalog_items', 'catalog.colour_family_ref', 'catalog.sources'], 'the collector touches sources, catalog_items, colour_family_ref and the lookups, no other table');
select is((select count(*) from cr where rel like 'catalog.lk\_%'), (select count(*) from pg_class where relnamespace = 'catalog'::regnamespace and relkind = 'r' and relname like 'lk\_%'), 'select on every catalog.lk_* table');
select is_empty($$ select rel from cr where (rel like 'catalog.lk\_%' or rel = 'catalog.colour_family_ref') and (has_any_column_privilege('collector_role', oid, 'insert,update,references') or has_table_privilege('collector_role', oid, 'delete,truncate,trigger') or not has_table_privilege('collector_role', oid, 'select')) $$, 'select only on the lookups and the swatch table');
select ok(has_table_privilege('collector_role', 'catalog.sources', 'select') and not has_table_privilege('collector_role', 'catalog.sources', 'insert,update,delete,truncate,references,trigger'), 'sources: table-level select only');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'catalog.sources'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('collector_role', 'catalog.sources', a.attname, 'update')),
  array['last_collected_at'], 'sources: update of last_collected_at only');
select ok(has_table_privilege('collector_role', 'catalog.catalog_items', 'select') and has_table_privilege('collector_role', 'catalog.catalog_items', 'insert') and has_table_privilege('collector_role', 'catalog.catalog_items', 'update')
  and not has_table_privilege('collector_role', 'catalog.catalog_items', 'delete,truncate,references,trigger'), 'catalog_items: select, insert, update; no delete');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where roles = array['collector_role']::name[] and tablename not like 'lk\_%'),
  array['catalog_items_collector_insert:INSERT', 'catalog_items_collector_select:SELECT', 'catalog_items_collector_update:UPDATE', 'colour_family_ref_collector_read:SELECT', 'sources_collector_select:SELECT', 'sources_collector_update:UPDATE'], 'exactly the documented policies');
select is((select count(*) from pg_policies where roles = array['collector_role']::name[] and schemaname = 'catalog' and tablename like 'lk\_%' and cmd = 'SELECT' and qual = 'true'), (select count(*) from cr where rel like 'catalog.lk\_%'), 'and one select policy per lookup');
select is((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app', 'ops', 'catalog') and has_function_privilege('collector_role', p.oid, 'execute')),
  array['catalog.colour_family(integer,integer,integer)', 'catalog.rgb_hex(integer,integer,integer)', 'catalog.rgb_to_lab(integer,integer,integer)', 'catalog.srgb_lin(double precision)'], 'the collector can execute only the four colour functions its trigger needs');
select is((select count(*) from (select c.oid from pg_class c where c.relkind = 'S' and c.relnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') and c.relnamespace::regnamespace::text not like 'pg\_temp\_%' and has_schema_privilege('collector_role', c.relnamespace, 'usage') offset 0) q where has_sequence_privilege('collector_role', q.oid, 'usage,select,update')), 0::bigint, 'it has no privilege on any reachable sequence');
-- behaviour
select is(pg_temp.val_as(null, 'collector_role', 'select count(*) from catalog.sources where name in (''S1'', ''S2'')'), '2', 'the collector reads the source register');
select is(pg_temp.run_as(null, 'collector_role', format('update catalog.sources set last_collected_at = now() where id = %s', pg_temp.sid(1))), 'rows=1', 'it sets last_collected_at');
select is(pg_temp.run_as(null, 'collector_role', format('update catalog.sources set allowed = true where id = %s', pg_temp.sid(1))), 'err=42501', 'it cannot change allowed');
select is(pg_temp.run_as(null, 'collector_role', format('update catalog.sources set takedown_at = null where id = %s', pg_temp.sid(1))), 'err=42501', 'nor takedown_at');
select is(pg_temp.run_as(null, 'collector_role', 'insert into catalog.sources (name, site_url, robots_allowed, terms_note, checked_on) values (''Q'', ''https://q.example.test/'', true, ''t'', current_date)'), 'err=42501', 'it cannot insert a source');
select is(pg_temp.run_as(null, 'collector_role', 'delete from catalog.sources'), 'err=42501', 'nor delete one');
select is(pg_temp.run_as(null, 'collector_role', format('insert into catalog.catalog_items (source_id, sku, name, product_url, colour_r, colour_g, colour_b, status, category, sub_type) values (%s, ''C-1'', ''Fresh'', ''https://x.example.test/'', 0, 0, 139, ''active'', ''Tops'', ''Shirt'')', pg_temp.sid(1))), 'rows=1', 'it inserts a catalogue row for a source');
select is((select colour_hex || '/' || colour_family from catalog.catalog_items where sku = 'C-1'), '#00008B/Navy', 'and the colour trigger works for it (it can read the swatches)');
select is(pg_temp.run_as(null, 'collector_role', 'insert into catalog.catalog_items (vendor_id, sku, name, product_url, status) values (''a0000000-0000-0000-0000-000000000001'', ''C-2'', ''x'', ''https://x.example.test/'', ''review'')'), 'err=42501', 'it cannot insert a vendor row');
select is(pg_temp.run_as(null, 'collector_role', format('insert into catalog.catalog_items (source_id, sku, name, product_url, colour_r, colour_g, colour_b, status, category, sub_type) values (%s, ''C-1'', ''Renamed'', ''https://x.example.test/'', 0, 0, 139, ''active'', ''Tops'', ''Shirt'') on conflict (source_id, vendor_id, sku) do update set name = excluded.name, missed_runs = 1, collected_at = now()', pg_temp.sid(1))), 'rows=1', 'an upsert on the unique key works');
select is((select name || '/' || missed_runs from catalog.catalog_items where sku = 'C-1'), 'Renamed/1', 'and updated the row');
select is(pg_temp.run_as(null, 'collector_role', 'update catalog.catalog_items set source_id = null, vendor_id = ''a0000000-0000-0000-0000-000000000001'' where sku = ''C-1'''), 'err=42501', 'it cannot move a source row to a vendor');
select is(pg_temp.run_as(null, 'collector_role', 'update catalog.catalog_items set status = ''withdrawn'' where sku = ''C-1'''), 'rows=1', 'it can withdraw a row');
select is(pg_temp.run_as(null, 'collector_role', 'delete from catalog.catalog_items where sku = ''C-1'''), 'err=42501', 'it cannot delete one');
select is(pg_temp.val_as(null, 'collector_role', 'select count(*) from catalog.catalog_items where sku = ''C-1'' and status = ''withdrawn'''), '1', 'it sees withdrawn rows');
select is(pg_temp.val_as(null, 'collector_role', 'select count(*) from catalog.catalog_items where sku in (''T-4'', ''C-1'')'), '1', 'it sees the source row C-1 and not the vendor row T-4');
select is(pg_temp.val_as(null, 'collector_role', 'select count(*) from catalog.catalog_items where vendor_id is not null'), '0', 'it sees no vendor row at all');
select is(pg_temp.run_as(null, 'collector_role', 'update catalog.catalog_items set name = ''hijack'' where vendor_id is not null'), 'rows=0', 'it cannot update a vendor row');
select is(pg_temp.run_as(null, 'collector_role', 'select 1 from catalog.vendors'), 'err=42501', 'it cannot read the vendors');
select is(pg_temp.run_as(null, 'collector_role', 'select 1 from catalog.vendor_members'), 'err=42501', 'nor the vendor members');
select is(pg_temp.run_as(null, 'collector_role', 'select 1 from catalog.lk_category'), 'rows=' || (select count(*) from catalog.lk_category), 'it reads the lookups');
select is(pg_temp.run_as(null, 'collector_role', 'select 1 from catalog.colour_family_ref'), 'rows=' || (select count(*) from catalog.colour_family_ref), 'and the swatch table');
select is(pg_temp.run_as(null, 'collector_role', q), 'err=42501', 'the collector cannot read: ' || q) from unnest(array['select 1 from app.items', 'select 1 from app.profiles', 'select 1 from app.jobs', 'select 1 from ops.admin_audit_log', 'select 1 from ops.settings',
  'select 1 from auth.users', 'select 1 from storage.objects', 'select 1 from pg_authid']) q order by q;
select is(pg_temp.run_as(null, 'collector_role', 'select catalog.take_down_source(1, ''x'')'), 'err=42501', 'the collector cannot take a source down');

-- ======== 8. worker_role reads active catalogue rows =====================================================================================
select ok(has_table_privilege('worker_role', 'catalog.catalog_items', 'select') and not has_table_privilege('worker_role', 'catalog.catalog_items', 'insert,update,delete,truncate,references,trigger'), 'worker_role: select only on catalog_items');
select is((select array_agg(policyname || ':' || cmd || ':' || qual) from pg_policies where roles = array['worker_role']::name[] and tablename = 'catalog_items'), array['catalog_items_worker_select:SELECT:(status = ''active''::text)'], 'one worker policy on catalog_items: select where status = active');
select is(pg_temp.val_as(null, 'worker_role', 'select count(*) from catalog.catalog_items where sku like ''T-%'' and status = ''active'''), '1', 'the worker sees the active rows that remain after the take-downs (the vendor row T-4)');
select is(pg_temp.val_as(null, 'worker_role', 'select count(*) from catalog.catalog_items where status <> ''active'''), '0', 'and never a review or withdrawn row');
select is(pg_temp.val_as(null, 'worker_role', 'select count(*) from catalog.catalog_items where extensions.similarity(name, ''Vendor jackets'') > 0.4'), '1', 'the similarity query of the receipt match runs on active rows');
insert into catalog.sources (id, name, site_url, robots_allowed, terms_note, checked_on) values (-1, 'W', 'https://w.example.test/', true, 't', current_date);
insert into catalog.catalog_items (source_id, sku, name, product_url, status) values (-1, 'W-1', 'Vendor jacket', 'https://w.example.test/1', 'review'), (-1, 'W-2', 'Vendor jacket', 'https://w.example.test/2', 'withdrawn');
select is(pg_temp.val_as(null, 'worker_role', 'select count(*) from catalog.catalog_items where extensions.similarity(name, ''Vendor jacket'') > 0.9'), '1', 'a review or withdrawn row with the same name never matches');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from catalog.sources'), 'err=42501', 'the worker cannot read sources');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from catalog.vendors'), 'err=42501', 'nor vendors');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from app.items'), 'err=42501', 'nor app.items');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from ops.admin_audit_log'), 'err=42501', 'nor the audit log');
select is(pg_temp.run_as(null, 'worker_role', 'update catalog.catalog_items set name = ''x'''), 'err=42501', 'the worker cannot update the catalogue');
select is(pg_temp.run_as(null, 'worker_role', 'delete from catalog.catalog_items'), 'err=42501', 'nor delete from it');

select * from finish();
rollback;
