-- WO-0041 / CC3: triggers and constraints of the core tables (LLD 4.2 to 4.4, 4.3): the colour trigger on items and
-- wishlist_entries, the archive trigger, outfit_items and item_features rules, taxonomy arrays, wishlist origin, feedback.
begin;
\ir helpers.inc
select plan(91);

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.seed_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.make_eligible(pg_temp.ub());
select pg_temp.seed_user(pg_temp.ub());
-- an extra item of a user (n >= 2), made by the session role
create function pg_temp.mk_item(p_uid uuid, p_n int) returns uuid language plpgsql as $f$
begin
  insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
  values (pg_temp.oid('item', p_uid, p_n), p_uid, 'Extra ' || p_n, 'Tops', 'Shirt', 1, 2, 3, 'manual');
  return pg_temp.oid('item', p_uid, p_n);
end $f$;
select pg_temp.mk_item(pg_temp.ua(), n) from generate_series(2, 30) n;

-- ---- colour: golden vectors (LLD 11), then the trigger overwrites whatever the client sends -------------------------------
select is(catalog.colour_family(0, 0, 139), 'Navy', '#00008B is Navy');
select is(catalog.colour_family(21, 96, 189), 'Blue', '#1560BD is Blue');
select is(catalog.colour_family(192, 192, 192), 'Grey', '#C0C0C0 is Grey');
select is(catalog.colour_family(54, 69, 79), 'Grey', '#36454F is Grey');
select is(catalog.colour_family(128, 0, 32), 'Maroon', '#800020 is Maroon');
select is(catalog.colour_family(null, 0, 0), null, 'null RGB gives null');

-- as A, through the policies: the client sends a wrong hex and family
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, colour_hex, colour_family, origin)
  values (%L, %L, 'Navy shirt', 'Tops', 'Shirt', 0, 0, 139, '#FFFFFF', 'Red', 'manual') $q$, pg_temp.oid('item', pg_temp.ua(), 200), pg_temp.ua())), 'rows=1', 'A inserts an item that sends a wrong colour hex and family');
select results_eq(format('select colour_hex, colour_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 200)), $$ values ('#00008B'::bpchar, 'Navy') $$, 'the trigger overwrote hex and family on insert');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ update app.items set colour_hex = '#000000', colour_family = 'Red' where id = %L $q$, pg_temp.oid('item', pg_temp.ua(), 200))), 'rows=1', 'A updates the hex and family directly');
select results_eq(format('select colour_hex, colour_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 200)), $$ values ('#00008B'::bpchar, 'Navy') $$, 'the trigger overwrote them on update');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set colour_r = 21, colour_g = 96, colour_b = 189 where id = %L', pg_temp.oid('item', pg_temp.ua(), 200))), 'rows=1', 'A changes the RGB');
select results_eq(format('select colour_hex, colour_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 200)), $$ values ('#1560BD'::bpchar, 'Blue') $$, 'hex and family follow the RGB');
select pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set colour_r = 128, colour_g = 0, colour_b = 32, colour2_r = 54, colour2_g = 69, colour2_b = 79, colour2_hex = %L, colour2_family = %L where id = %L', 'bad', 'Red', pg_temp.oid('item', pg_temp.ua(), 200)));
select results_eq(format('select colour_family, colour2_hex, colour2_family from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 200)), $$ values ('Maroon', '#36454F'::bpchar, 'Grey') $$, 'the secondary colour is derived too');
select pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set is_multicolour = true where id = %L', pg_temp.oid('item', pg_temp.ua(), 200)));
select is((select colour_family from app.items where id = pg_temp.oid('item', pg_temp.ua(), 200)), 'Multi', 'a multicoloured item is Multi');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, colour_hex, colour_family)
  values (%L, %L, 'Grey trousers', 'Bottoms', 'Trousers', 192, 192, 192, '#123456', 'Pink') $q$, pg_temp.oid('wish', pg_temp.ua(), 200), pg_temp.ua())), 'rows=1', 'A adds a wishlist entry with a wrong hex and family');
select results_eq(format('select colour_hex, colour_family from app.wishlist_entries where id = %L', pg_temp.oid('wish', pg_temp.ua(), 200)), $$ values ('#C0C0C0'::bpchar, 'Grey') $$, 'the trigger is attached to wishlist_entries');
select pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ update app.wishlist_entries set colour_family = 'Pink' where id = %L $q$, pg_temp.oid('wish', pg_temp.ua(), 200)));
select is((select colour_family from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 200)), 'Grey', 'and on wishlist update');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_family, origin)
  values (%L, %L, 'Any chinos', 'Bottoms', 'Chinos', 'Khaki', 'unlock') $q$, pg_temp.oid('wish', pg_temp.ua(), 201), pg_temp.ua())), 'rows=1', 'a wishlist entry may have no colour (unlock entries)');
