-- Shared test helpers (WO-0041). Included with `\ir helpers.inc` right after `begin;` in each test file; everything lives in
-- pg_temp, so nothing is created in the database. Not a *.test.sql file, so pg_prove does not run it on its own.

-- A deterministic uuid for a named object of a user: oid('item', user, 0)
create function pg_temp.oid(p_kind text, p_uid uuid, p_n int) returns uuid language sql immutable as
  $f$ select md5(p_kind || ':' || p_uid::text || ':' || p_n)::uuid $f$;

-- Run one statement as a role (with the user's JWT claims set) and report: 'rows=N' or 'err=SQLSTATE'. Always returns
-- to the session role. The statement runs in its own subtransaction, so a refused statement leaves nothing behind.
create function pg_temp.run_as(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    res := 'rows=' || n;
  exception when others then
    res := 'err=' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $f$;

-- Same, but returns the first column of the first row as text (or 'err=SQLSTATE: message')
create function pg_temp.val_as(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute p_sql into res;
  exception when others then
    res := 'err=' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $f$;

-- Same as val_as, with extra claims merged into the JWT (for example a user-editable user_metadata block). WO-0042 F2.
create function pg_temp.val_claims(p_uid uuid, p_role text, p_extra jsonb, p_sql text) returns text language plpgsql as $f$
declare res text;
begin
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', p_role) || p_extra)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role ' || quote_ident(p_role);
  begin
    execute p_sql into res;
  exception when others then
    res := 'err=' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $f$;

-- WO-0062 F1: the sign-in proof app.delete_my_account() reads from the token. GoTrue puts amr = [{"method": "password", "timestamp": <epoch seconds>}]
-- in every access token. amr_entry builds one entry that is p_age seconds old; val_fresh is val_claims with a password sign-in that happened now.
create function pg_temp.amr_entry(p_method text, p_age numeric) returns jsonb language sql as
  $f$ select jsonb_build_object('method', p_method, 'timestamp', floor(extract(epoch from now()) - p_age)::bigint) $f$;
create function pg_temp.val_fresh(p_uid uuid, p_role text, p_sql text) returns text language sql as
  $f$ select pg_temp.val_claims(p_uid, p_role, jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0))), p_sql) $f$;
-- Deletes a throw-away user with the given extra claims and says what happened: '<result>/<user still exists>'. The user is always removed afterwards.
create function pg_temp.try_del(p_extra jsonb) returns text language plpgsql as $f$
declare u uuid := gen_random_uuid(); res text; still boolean;
begin
  insert into auth.users (id, email) values (u, u::text || '@example.test');
  res := pg_temp.val_claims(u, 'authenticated', p_extra, 'select app.delete_my_account()');
  still := exists (select 1 from auth.users where id = u);
  delete from auth.users where id = u;
  return res || '/' || still;
end $f$;

-- A user: auth.users row (the sign-up trigger creates the profile). The email is the id, so it is unique and not a real address.
create function pg_temp.mk_user(p_uid uuid) returns void language sql as
  $f$ insert into auth.users (id, email) values (p_uid, p_uid::text || '@example.test') $f$;

-- Eligible participant: supported country, age confirmed, notice and both documents at version 1 (the seeded current versions)
create function pg_temp.make_eligible(p_uid uuid) returns void language plpgsql as $f$
begin
  update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id = p_uid;
  insert into app.consent_records (user_id, notice_version) values (p_uid, '1');
  insert into app.document_acceptances (user_id, document, version) values (p_uid, 'terms', '1'), (p_uid, 'privacy_policy', '1');
end $f$;

