-- WO-0128 (audit finding A10): the five colour helpers pin an empty search_path and still behave as before; the item insert path goes through the
-- colour trigger of the real table with an empty and a pg_temp-only session search_path; app.confirm_receipt keeps its settings.
begin;
\ir helpers.inc
select plan(11);

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ua());

-- the five helpers: pinned, and nothing else about them changed
select is((select count(*) from pg_proc where oid in ('catalog.srgb_lin(float8)'::regprocedure, 'catalog.rgb_to_lab(int,int,int)'::regprocedure,
  'catalog.colour_family(int,int,int)'::regprocedure, 'catalog.rgb_hex(int,int,int)'::regprocedure, 'catalog.set_colour_fields()'::regprocedure)
  and proconfig @> array['search_path=""'] and not prosecdef), 5::bigint, 'all five colour helpers pin an empty search_path and still run as the caller');
select is((select string_agg(p.proname || ':' || p.provolatile::text || p.proisstrict::int::text, ' ' order by p.proname) from pg_proc p
  where p.oid in ('catalog.srgb_lin(float8)'::regprocedure, 'catalog.rgb_to_lab(int,int,int)'::regprocedure, 'catalog.colour_family(int,int,int)'::regprocedure,
  'catalog.rgb_hex(int,int,int)'::regprocedure, 'catalog.set_colour_fields()'::regprocedure)),
  'colour_family:s1 rgb_hex:i1 rgb_to_lab:i1 set_colour_fields:v0 srgb_lin:i0', 'volatility and strictness are unchanged');
select ok(has_function_privilege('authenticated', 'catalog.colour_family(int,int,int)', 'execute') and has_function_privilege('service_role', 'catalog.rgb_hex(int,int,int)', 'execute')
  and not has_function_privilege('anon', 'catalog.srgb_lin(float8)', 'execute') and not has_function_privilege('anon', 'catalog.set_colour_fields()', 'execute'),
  'the grants are unchanged: signed-in users and the secret-key client, not anon');

-- the helpers work whatever search_path the caller has: each probe is a function that carries its own search_path (the pgTAP functions need the session one)
create function pg_temp.probe_empty() returns text[] language sql set search_path = '' as
  $f$ select array[catalog.colour_family(0, 0, 139), catalog.rgb_hex(21, 96, 189), round((catalog.rgb_to_lab(255, 0, 0))[1]::numeric, 2)::text] $f$;
create function pg_temp.probe_temp_only() returns text language sql set search_path = pg_temp as $f$ select catalog.colour_family(128, 0, 32) $f$;
select is(pg_temp.probe_empty(), array['Navy', '#1560BD', '53.24'], 'colour_family, rgb_hex and rgb_to_lab (with srgb_lin under it) work with an empty session search_path');
select is(pg_temp.probe_temp_only(), 'Maroon', 'colour_family works with only pg_temp on the session search_path');

-- the item insert path, through the trigger of the real table, with an empty session search_path
create function pg_temp.insert_item_empty(p_uid uuid, p_id uuid) returns text language sql set search_path = '' as
  $f$ select pg_temp.run_as(p_uid, 'authenticated', format($q$ insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b,
    colour_hex, colour_family, colour2_r, colour2_g, colour2_b, origin) values (%L, %L, 'Navy shirt', 'Tops', 'Shirt', 0, 0, 139, '#FFFFFF', 'Red', 21, 96, 189, 'manual') $q$,
    p_id, p_uid)) $f$;
create function pg_temp.update_item_empty(p_uid uuid, p_id uuid) returns text language sql set search_path = '' as
  $f$ select pg_temp.run_as(p_uid, 'authenticated', format($q$ update app.items set colour_r = 128, colour_g = 0, colour_b = 32 where id = %L $q$, p_id)) $f$;
select is(pg_temp.insert_item_empty(pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 300)), 'rows=1', 'a signed-in user inserts an item with a wrong colour hex and family');
select results_eq(format('select colour_hex, colour_family, colour2_hex, colour2_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 300)),
  $$ values ('#00008B'::bpchar, 'Navy', '#1560BD'::bpchar, 'Blue') $$, 'the trigger computed both colours on insert');
select is(pg_temp.update_item_empty(pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 300)), 'rows=1', 'the same user changes the colour');
select results_eq(format('select colour_hex, colour_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 300)),
  $$ values ('#800020'::bpchar, 'Maroon') $$, 'the trigger recomputed it on update');

-- app.confirm_receipt: settings kept (invoker, empty search_path, only signed-in users may run it); the uuid[] variables carry explicit casts
select ok(not (select prosecdef from pg_proc where oid = 'app.confirm_receipt(bigint,jsonb)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'app.confirm_receipt(bigint,jsonb)'::regprocedure)
  and has_function_privilege('authenticated', 'app.confirm_receipt(bigint,jsonb)', 'execute') and not has_function_privilege('anon', 'app.confirm_receipt(bigint,jsonb)', 'execute'),
  'confirm_receipt is still security invoker, pinned, and executable by signed-in users only');
select is((select count(*) from regexp_matches((select prosrc from pg_proc where oid = 'app.confirm_receipt(bigint,jsonb)'::regprocedure), 'uuid\[\] := ''\{\}''::uuid\[\]', 'g')),
  2::bigint, 'both uuid[] variables of confirm_receipt are initialised with an explicit cast');

select * from finish();
rollback;