select results_eq(format('select colour_hex, colour_family from app.wishlist_entries where id = %L', pg_temp.oid('wish', pg_temp.ua(), 201)), $$ values (null::bpchar, null) $$, 'no RGB gives a null family, not the one the client sent');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, colour2_r, origin) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, 5, ''manual'')', pg_temp.ua()),
  '23514', null, 'a half-given secondary colour is refused');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin) values (%L, ''x'', ''Tops'', ''Shirt'', 256, 1, 1, ''manual'')', pg_temp.ua()),
  '23514', null, 'a colour channel above 255 is refused');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, colour_r) values (%L, ''x'', ''Tops'', ''Shirt'', 5)', pg_temp.ua()),
  '23514', null, 'a half-given wishlist colour is refused');

-- ---- items: taxonomy, generated flag, updated_at, delete ------------------------------------------------------------------
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin) values (%L, ''x'', ''Tops'', ''Jeans'', 1, 1, 1, ''manual'')', pg_temp.ua()),
  '23503', null, 'a sub-type from another category is refused (composite foreign key)');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, fit) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''manual'', ''Baggy'')', pg_temp.ua()),
  '23503', null, 'an unknown fit is refused');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''scraped'')', pg_temp.ua()),
  '23514', null, 'an unknown origin is refused');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, seasons) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''manual'', ''{Monsoon}'')', pg_temp.ua()),
  '23514', 'unknown season in seasons', 'an unknown season is refused');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, occasions) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''manual'', ''{Casual,Karaoke}'')', pg_temp.ua()),
  '23514', 'unknown occasion in occasions', 'an unknown occasion is refused');
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, occasions) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''manual'', ''{Casual,NULL}'')', pg_temp.ua()),
  '23514', 'unknown occasion in occasions', 'a null element in an occasion list is refused');
select lives_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, seasons, occasions) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''manual'', ''{Summer,All year}'', ''{Casual,Travel}'')', pg_temp.ua()),
  'known seasons and occasions are accepted');
select throws_ok(format('update app.items set seasons = ''{Monsoon}'' where id = %L', pg_temp.oid('item', pg_temp.ua(), 2)), '23514', null, 'an update to an unknown season is refused');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, seasons) values (%L, ''x'', ''Tops'', ''Shirt'', ''{Monsoon}'')', pg_temp.ua()), '23514', null, 'wishlist seasons are checked too');
select throws_ok(format('insert into app.outfits (user_id, name, occasions) values (%L, ''x'', ''{Karaoke}'')', pg_temp.ua()), '23514', null, 'outfit occasions are checked too');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'update app.profiles set occasions = ''{Karaoke}'' returning 1'), 'err=23514: unknown occasion in occasions', 'profile occasions are checked too');
select is((select is_never_worn from app.items where id = pg_temp.oid('item', pg_temp.ua(), 2)), false, 'a new item is not never-worn');
update app.items set condition = 0 where id = pg_temp.oid('item', pg_temp.ua(), 2);
select is((select is_never_worn from app.items where id = pg_temp.oid('item', pg_temp.ua(), 2)), true, 'condition 0 counts as never worn');
update app.items set condition = 50, never_worn = true where id = pg_temp.oid('item', pg_temp.ua(), 2);
select is((select is_never_worn from app.items where id = pg_temp.oid('item', pg_temp.ua(), 2)), true, 'the never-worn flag counts');
select throws_ok(format('update app.items set condition = 101 where id = %L', pg_temp.oid('item', pg_temp.ua(), 2)), '23514', null, 'condition above 100 is refused');
select pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set updated_at = %L, name = ''Renamed'' where id = %L', '2000-01-01', pg_temp.oid('item', pg_temp.ua(), 3)));
select ok((select updated_at > now() - interval '1 minute' from app.items where id = pg_temp.oid('item', pg_temp.ua(), 3)), 'updated_at is kept by a trigger, not by the client');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('delete from app.items where id = %L', pg_temp.oid('item', pg_temp.ua(), 3))), 'err=42501', 'a consumer cannot delete an item (the delete route does it, LLD 4.6)');

-- ---- archive trigger (FR-51) and the active-item rule -----------------------------------------------------------------------
insert into app.outfits (id, user_id, name) select pg_temp.oid('outfit', pg_temp.ua(), n), pg_temp.ua(), 'Look ' || n from generate_series(10, 12) n;
insert into app.outfit_items (user_id, outfit_id, item_id, slot) values
  (pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 10), pg_temp.oid('item', pg_temp.ua(), 4), 'top'),
  (pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 10), pg_temp.oid('item', pg_temp.ua(), 5), 'bottom'),
  (pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 11), pg_temp.oid('item', pg_temp.ua(), 5), 'bottom');
