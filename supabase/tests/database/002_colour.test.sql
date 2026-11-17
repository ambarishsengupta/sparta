-- WO-0040: colour function and colour trigger function (LLD 4.3, section 11). The TypeScript agreement is tested in vitest (CC4).
begin;
select plan(37);

-- golden vectors: colours that are not swatches, so they test the nearest-match regions
select is(catalog.colour_family(0, 0, 139), 'Navy', '#00008B is Navy');
select is(catalog.colour_family(21, 96, 189), 'Blue', '#1560BD is Blue');
select is(catalog.colour_family(192, 192, 192), 'Grey', '#C0C0C0 is Grey');
select is(catalog.colour_family(54, 69, 79), 'Grey', '#36454F is Grey');
select is(catalog.colour_family(128, 0, 32), 'Maroon', '#800020 is Maroon');
select is(catalog.colour_family(null, 0, 0), null, 'null red gives null');
select is(catalog.colour_family(0, null, 0), null, 'null green gives null');
select is(catalog.colour_family(0, 0, null), null, 'null blue gives null');

-- every swatch maps to its own family, and the stored Lab values are those of the function
select is_empty($$ select 1 from catalog.colour_family_ref c where catalog.colour_family(
  ('x' || substr(c.hex, 2, 2))::bit(8)::int, ('x' || substr(c.hex, 4, 2))::bit(8)::int, ('x' || substr(c.hex, 6, 2))::bit(8)::int)
  is distinct from c.family $$, 'every swatch maps to its own family');
select is_empty($$ select 1 from catalog.colour_family_ref c, lateral (select catalog.rgb_to_lab(
  ('x' || substr(c.hex, 2, 2))::bit(8)::int, ('x' || substr(c.hex, 4, 2))::bit(8)::int, ('x' || substr(c.hex, 6, 2))::bit(8)::int) as lab) x
  where abs(c.l - x.lab[1]) + abs(c.a - x.lab[2]) + abs(c.b - x.lab[3]) > 1e-9 $$, 'stored Lab values equal rgb_to_lab of the swatch');
select is((select count(distinct family) from catalog.colour_family_ref), 17::bigint, '17 families have swatches (Multi has none)');
select is_empty($$ select 1 from catalog.colour_family_ref where family = 'Multi' $$, 'Multi has no swatch');

-- rgb_to_lab known values
select ok(abs((catalog.rgb_to_lab(0, 0, 0))[1]) < 1e-9, 'black has L = 0');
select ok(abs((catalog.rgb_to_lab(255, 255, 255))[1] - 100) < 1e-4, 'white has L = 100');
select ok(abs((catalog.rgb_to_lab(255, 255, 255))[2]) < 1e-3 and abs((catalog.rgb_to_lab(255, 255, 255))[3]) < 1e-3, 'white has a = b = 0');
select ok(abs((catalog.rgb_to_lab(255, 0, 0))[1] - 53.24) < 0.01 and abs((catalog.rgb_to_lab(255, 0, 0))[2] - 80.09) < 0.01
  and abs((catalog.rgb_to_lab(255, 0, 0))[3] - 67.20) < 0.01, 'red is L 53.24, a 80.09, b 67.20');
select ok(abs((catalog.rgb_to_lab(0, 0, 255))[1] - 32.30) < 0.01 and abs((catalog.rgb_to_lab(0, 0, 255))[2] - 79.19) < 0.01
  and abs((catalog.rgb_to_lab(0, 0, 255))[3] + 107.86) < 0.01, 'blue is L 32.30, a 79.19, b -107.86');
select is(catalog.rgb_to_lab(null, 0, 0), null, 'rgb_to_lab of a null channel is null');

-- deterministic ties: the swatch listed first (lowest id) wins
insert into catalog.colour_family_ref (family, hex, l, a, b) select 'Red', hex, l, a, b from catalog.colour_family_ref where id = 1;
select is(catalog.colour_family(0, 0, 0), 'Black', 'a later swatch at the same distance does not win');
insert into catalog.colour_family_ref (id, family, hex, l, a, b) select 0, 'Red', hex, l, a, b from catalog.colour_family_ref where id = 1;
select is(catalog.colour_family(0, 0, 0), 'Red', 'an earlier swatch at the same distance wins');

