-- WO-0041 / CC3: the consent gate (LLD 4.5, 4.9). Data tables return no rows and accept no writes unless the caller is an eligible
-- consumer: pilot notice and Terms and Privacy accepted at the current versions, age confirmed, country supported, no maintenance.
-- Profile, consent records and acceptances stay readable, so a user can still accept, export and leave.
begin;
\ir helpers.inc
select count(*) as nt from pg_temp.app_tables where tbl not in ('profiles', 'consent_records', 'document_acceptances') \gset
select plan(:nt * 6 + 60);

-- S is the subject. state(S) reports what the gate lets through: 'sel|ins|has_consent|role'.
create function pg_temp.state(p_uid uuid) returns text language sql as $f$
  select case when pg_temp.run_as(p_uid, 'authenticated', format('select 1 from app.items where user_id = %L', p_uid)) = 'rows=0' then 'sel0' else 'sel+' end
    || '|' || case pg_temp.run_as(p_uid, 'authenticated', replace(pg_temp.tpl('items', p_uid, 1), pg_temp.oid('item', p_uid, 101)::text, gen_random_uuid()::text))
         when 'err=42501' then 'ins0' when 'rows=1' then 'ins+' else 'insERR' end
    || '|' || pg_temp.val_as(p_uid, 'authenticated', 'select app.has_consent()') $f$;

select pg_temp.mk_user('11111111-1111-1111-1111-111111111111');   -- S, the subject
select pg_temp.make_eligible('11111111-1111-1111-1111-111111111111');
select pg_temp.seed_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.state('11111111-1111-1111-1111-111111111111'), 'sel+|ins+|true', 'baseline: an eligible consumer reads and writes');

-- each way to fail the gate, one at a time, then restore
create temp table scenario (n serial, label text, brk text, fix text, gated text default 'false');
insert into scenario (label, brk, fix) values
  ('no pilot notice consent', $$ delete from app.consent_records where user_id = '11111111-1111-1111-1111-111111111111' $$,
     $$ insert into app.consent_records (user_id, notice_version) values ('11111111-1111-1111-1111-111111111111', '1') $$),
  ('only a FUTURE notice version is recorded (9 while 1 is current)', $$ update app.consent_records set notice_version = '9' where user_id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.consent_records set notice_version = '1' where user_id = '11111111-1111-1111-1111-111111111111' $$),
  ('only a FUTURE Terms version is accepted (9 while 1 is current)', $$ update app.document_acceptances set version = '9' where user_id = '11111111-1111-1111-1111-111111111111' and document = 'terms' $$,
     $$ update app.document_acceptances set version = '1' where user_id = '11111111-1111-1111-1111-111111111111' and document = 'terms' $$),
  ('the notice version changed', $$ update ops.settings set value = '2' where key = 'current_notice_version' $$, $$ update ops.settings set value = '1' where key = 'current_notice_version' $$),
  ('no Terms acceptance', $$ delete from app.document_acceptances where user_id = '11111111-1111-1111-1111-111111111111' and document = 'terms' $$,
     $$ insert into app.document_acceptances (user_id, document, version) values ('11111111-1111-1111-1111-111111111111', 'terms', '1') $$),
  ('no Privacy Policy acceptance', $$ delete from app.document_acceptances where user_id = '11111111-1111-1111-1111-111111111111' and document = 'privacy_policy' $$,
     $$ insert into app.document_acceptances (user_id, document, version) values ('11111111-1111-1111-1111-111111111111', 'privacy_policy', '1') $$),
  ('the Terms version changed', $$ update ops.settings set value = '2' where key = 'current_terms_version' $$, $$ update ops.settings set value = '1' where key = 'current_terms_version' $$),
  ('the Privacy version changed', $$ update ops.settings set value = '2' where key = 'current_privacy_version' $$, $$ update ops.settings set value = '1' where key = 'current_privacy_version' $$),
  ('age not confirmed', $$ update app.profiles set age_confirmed = false where id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.profiles set age_confirmed = true where id = '11111111-1111-1111-1111-111111111111' $$),
  ('country not supported', $$ update app.profiles set country = 'US' where id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.profiles set country = 'IN' where id = '11111111-1111-1111-1111-111111111111' $$),
  ('country not set', $$ update app.profiles set country = null where id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.profiles set country = 'IN' where id = '11111111-1111-1111-1111-111111111111' $$),
  ('the supported list is empty', $$ update ops.settings set value = '' where key = 'supported_countries' $$, $$ update ops.settings set value = 'IN' where key = 'supported_countries' $$),
  ('maintenance mode', $$ update ops.settings set value = 'on' where key = 'maintenance' $$, $$ update ops.settings set value = 'off' where key = 'maintenance' $$),
  ('a vendor account', $$ update app.profiles set role = 'vendor' where id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.profiles set role = 'consumer' where id = '11111111-1111-1111-1111-111111111111' $$),
  ('an admin account', $$ update app.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111' $$,
     $$ update app.profiles set role = 'consumer' where id = '11111111-1111-1111-1111-111111111111' $$);