select is((select count(*) from app.outfits where user_id = pg_temp.ua() and needs_attention), 0::bigint, 'no outfit needs attention at first');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set name = ''Renamed'' where id = %L', pg_temp.oid('item', pg_temp.ua(), 4))), 'rows=1', 'a plain edit');
select is((select count(*) from app.outfits where user_id = pg_temp.ua() and needs_attention), 0::bigint, 'a plain edit flags nothing');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set status = ''archived'', archive_reason = ''sold'', archived_at = now() where id = %L', pg_temp.oid('item', pg_temp.ua(), 4))), 'rows=1', 'A archives item 4');
select is((select array_agg(name order by name) from app.outfits where user_id = pg_temp.ua() and needs_attention), array['Look 10'], 'archiving flags exactly the outfit that contains the item');
select is((select needs_attention from app.outfits where id = pg_temp.oid('outfit', pg_temp.ua(), 12)), false, 'an outfit without the item is not flagged');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update app.items set status = ''archived'' where id = %L', pg_temp.oid('item', pg_temp.ua(), 5))), 'rows=1', 'A archives item 5');
select is((select array_agg(name order by name) from app.outfits where user_id = pg_temp.ua() and needs_attention), array['Look 10', 'Look 11'], 'now both outfits with item 5 are flagged');
select is((select count(*) from app.outfits where user_id = pg_temp.ub() and needs_attention), 0::bigint, 'another user''s outfits are never flagged');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)',
  pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 12), pg_temp.oid('item', pg_temp.ua(), 4), 'top')), 'err=23514', 'an archived item cannot be added to an outfit');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)',
  pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 12), pg_temp.oid('item', pg_temp.ua(), 6), 'top')), 'rows=1', 'an active item can');
select throws_ok(format('update app.outfit_items set item_id = %L where outfit_id = %L and item_id = %L', pg_temp.oid('item', pg_temp.ua(), 4), pg_temp.oid('outfit', pg_temp.ua(), 12), pg_temp.oid('item', pg_temp.ua(), 6)),
  '23514', 'item_not_active', 'swapping an outfit slot to an archived item is refused');
select throws_ok(format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)', pg_temp.ua(), pg_temp.oid('outfit', pg_temp.ua(), 12), pg_temp.oid('item', pg_temp.ua(), 7), 'hat'),
  '23514', null, 'an unknown slot is refused');
-- deleting an item cascades to its purchases and outfit links
insert into app.purchases (user_id, item_id, price) values (pg_temp.ua(), pg_temp.oid('item', pg_temp.ua(), 6), 20);
delete from app.items where id = pg_temp.oid('item', pg_temp.ua(), 6);
select is((select count(*) from app.purchases where item_id = pg_temp.oid('item', pg_temp.ua(), 6)) + (select count(*) from app.outfit_items where item_id = pg_temp.oid('item', pg_temp.ua(), 6)), 0::bigint, 'deleting an item removes its purchases and outfit links');

-- ---- item_features: ownership trigger and the 32/64 embedding check ---------------------------------------------------------
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, garment_p, embedding)
  values (%L, %L, 'garment-cnn-v1', 3, 0.9, array_fill(0.5::real, array[32])) $q$, pg_temp.oid('item', pg_temp.ua(), 8), pg_temp.ua())), 'rows=1', 'A stores features for their own item');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.item_features (item_id, user_id, model_version, embedding)
  values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) returning 1 $q$, pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.ua())),
  'err=23503: item_features must belong to the owner of the item', 'A cannot store features for an item of B (user_id = A)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ insert into app.item_features (item_id, user_id, model_version, embedding)
  values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) $q$, pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.ub())), 'err=23503', 'nor with user_id = B');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ub(), 1), pg_temp.ua()), '23503', 'item_features must belong to the owner of the item', 'the trigger refuses it even for the session role (no RLS involved)');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 9), pg_temp.ub()), '23503', 'item_features must belong to the owner of the item', 'nor can a row claim the wrong user for a real item');