-- the trigger function, on scratch tables named like the real ones (it branches on the table name)
create temp table items (colour_r smallint, colour_g smallint, colour_b smallint, colour_hex text, colour_family text,
  is_multicolour boolean default false, colour2_r smallint, colour2_g smallint, colour2_b smallint, colour2_hex text, colour2_family text);
create trigger t before insert or update on items for each row execute function catalog.set_colour_fields();
create temp table wishlist_entries (colour_r smallint, colour_g smallint, colour_b smallint, colour_hex text, colour_family text, is_multicolour boolean);
create trigger t before insert or update on wishlist_entries for each row execute function catalog.set_colour_fields();

insert into items (colour_r, colour_g, colour_b, colour_hex, colour_family) values (0, 0, 139, '#FFFFFF', 'Red');
select results_eq($$ select colour_hex, colour_family from items $$, $$ values ('#00008B', 'Navy') $$, 'insert overwrites a client-sent hex and family');
update items set colour_family = 'Red', colour_hex = '#000000';
select results_eq($$ select colour_hex, colour_family from items $$, $$ values ('#00008B', 'Navy') $$, 'update overwrites a client-sent hex and family');
update items set colour_r = 21, colour_g = 96, colour_b = 189;
select results_eq($$ select colour_hex, colour_family from items $$, $$ values ('#1560BD', 'Blue') $$, 'changing RGB recomputes hex and family');
update items set colour_r = 5, colour_g = 5, colour_b = 5;
select results_eq($$ select colour_hex from items $$, $$ values ('#050505') $$, 'hex digits are zero-padded and upper case');
update items set is_multicolour = true;
select is((select colour_family from items), 'Multi', 'is_multicolour gives Multi');
update items set is_multicolour = false, colour_r = null;
select results_eq($$ select colour_hex, colour_family from items $$, $$ values (null, null) $$, 'null RGB gives null hex and null family');
update items set colour_r = 0, colour2_r = 21, colour2_g = 96, colour2_b = 189, colour2_hex = 'x', colour2_family = 'Red';
select results_eq($$ select colour2_hex, colour2_family from items $$, $$ values ('#1560BD', 'Blue') $$, 'secondary colour hex and family are computed');
update items set colour2_b = null, colour2_hex = '#123456', colour2_family = 'Red';
select results_eq($$ select colour2_hex, colour2_family from items $$, $$ values (null, null) $$, 'an incomplete secondary colour gives null hex and family');
update items set is_multicolour = true, colour2_r = 0, colour2_g = 0, colour2_b = 139;
select results_eq($$ select colour_family, colour2_family from items $$, $$ values ('Multi', 'Navy') $$, 'Multi applies to the primary colour only');

insert into wishlist_entries values (192, 192, 192, 'zz', 'zz', false);
select results_eq($$ select colour_hex, colour_family from wishlist_entries $$, $$ values ('#C0C0C0', 'Grey') $$, 'wishlist_entries has no secondary colour and is still handled');
update wishlist_entries set is_multicolour = true;
select is((select colour_family from wishlist_entries), 'Multi', 'wishlist_entries: is_multicolour gives Multi');

select ok(not has_function_privilege('anon', 'catalog.set_colour_fields()', 'execute') and has_function_privilege('authenticated', 'catalog.set_colour_fields()', 'execute'), 'set_colour_fields is executable by signed-in users, not anon');
select ok((select prosecdef from pg_proc where oid = 'catalog.set_colour_fields()'::regprocedure) = false, 'set_colour_fields runs as the caller (not security definer)');
select ok((select prosecdef from pg_proc where oid = 'catalog.colour_family(int,int,int)'::regprocedure) = false, 'colour_family runs as the caller');
select ok((select provolatile from pg_proc where oid = 'catalog.colour_family(int,int,int)'::regprocedure) = 's', 'colour_family is stable');
select ok((select provolatile from pg_proc where oid = 'catalog.rgb_to_lab(int,int,int)'::regprocedure) = 'i', 'rgb_to_lab is immutable');
select ok((select proisstrict from pg_proc where oid = 'catalog.colour_family(int,int,int)'::regprocedure), 'colour_family is strict');

select * from finish();
rollback;