-- the role is checked by the policies, not by has_consent(), so has_consent stays true for a vendor or admin
update scenario set gated = 'true' where label in ('a vendor account', 'an admin account');
create function pg_temp.run_sql(p text) returns text language plpgsql as $f$ begin execute p; return 'done'; end $f$;

select is(pg_temp.run_sql(brk) || ' / ' || pg_temp.state('11111111-1111-1111-1111-111111111111') || ' / ' || pg_temp.run_sql(fix) || ' / ' || pg_temp.state('11111111-1111-1111-1111-111111111111'),
  'done / sel0|ins0|' || gated || ' / done / sel+|ins+|true', 'gate: ' || label || ' blocks data, and restoring it reopens the gate') from scenario order by n;

-- the gate holds for EVERY data table (derived from the catalog), not just items: S without the pilot notice consent
select pg_temp.run_sql($$ delete from app.consent_records where user_id = '11111111-1111-1111-1111-111111111111' $$);
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', format('select 1 from app.%I where user_id = %L', tbl, '11111111-1111-1111-1111-111111111111'::uuid)),
  'rows=0', 'without consent, S reads no rows from app.' || tbl) from pg_temp.app_tables
  where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', pg_temp.tpl(tbl, '11111111-1111-1111-1111-111111111111', 1)),
  case tbl when 'item_features' then 'err=23503' when 'outfit_items' then 'err=23514' else 'err=42501' end,
  'without consent, S cannot write to app.' || tbl) from pg_temp.app_tables
  where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', format('update app.%I set user_id = %L', tbl, '11111111-1111-1111-1111-111111111111'::uuid)),
  case when w.upd then 'rows=0' else 'err=42501' end, 'without consent, an update with no WHERE touches no row of app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', format('delete from app.%I', tbl)),
  case when w.del then 'rows=0' else 'err=42501' end, 'without consent, a delete with no WHERE touches no row of app.' || tbl)
  from pg_temp.app_tables t join want w using (tbl) where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;

select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'delete from app.outfits'), 'rows=0', 'without consent, S cannot delete outfits');

