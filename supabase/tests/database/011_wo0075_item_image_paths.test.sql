-- WO-0075 (R5b, checker MINOR-1): app.items.image_path and image_thumb_path, when set, are one plain file name directly under the row's own
-- owner folder ({user_id}/{name}: no foreign folder, no `..`, no nested folder, no absolute path, no backslash). The rule is a CHECK constraint,
-- so it holds for the owner through RLS and for the session role alike; every refusal below is SQLSTATE 23514 (check_violation).
begin;
\ir helpers.inc
select plan(55);

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.seed_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.make_eligible(pg_temp.ub());
select pg_temp.seed_user(pg_temp.ub());

-- insert one item for p_uid, as that user through the policies, with the given paths (null is allowed); answers 'rows=1' or 'err=SQLSTATE'
create function pg_temp.ins(p_uid uuid, p_n int, p_img text, p_thumb text) returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'authenticated', format($q$ insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, image_path, image_thumb_path)
    values (%L, %L, 'Pic', 'Tops', 'Shirt', 1, 2, 3, 'photo', %L, %L) $q$, pg_temp.oid('item', p_uid, p_n), p_uid, p_img, p_thumb)) $f$;
-- update one item of p_uid as that user
create function pg_temp.upd(p_uid uuid, p_n int, p_set text) returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'authenticated', format('update app.items set %s where id = %L', p_set, pg_temp.oid('item', p_uid, p_n))) $f$;
create function pg_temp.a() returns text language sql immutable as $f$ select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $f$;
create function pg_temp.b() returns text language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $f$;

-- ---- the constraint exists and covers every row already there ---------------------------------------------------------------------------
select is((select count(*) from pg_constraint where conrelid = 'app.items'::regclass and conname = 'items_image_path_owner_chk' and contype = 'c' and convalidated), 1::bigint, 'the owner-path check exists on app.items and is validated (every earlier row passed it)');
select matches(obj_description((select oid from pg_constraint where conname = 'items_image_path_owner_chk'), 'pg_constraint'), 'WO-0075', 'it carries a comment naming the work order');

-- ---- accepted: the owner's own paths, and null ----------------------------------------------------------------------------------------
select is(pg_temp.ins(pg_temp.ua(), 500, null, null), 'rows=1', 'A inserts an item with no picture (both null)');
select is(pg_temp.ins(pg_temp.ua(), 501, pg_temp.a() || '/0123456789abcdef0123456789abcdef-cutout.webp', pg_temp.a() || '/0123456789abcdef0123456789abcdef-thumb.webp'), 'rows=1', 'A inserts the worker-style cut-out and thumbnail paths (what items.create saves)');
select is(pg_temp.ins(pg_temp.ua(), 502, pg_temp.a() || '/orig.v2_final-1.jpeg', null), 'rows=1', 'A inserts only image_path, with dot, underscore and hyphen in the name');
select is(pg_temp.ins(pg_temp.ua(), 503, null, pg_temp.a() || '/t.png'), 'rows=1', 'A inserts only image_thumb_path');
select is(pg_temp.ins(pg_temp.ua(), 504, pg_temp.a() || '/' || repeat('x', 128), null), 'rows=1', 'a 128-character file name is the longest accepted');
select is(pg_temp.ins(pg_temp.ua(), 505, pg_temp.a() || '/a.b', null), 'rows=1', 'a single dot inside the name is fine');
select is(pg_temp.ins(pg_temp.ub(), 500, pg_temp.b() || '/b-own.webp', pg_temp.b() || '/b-own-thumb.webp'), 'rows=1', 'B inserts B''s own paths');