select throws_ok(format('update app.item_features set user_id = %L where item_id = %L', pg_temp.ub(), pg_temp.oid('item', pg_temp.ua(), 8)), '23503', null, 'a row cannot be handed to another user by an update');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[64])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'a 64-number embedding is refused for model version 1');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v2', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'a 32-number embedding is refused for model version 2');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[31])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'a 31-number embedding is refused');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', '{}') $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'an empty embedding is refused');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[2, 16])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'a two-dimensional array of 32 numbers is refused');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', null) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23502', null, 'a missing embedding is refused');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v3', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), '23514', null, 'an unknown model version is refused');
select lives_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, garment_p, embedding) values (%L, %L, 'garment-cnn-v2', 19, 1, array_fill(0.5::real, array[64])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 10), pg_temp.ua()), 'a 64-number embedding with class 19 is accepted for model version 2');
select lives_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, garment_p, embedding) values (%L, %L, 'garment-cnn-v1', 9, 0, array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 11), pg_temp.ua()), 'class 9 is accepted for model version 1');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, embedding) values (%L, %L, 'garment-cnn-v1', 10, array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), '23514', null, 'class 10 is refused for model version 1');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, embedding) values (%L, %L, 'garment-cnn-v2', 20, array_fill(0.5::real, array[64])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), '23514', null, 'class 20 is refused for model version 2');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_class, embedding) values (%L, %L, 'garment-cnn-v2', -1, array_fill(0.5::real, array[64])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), '23514', null, 'a negative class is refused');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, garment_p, embedding) values (%L, %L, 'garment-cnn-v1', 1.5, array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), '23514', null, 'a probability above 1 is refused');
select lives_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), 'class and probability may be null');
select throws_ok(format($q$ insert into app.item_features (item_id, user_id, model_version, embedding) values (%L, %L, 'garment-cnn-v1', array_fill(0.5::real, array[32])) $q$,
  pg_temp.oid('item', pg_temp.ua(), 12), pg_temp.ua()), '23505', null, 'one row per item');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format($q$ update app.item_features set model_version = 'garment-cnn-v2' where item_id = %L $q$, pg_temp.oid('item', pg_temp.ua(), 12))), 'err=23514', 'switching the version without a matching embedding is refused');

-- ---- wishlist (FR-34): origin, priority, month, status ----------------------------------------------------------------------
select is((select origin from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 0)), 'user', 'a wishlist entry defaults to origin user');
select is((select origin from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 201)), 'unlock', 'an entry from Wardrobe unlock keeps origin unlock');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, origin) values (%L, ''x'', ''Tops'', ''Shirt'', ''vendor'')', pg_temp.ua()), '23514', null, 'an unknown wishlist origin is refused');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, priority) values (%L, ''x'', ''Tops'', ''Shirt'', ''urgent'')', pg_temp.ua()), '23514', null, 'an unknown priority is refused');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, status) values (%L, ''x'', ''Tops'', ''Shirt'', ''gone'')', pg_temp.ua()), '23514', null, 'an unknown wishlist status is refused');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, planned_month) values (%L, ''x'', ''Tops'', ''Shirt'', ''2026-12-15'')', pg_temp.ua()), '23514', null, 'a planned month must be the first day of a month');
select lives_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type, planned_month, budget, priority) values (%L, ''x'', ''Tops'', ''Shirt'', ''2026-12-01'', 50, ''high'')', pg_temp.ua()), 'a planned month with a budget is accepted');
select throws_ok(format('insert into app.wishlist_entries (user_id, name, category, sub_type) values (%L, ''x'', ''Tops'', ''Jeans'')', pg_temp.ua()), '23503', null, 'a wishlist sub-type from another category is refused');
select is((select priority || '/' || status from app.wishlist_entries where id = pg_temp.oid('wish', pg_temp.ua(), 200)), 'medium/open', 'wishlist defaults are medium and open');

-- ---- suggestion feedback, collections, tags -----------------------------------------------------------------------------------
select lives_ok(pg_temp.tpl('suggestion_feedback', pg_temp.ua(), 5), 'feedback with an engine_config like gm1;emb0;pair0;ul:fb;w:base is accepted');
select throws_ok(format('insert into app.suggestion_feedback (user_id, occasion, accepted, engine_config) values (%L, ''Casual'', true, ''my navy shirt'')', pg_temp.ua()), '23514', null, 'free text in engine_config is refused');
select throws_ok(format('insert into app.suggestion_feedback (user_id, occasion, accepted, engine_config) values (%L, ''Casual'', true, %L)', pg_temp.ua(), repeat('a', 65)), '23514', null, 'an engine_config over 64 characters is refused');
select throws_ok(format('insert into app.suggestion_feedback (user_id, occasion, accepted, engine_config) values (%L, ''Karaoke'', true, ''gm1'')', pg_temp.ua()), '23503', null, 'feedback needs a known occasion');
select throws_ok(format('insert into app.collections (user_id, name) values (%L, ''coll0'')', pg_temp.ua()), '23505', null, 'a collection name is unique per user');
select lives_ok(format('insert into app.collections (user_id, name) values (%L, ''shared name'')', pg_temp.ua()) || '; ' || format('insert into app.collections (user_id, name) values (%L, ''shared name'')', pg_temp.ub()), 'two users may use the same collection name');
select throws_ok(format('insert into app.tags (user_id, name) values (%L, ''tag0'')', pg_temp.ua()), '23505', null, 'a tag name is unique per user');

select * from finish();
rollback;