-- what a gated user CAN still do: read the profile and acceptances, accept the notice at the current version only
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'select 1 from app.profiles'), 'rows=1', 'a gated user reads their own profile');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'select 1 from app.document_acceptances'), 'rows=2', 'a gated user reads their own acceptances');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'select 1 from app.consent_records'), 'rows=0', 'S has no consent record yet');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set display_name = ''Sam'''), 'rows=1', 'a gated user can edit their profile name');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.consent_records (user_id, notice_version) values (''11111111-1111-1111-1111-111111111111'', ''0'')'),
  'err=42501', 'a stale notice version is refused');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.consent_records (user_id, notice_version) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''1'')'),
  'err=42501', 'S cannot record consent for someone else');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.consent_records (user_id, notice_version, accepted_at) values (''11111111-1111-1111-1111-111111111111'', ''1'', now() - interval ''1 year'')'),
  'err=42501', 'S cannot choose the acceptance time');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.consent_records (user_id, notice_version) values (''11111111-1111-1111-1111-111111111111'', ''9'')'),
  'err=42501', 'a FUTURE notice version is refused (the check is equality, not >=)');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.consent_records (user_id, notice_version) values (''11111111-1111-1111-1111-111111111111'', ''1'')'),
  'rows=1', 'S can accept the current notice version');
select is(pg_temp.state('11111111-1111-1111-1111-111111111111'), 'sel+|ins+|true', 'accepting the notice opens the gate');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.consent_records set notice_version = ''9'''), 'err=42501', 'a consent record cannot be edited');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'delete from app.consent_records'), 'err=42501', 'a consent record cannot be deleted by its owner');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'delete from app.document_acceptances'), 'err=42501', 'an acceptance cannot be deleted by its owner');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.document_acceptances (user_id, document, version) values (''11111111-1111-1111-1111-111111111111'', ''terms'', ''1'')'),
  'err=42501', 'acceptances cannot be written directly (only app.accept_documents writes them)');

-- maintenance still lets a user read their own profile
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'select 1 from app.profiles'), 'rows=1', 'in maintenance mode a user still reads their profile');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'select 1 from app.document_acceptances'), 'rows=2', 'in maintenance mode a user still reads their acceptances');
update ops.settings set value = 'off' where key = 'maintenance';

-- a vendor with data of their own (inserted by the server) sees none of it through the consumer tables
select pg_temp.mk_user('22222222-2222-2222-2222-222222222222');
select pg_temp.make_eligible('22222222-2222-2222-2222-222222222222');
select pg_temp.seed_user('22222222-2222-2222-2222-222222222222');
update app.profiles set role = 'vendor' where id = '22222222-2222-2222-2222-222222222222';
select is(pg_temp.val_as('22222222-2222-2222-2222-222222222222', 'authenticated', 'select app.current_role()'), 'vendor', 'V is a vendor');
select is(pg_temp.val_as('22222222-2222-2222-2222-222222222222', 'authenticated', 'select app.has_consent()'), 'true', 'V passes the eligibility test but is not a consumer');
select is(pg_temp.run_as('22222222-2222-2222-2222-222222222222', 'authenticated', format('select 1 from app.%I where user_id = %L', tbl, '22222222-2222-2222-2222-222222222222'::uuid)),
  'rows=0', 'a vendor reads none of their own rows in app.' || tbl) from pg_temp.app_tables
  where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;
select is(pg_temp.run_as('22222222-2222-2222-2222-222222222222', 'authenticated', pg_temp.tpl(tbl, '22222222-2222-2222-2222-222222222222', 1)),
  case tbl when 'item_features' then 'err=23503' when 'outfit_items' then 'err=23514' else 'err=42501' end,
  'a vendor cannot write to app.' || tbl) from pg_temp.app_tables
  where tbl not in ('profiles', 'consent_records', 'document_acceptances') order by tbl;
select is(pg_temp.run_as('22222222-2222-2222-2222-222222222222', 'authenticated', 'select 1 from app.items'), 'rows=0', 'a vendor reads no consumer items');
select is(pg_temp.run_as('22222222-2222-2222-2222-222222222222', 'authenticated', pg_temp.tpl('wishlist_entries', '22222222-2222-2222-2222-222222222222', 1)), 'err=42501', 'a vendor cannot write a wishlist entry');

-- WO-0042 F2: the role comes from app.profiles, never from a claim the user can edit (user_metadata) or one a client can send
select is(pg_temp.val_claims('22222222-2222-2222-2222-222222222222', 'authenticated', '{"user_metadata": {"role": "consumer"}, "app_metadata": {"role": "consumer"}, "user_role": "consumer"}', 'select app.current_role()'),
  'vendor', 'a vendor whose JWT claims user_metadata.role = consumer is still a vendor');