-- ---- refused on insert: another user's folder -----------------------------------------------------------------------------------------
select is(pg_temp.ins(pg_temp.ua(), 510, pg_temp.b() || '/steal.webp', null), 'err=23514', 'A cannot point image_path into B''s folder');
select is(pg_temp.ins(pg_temp.ua(), 511, null, pg_temp.b() || '/steal.webp'), 'err=23514', 'A cannot point image_thumb_path into B''s folder');
select is(pg_temp.ins(pg_temp.ua(), 512, pg_temp.a() || '/ok.webp', pg_temp.b() || '/steal.webp'), 'err=23514', 'a good image_path does not excuse a foreign thumbnail path');
select is(pg_temp.ins(pg_temp.ua(), 513, pg_temp.b() || '/steal.webp', pg_temp.a() || '/ok.webp'), 'err=23514', 'nor a good thumbnail path a foreign image_path');
select is(pg_temp.ins(pg_temp.ua(), 514, upper(pg_temp.a()) || '/x.webp', null), 'err=23514', 'the owner id must be written exactly as the database prints it (lower case)');
select is(pg_temp.ins(pg_temp.ua(), 515, 'x/' || pg_temp.a() || '/x.webp', null), 'err=23514', 'a folder in front of the owner folder is refused');
select is(pg_temp.ins(pg_temp.ua(), 516, replace(pg_temp.a(), 'a', 'c') || '/x.webp', null), 'err=23514', 'a made-up user id is refused');

-- ---- refused on insert: dot-dot, nesting, absolute paths, odd shapes ---------------------------------------------------------------------
select is(pg_temp.ins(pg_temp.ua(), 520, pg_temp.a() || '/../' || pg_temp.b() || '/x.webp', null), 'err=23514', 'a path that climbs out of the owner folder with ../ is refused');
select is(pg_temp.ins(pg_temp.ua(), 521, pg_temp.a() || '/..', null), 'err=23514', 'a bare .. as the file name is refused');
select is(pg_temp.ins(pg_temp.ua(), 522, pg_temp.a() || '/a..b.webp', null), 'err=23514', 'two dots inside a name are refused');
select is(pg_temp.ins(pg_temp.ua(), 523, '../' || pg_temp.a() || '/x.webp', null), 'err=23514', 'a leading ../ is refused');
select is(pg_temp.ins(pg_temp.ua(), 524, null, pg_temp.a() || '/a..b.webp'), 'err=23514', '.. in the thumbnail path is refused too');
select is(pg_temp.ins(pg_temp.ua(), 525, pg_temp.a() || '/sub/x.webp', null), 'err=23514', 'a nested folder under the owner folder is refused');
select is(pg_temp.ins(pg_temp.ua(), 526, null, pg_temp.a() || '/sub/x.webp'), 'err=23514', 'and in the thumbnail path');
select is(pg_temp.ins(pg_temp.ua(), 527, '/' || pg_temp.a() || '/x.webp', null), 'err=23514', 'an absolute path is refused');
select is(pg_temp.ins(pg_temp.ua(), 528, '/etc/passwd', null), 'err=23514', 'an absolute system path is refused');
select is(pg_temp.ins(pg_temp.ua(), 529, pg_temp.a() || E'\\x.webp', null), 'err=23514', 'a backslash in place of the slash is refused');
select is(pg_temp.ins(pg_temp.ua(), 530, pg_temp.a() || E'/a\\b.webp', null), 'err=23514', 'a backslash inside the name is refused');
select is(pg_temp.ins(pg_temp.ua(), 531, pg_temp.a() || '/', null), 'err=23514', 'an empty file name is refused');
select is(pg_temp.ins(pg_temp.ua(), 532, pg_temp.a(), null), 'err=23514', 'the bare owner id is refused');
select is(pg_temp.ins(pg_temp.ua(), 533, '', null), 'err=23514', 'an empty string is refused (null is the way to say no picture)');
select is(pg_temp.ins(pg_temp.ua(), 534, pg_temp.a() || '/.hidden', null), 'err=23514', 'a name starting with a dot is refused');
select is(pg_temp.ins(pg_temp.ua(), 535, pg_temp.a() || '/' || repeat('x', 129), null), 'err=23514', 'a 129-character file name is refused');
select is(pg_temp.ins(pg_temp.ua(), 536, pg_temp.a() || '/x.webp' || chr(10), null), 'err=23514', 'a trailing newline is refused');
select is(pg_temp.ins(pg_temp.ua(), 537, pg_temp.a() || '/a b.webp', null), 'err=23514', 'a space in the name is refused');
select is(pg_temp.ins(pg_temp.ua(), 538, pg_temp.a() || '/x%2F.webp', null), 'err=23514', 'a percent sign is refused');
select is(pg_temp.ins(pg_temp.ua(), 539, pg_temp.a() || '/é.webp', null), 'err=23514', 'a non-ASCII letter is refused');
select is((select count(*) from app.items where id in (select pg_temp.oid('item', pg_temp.ua(), n) from generate_series(510, 539) n)), 0::bigint, 'none of the refused inserts left a row');