-- One valid INSERT statement per app table, for user p_uid. p_n = 0 is the fixture row, 1 is a second row (the "attempt").
-- Link tables point at the user's own parents: item 0 or 1 (made by mk_items), collection/tag/outfit 0. Returns null for a table
-- this suite does not know, so a new table fails the "every table has a template" test.
create function pg_temp.tpl(p_tbl text, p_uid uuid, p_n int) returns text language sql stable as $f$
  select case p_tbl
    when 'profiles' then format('insert into app.profiles (id) values (%L)', pg_temp.oid('profile', p_uid, p_n))
    when 'consent_records' then format('insert into app.consent_records (user_id, notice_version) values (%L, %L)', p_uid, '1')
    when 'document_acceptances' then format('insert into app.document_acceptances (user_id, document, version) values (%L, %L, %L)', p_uid, 'terms', case when p_n = 0 then '1' else '99' end)
    when 'items' then format('insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin, seasons, occasions) values (%L, %L, %L, %L, %L, 10, 20, 30, %L, %L, %L)',
      pg_temp.oid('item', p_uid, 100 + p_n), p_uid, 'Tee', 'Tops', 'T-shirt', 'manual', '{Summer}', '{Casual}')
    when 'item_features' then format('insert into app.item_features (item_id, user_id, model_version, garment_class, garment_p, embedding) values (%L, %L, %L, 1, 0.5, array_fill(0.1::real, array[32]))',
      pg_temp.oid('item', p_uid, p_n), p_uid, 'garment-cnn-v1')
    when 'purchases' then format('insert into app.purchases (id, user_id, item_id, price, currency) values (%L, %L, %L, 10, %L)',
      pg_temp.oid('purchase', p_uid, p_n), p_uid, pg_temp.oid('item', p_uid, 0), 'INR')
    when 'wishlist_entries' then format('insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b) values (%L, %L, %L, %L, %L, 0, 0, 128)',
      pg_temp.oid('wish', p_uid, p_n), p_uid, 'Navy chinos', 'Bottoms', 'Chinos')
    when 'collections' then format('insert into app.collections (id, user_id, name) values (%L, %L, %L)', pg_temp.oid('coll', p_uid, p_n), p_uid, 'coll' || p_n)
    when 'tags' then format('insert into app.tags (id, user_id, name) values (%L, %L, %L)', pg_temp.oid('tag', p_uid, p_n), p_uid, 'tag' || p_n)
    when 'item_collections' then format('insert into app.item_collections (user_id, item_id, collection_id) values (%L, %L, %L)',
      p_uid, pg_temp.oid('item', p_uid, p_n), pg_temp.oid('coll', p_uid, 0))
    when 'item_tags' then format('insert into app.item_tags (user_id, item_id, tag_id) values (%L, %L, %L)',
      p_uid, pg_temp.oid('item', p_uid, p_n), pg_temp.oid('tag', p_uid, 0))
    when 'outfits' then format('insert into app.outfits (id, user_id, name, occasions, seasons) values (%L, %L, %L, %L, %L)',
      pg_temp.oid('outfit', p_uid, p_n), p_uid, 'Look ' || p_n, '{Casual}', '{Summer}')
    when 'outfit_items' then format('insert into app.outfit_items (user_id, outfit_id, item_id, slot) values (%L, %L, %L, %L)',
      p_uid, pg_temp.oid('outfit', p_uid, 0), pg_temp.oid('item', p_uid, p_n), 'top')
    when 'outfit_plans' then format('insert into app.outfit_plans (id, user_id, outfit_id, plan_date) values (%L, %L, %L, %L)',
      pg_temp.oid('plan', p_uid, p_n), p_uid, pg_temp.oid('outfit', p_uid, 0), '2026-12-01')
    when 'outfit_logs' then format('insert into app.outfit_logs (id, user_id, outfit_id) values (%L, %L, %L)',
      pg_temp.oid('log', p_uid, p_n), p_uid, pg_temp.oid('outfit', p_uid, 0))
    when 'jobs' then format('insert into app.jobs (user_id, type, input) values (%L, %L, jsonb_build_object(%L, %L))',
      p_uid, 'photo', 'path', p_uid::text || '/' || pg_temp.oid('job', p_uid, p_n)::text || '.webp')
    when 'suggestion_feedback' then format('insert into app.suggestion_feedback (id, user_id, occasion, accepted, engine_config) values (%L, %L, %L, true, %L)',
      pg_temp.oid('fb', p_uid, p_n), p_uid, 'Casual', 'gm1;emb0;pair0;ul:fb;w:base')
  end $f$;

-- The owner column of a table
create function pg_temp.owner_col(p_tbl text) returns text language sql stable as $f$ select case when p_tbl = 'profiles' then 'id' else 'user_id' end $f$;

-- Two spare items (0 and 1) that link-table templates use, then one fixture row per table (as the session role, not a client).
-- consent_records and document_acceptances are written by make_eligible, not here.
create function pg_temp.seed_user(p_uid uuid) returns void language plpgsql as $f$
declare t text;
begin
  for n in 0..1 loop
    insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, origin)
    values (pg_temp.oid('item', p_uid, n), p_uid, 'Spare ' || n, 'Tops', 'Shirt', 1, 2, 3, 'manual');
  end loop;
  foreach t in array array['items', 'collections', 'tags', 'outfits', 'item_features', 'purchases', 'wishlist_entries',
                           'item_collections', 'item_tags', 'outfit_items', 'outfit_plans', 'outfit_logs', 'suggestion_feedback', 'jobs'] loop
    execute pg_temp.tpl(t, p_uid, 0);
  end loop;
end $f$;

-- Digest of one user's rows in one table, for "nothing changed" checks
create function pg_temp.digest(p_tbl text, p_uid uuid) returns text language plpgsql as $f$
declare d text;
begin
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, %L order by to_jsonb(t)::text), %L)) from app.%I t where %I = %L',
    ',', '', p_tbl, pg_temp.owner_col(p_tbl), p_uid) into d;
  return d;
end $f$;

-- Every table of the app schema, from the catalog
create view pg_temp.app_tables as
  select c.relname::text as tbl from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p');

create function pg_temp.ua() returns uuid language sql immutable as $f$ select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $f$;
create function pg_temp.ub() returns uuid language sql immutable as $f$ select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid $f$;

-- Row count of one table for one user (runs as the session role)
create function pg_temp.n_rows(p_tbl text, p_uid uuid) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from app.%I where %I = %L', p_tbl, pg_temp.owner_col(p_tbl), p_uid) into n;
  return n;
end $f$;

-- The privilege the documented design gives `authenticated` on each app table (LLD 4.5, 4.6). The grants themselves are
-- compared with the catalog in 003_schema_and_grants.test.sql.
create temp table want (tbl text primary key, sel bool, ins bool, upd bool, del bool);
insert into want values
  ('profiles', true, false, true, false), ('consent_records', true, true, false, false), ('document_acceptances', true, false, false, false),
  ('items', true, true, true, false), ('item_features', true, true, true, true), ('purchases', true, true, true, true),
  ('wishlist_entries', true, true, true, true), ('collections', true, true, true, true), ('tags', true, true, true, true),
  ('item_collections', true, true, false, true), ('item_tags', true, true, false, true), ('outfits', true, true, true, true),
  ('outfit_items', true, true, true, true), ('outfit_plans', true, true, true, true), ('outfit_logs', true, true, false, true),
  ('suggestion_feedback', true, true, false, false), ('jobs', true, true, false, false);