select is(pg_temp.val_claims('22222222-2222-2222-2222-222222222222', 'authenticated', '{"user_metadata": {"role": "consumer"}}', 'select count(*) from app.items'),
  '0', 'that vendor reads zero rows from app.items');
select alike(pg_temp.val_claims('22222222-2222-2222-2222-222222222222', 'authenticated', '{"user_metadata": {"role": "consumer"}}',
  pg_temp.tpl('wishlist_entries', '22222222-2222-2222-2222-222222222222', 1) || ' returning 1'), 'err=42501%', 'and cannot write a wishlist entry');
select is(pg_temp.val_claims('11111111-1111-1111-1111-111111111111', 'authenticated', '{"user_metadata": {"role": "admin"}}', 'select app.current_role()'),
  'consumer', 'a consumer whose JWT claims user_metadata.role = admin is still a consumer');

-- a user with no profile row at all (an auth user whose profile was removed) is not eligible and sees nothing
select is(pg_temp.val_as('33333333-3333-3333-3333-333333333333', 'authenticated', 'select app.has_consent()'), 'false', 'an unknown user fails the gate');
select is(pg_temp.val_as(null, 'authenticated', 'select app.has_consent()'), 'false', 'a token without a subject fails the gate');
select is(pg_temp.run_as(null, 'authenticated', 'select 1 from app.items'), 'rows=0', 'a token without a subject reads no rows');
select is(ops.is_eligible('22222222-2222-2222-2222-222222222222'), true, 'ops.is_eligible is true for the vendor''s profile data (the role is checked by the policies)');
select is(ops.is_eligible(null), false, 'ops.is_eligible(null) is false');

-- profile protection (LLD 4.5): role, age_confirmed, deleting, deletion_requested_at are server-side only
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set role = ''admin'''), 'err=42501', 'a consumer cannot change their role');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set age_confirmed = false'), 'err=42501', 'a consumer cannot change age_confirmed');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set deleting = true'), 'err=42501', 'a consumer cannot set deleting');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set deletion_requested_at = now()'), 'err=42501', 'a consumer cannot set deletion_requested_at');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set id = gen_random_uuid()'), 'err=42501', 'a consumer cannot change their profile id');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'insert into app.profiles (id, role) values (gen_random_uuid(), ''admin'')'), 'err=42501', 'a consumer cannot insert a profile');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'delete from app.profiles'), 'err=42501', 'a consumer cannot delete a profile');
select is(pg_temp.run_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set country = ''IN'', hemisphere = ''north'', currency = ''INR'', display_name = ''Sam'', occasions = ''{Work}'''), 'rows=1', 'a consumer can edit the allowed profile columns');
select is((select role || age_confirmed::text || deleting::text from app.profiles where id = '11111111-1111-1111-1111-111111111111'), 'consumertruefalse', 'the protected columns are unchanged');
-- the trigger holds even if a column grant were widened by mistake
grant update (role, age_confirmed, deleting, deletion_requested_at) on app.profiles to authenticated;
select is(pg_temp.val_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set role = ''admin'' returning role'), 'err=42501: protected profile column', 'the trigger refuses a role change even under a widened grant');
select is(pg_temp.val_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set deleting = true returning 1'), 'err=42501: protected profile column', 'the trigger refuses deleting even under a widened grant');
select is(pg_temp.val_as('11111111-1111-1111-1111-111111111111', 'authenticated', 'update app.profiles set age_confirmed = false returning 1'), 'err=42501: protected profile column', 'the trigger refuses age_confirmed even under a widened grant');
-- the server side can
select is(pg_temp.run_as(null, 'service_role', 'update app.profiles set deleting = true, deletion_requested_at = now() where id = ''22222222-2222-2222-2222-222222222222'''), 'rows=1', 'the service role can set deleting');
select is(pg_temp.run_as(null, 'service_role', 'update app.profiles set role = ''vendor'' where id = ''11111111-1111-1111-1111-111111111111'''), 'rows=1', 'the service role can change a role');

select * from finish();
rollback;