-- ---- update: own path accepted, foreign path refused ----------------------------------------------------------------------------------
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L', pg_temp.a() || '/new.webp')), 'rows=1', 'A updates image_path to a path in A''s folder');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_thumb_path = %L', pg_temp.a() || '/new-thumb.webp')), 'rows=1', 'A updates image_thumb_path to a path in A''s folder');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L, image_thumb_path = %L', pg_temp.a() || '/n2.webp', pg_temp.a() || '/n2-thumb.webp')), 'rows=1', 'A updates both at once');
select is(pg_temp.upd(pg_temp.ua(), 500, 'name = ''Renamed'''), 'rows=1', 'an update that leaves the paths alone still works');
select is(pg_temp.upd(pg_temp.ua(), 501, 'image_path = null, image_thumb_path = null'), 'rows=1', 'A clears both paths (null is accepted on update)');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L', pg_temp.b() || '/steal.webp')), 'err=23514', 'A cannot update image_path to a path in B''s folder');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_thumb_path = %L', pg_temp.b() || '/steal.webp')), 'err=23514', 'A cannot update image_thumb_path to a path in B''s folder');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L', pg_temp.a() || '/../' || pg_temp.b() || '/x.webp')), 'err=23514', 'an update to a ../ path is refused');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L', pg_temp.a() || '/sub/x.webp')), 'err=23514', 'an update to a nested path is refused');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_thumb_path = %L', '/' || pg_temp.a() || '/x.webp')), 'err=23514', 'an update to an absolute path is refused');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L', pg_temp.a() || E'/a\\b.webp')), 'err=23514', 'an update to a backslash path is refused');
select is(pg_temp.upd(pg_temp.ua(), 500, format('image_path = %L, image_thumb_path = %L', pg_temp.a() || '/fine.webp', pg_temp.b() || '/steal.webp')), 'err=23514', 'a pair with one foreign path is refused as a whole');
select is((select image_path || '|' || image_thumb_path from app.items where id = pg_temp.oid('item', pg_temp.ua(), 500)), pg_temp.a() || '/n2.webp|' || pg_temp.a() || '/n2-thumb.webp', 'every refused update left the stored paths as they were');
select is(pg_temp.upd(pg_temp.ub(), 500, format('image_path = %L', pg_temp.a() || '/steal.webp')), 'err=23514', 'B cannot update B''s item to a path in A''s folder either');

-- ---- the rule is the database's own: it holds for the session role (the table owner) too, and follows the owner column -----------------
select throws_ok(format('insert into app.items (user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, image_path) values (%L, ''x'', ''Tops'', ''Shirt'', 1, 1, 1, ''photo'', %L)', pg_temp.a(), pg_temp.b() || '/x.webp'),
  '23514', null, 'the session role cannot insert a foreign path either');
select throws_ok(format('update app.items set image_thumb_path = %L where id = %L', pg_temp.b() || '/x.webp', pg_temp.oid('item', pg_temp.ua(), 500)),
  '23514', null, 'nor update to one');
select throws_ok(format('update app.items set user_id = %L where id = %L', pg_temp.b(), pg_temp.oid('item', pg_temp.ua(), 500)),
  null, null, 'moving an item with a picture to another owner is refused (by this check or by an earlier rule)');
select lives_ok(format('update app.items set image_path = %L where id = %L', pg_temp.a() || '/session-ok.webp', pg_temp.oid('item', pg_temp.ua(), 500)), 'the session role may set a compliant path');

select * from finish();
rollback;
