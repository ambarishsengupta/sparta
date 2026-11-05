-- WO-0041 / CC3: invitation check (FR-8, LLD 4.9), supported countries and onboarding (FR-9), acceptance RPC (FR-2, FR-68),
-- and the sign-up trigger (LLD 4.5).
begin;
\ir helpers.inc
select plan(65);

-- ---- ops.check_invitation: the Before User Created hook ------------------------------------------------------------------
insert into ops.invitations (email, note) values ('invited@example.test', 'pilot'), ('also.invited@example.test', null);
select is(ops.check_invitation('{"user": {"email": "stranger@example.test"}}'),
  '{"error": {"http_code": 403, "message": "Sparta is invitation-only during the pilot."}}'::jsonb, 'an email that is not invited gets the FR-8 error');
select is(ops.check_invitation('{"user": {"email": "invited@example.test"}}'), '{}'::jsonb, 'an invited email is allowed');
select is(ops.check_invitation('{"user": {"email": "Invited@Example.TEST"}}'), '{}'::jsonb, 'the match ignores case');
select is(ops.check_invitation('{"user": {"email": null}}')->'error'->>'http_code', '403', 'a sign-up without an email is refused');
select is(ops.check_invitation('{"user": {}}')->'error'->>'http_code', '403', 'an event without an email is refused');
select is(ops.check_invitation('{}')->'error'->>'message', 'Sparta is invitation-only during the pilot.', 'an empty event is refused with the same message');
select is(ops.check_invitation('{"user": {"email": "invited@example.test.evil"}}')->'error'->>'http_code', '403', 'a longer address is not a match');
select is(ops.check_invitation('{"user": {"email": "%@example.test"}}')->'error'->>'http_code', '403', 'a wildcard is not a match');
select throws_ok($$ insert into ops.invitations (email) values ('Mixed@Case.test') $$, '23514', null, 'invitations are stored in lower case');
-- The hook runs as supabase_auth_admin, a role this suite cannot SET ROLE to (the session role is not a member). Its access is
-- therefore asserted from the catalog here, and the whole path (Auth calling the hook) is exercised against the running stack in
-- workflow/evidence/R2/NOTES.md.
select ok(exists (select 1 from pg_policies where schemaname = 'ops' and tablename = 'invitations' and cmd = 'SELECT'
  and roles = array['supabase_auth_admin']::name[] and qual = 'true'), 'invitations has a select policy for supabase_auth_admin');
select is((select count(*) from pg_policies where schemaname = 'ops'), 1::bigint, 'that is the only policy in ops');
select ok(not (select rolbypassrls from pg_roles where rolname = 'supabase_auth_admin'), 'supabase_auth_admin does not bypass RLS, so the policy is what lets the hook read');
select is(pg_temp.run_as(null, 'anon', $$ select ops.check_invitation('{}') $$), 'err=42501', 'anon cannot run the hook');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', $$ select ops.check_invitation('{}') $$), 'err=42501', 'a signed-in user cannot run the hook');

-- ---- the sign-up trigger -------------------------------------------------------------------------------------------------
create temp table before_counts as select coalesce(sum(n), 0) as n from ops.daily_counts where metric = 'signups' and day = current_date;
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'Invited@Example.test');
select is((select role from app.profiles where id = '44444444-4444-4444-4444-444444444444'), 'consumer', 'sign-up creates a consumer profile');
select is((select age_confirmed or deleting from app.profiles where id = '44444444-4444-4444-4444-444444444444'), false, 'the new profile starts unconfirmed and not deleting');
select isnt((select accepted_at from ops.invitations where email = 'invited@example.test'), null, 'sign-up marks the invitation accepted');
select is((select accepted_at from ops.invitations where email = 'also.invited@example.test'), null, 'other invitations are untouched');
select is((select sum(n) from ops.daily_counts where metric = 'signups' and day = current_date) - (select n from before_counts), 1::bigint, 'sign-up adds 1 to today''s count');
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', null);
select is((select count(*) from app.profiles where id = '55555555-5555-5555-5555-555555555555'), 1::bigint, 'the trigger never refuses a sign-up (even without an email)');
select is((select sum(n) from ops.daily_counts where metric = 'signups' and day = current_date) - (select n from before_counts), 2::bigint, 'the count keeps counting');
select throws_ok($$ insert into ops.daily_counts (day, metric, n) values (current_date, 'logins', 1) $$, '23514', null, 'daily counts accept only signups and deletions');

-- ---- app.complete_onboarding ---------------------------------------------------------------------------------------------
select pg_temp.mk_user('66666666-6666-6666-6666-666666666666');
select is(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'INR', '{Work,Casual}') $$), 'ok', 'a supported country gives ok');
select is((select country || '/' || hemisphere || '/' || currency || '/' || array_to_string(occasions, '+') from app.profiles where id = '66666666-6666-6666-6666-666666666666'),
  'IN/north/INR/Work+Casual', 'the profile fields are stored');
select is(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('us', 'south', 'usd') $$), 'unsupported_country', 'a country that is not on the list gives unsupported_country');
select is((select country || '/' || hemisphere || '/' || currency || '/' || cardinality(occasions) from app.profiles where id = '66666666-6666-6666-6666-666666666666'),
  'US/south/USD/0', 'the declared country is kept, upper-cased, and occasions default to none');
select is(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('FR', 'north', 'EUR') $$), 'unsupported_country', 'another unsupported country');
update ops.settings set value = 'IN,FR' where key = 'supported_countries';
select is(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('FR', 'north', 'EUR') $$), 'ok', 'the supported list is a setting: adding FR makes FR ok');
update ops.settings set value = 'IN' where key = 'supported_countries';
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('India', 'north', 'INR') $$), '%invalid_country', 'a country that is not two letters is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding(null, 'north', 'INR') $$), '%invalid_country', 'a missing country is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('IN', 'east', 'INR') $$), '%invalid_hemisphere', 'a bad hemisphere is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'RUPEE') $$), '%invalid_currency', 'a bad currency is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'INR', '{Karaoke}') $$), '%unknown occasion%', 'an unknown occasion is refused');
select is((select country from app.profiles where id = '66666666-6666-6666-6666-666666666666'), 'FR'::bpchar, 'a refused call changes nothing');
select alike(pg_temp.val_as(null, 'anon', $$ select app.complete_onboarding('IN', 'north', 'INR') $$), 'err=42501%', 'anon cannot complete onboarding');
update app.profiles set role = 'vendor' where id = '66666666-6666-6666-6666-666666666666';
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'INR') $$), 'err=42501: forbidden', 'a vendor cannot use the consumer onboarding');
update app.profiles set role = 'consumer' where id = '66666666-6666-6666-6666-666666666666';
select alike(pg_temp.val_as('77777777-7777-7777-7777-777777777777', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'INR') $$), 'err=42501: forbidden', 'a user without a profile cannot complete onboarding');

-- ---- app.accept_documents ------------------------------------------------------------------------------------------------
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('0', '1', true)::text $$), '%stale_version', 'a stale Terms version is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '0', true)::text $$), '%stale_version', 'a stale Privacy version is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('9', '1', true)::text $$), '%stale_version', 'a FUTURE Terms version is refused (9 while 1 is current)');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '9', true)::text $$), '%stale_version', 'a FUTURE Privacy version is refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents(null, null, true)::text $$), '%stale_version', 'missing versions are refused');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '1', false)::text $$), '%age_not_confirmed', 'without the age tick it raises age_not_confirmed');
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '1', null)::text $$), '%age_not_confirmed', 'a null tick is not a tick');
select is((select count(*) from app.document_acceptances where user_id = '66666666-6666-6666-6666-666666666666'), 0::bigint, 'refused calls write nothing');
select is(pg_temp.run_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '1', true) $$), 'rows=1', 'the current versions with the tick are accepted');
select is((select string_agg(document || ':' || version, ',' order by document) from app.document_acceptances where user_id = '66666666-6666-6666-6666-666666666666'),
  'privacy_policy:1,terms:1', 'both acceptances are stored');
select is((select age_confirmed from app.profiles where id = '66666666-6666-6666-6666-666666666666'), true, 'age_confirmed is set');
select is(pg_temp.run_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '1', true) $$), 'rows=1', 'accepting twice is harmless');
select is((select count(*) from app.document_acceptances where user_id = '66666666-6666-6666-6666-666666666666'), 2::bigint, 'and writes no duplicate');
update ops.settings set value = '2' where key = 'current_terms_version';
select is(pg_temp.run_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('2', '1', true) $$), 'rows=1', 'a new Terms version can be accepted when it is current');
select is((select count(*) from app.document_acceptances where user_id = '66666666-6666-6666-6666-666666666666' and document = 'terms'), 2::bigint, 'the old acceptance is kept as history');
select alike(pg_temp.val_as(null, 'anon', $$ select app.accept_documents('2', '1', true)::text $$), 'err=42501%', 'anon cannot accept documents');
update ops.settings set value = '1' where key = 'current_terms_version';
update app.profiles set role = 'vendor' where id = '66666666-6666-6666-6666-666666666666';
select alike(pg_temp.val_as('66666666-6666-6666-6666-666666666666', 'authenticated', $$ select app.accept_documents('1', '1', true)::text $$), 'err=42501: forbidden', 'a vendor cannot use the consumer acceptance screen');

-- ---- the whole sign-up path ends in an eligible user ------------------------------------------------------------------
select pg_temp.mk_user('88888888-8888-8888-8888-888888888888');
select is(pg_temp.val_as('88888888-8888-8888-8888-888888888888', 'authenticated', 'select app.has_consent()'), 'false', 'a new account is not eligible');
select pg_temp.run_as('88888888-8888-8888-8888-888888888888', 'authenticated', $$ select app.accept_documents('1', '1', true) $$);
select is(pg_temp.val_as('88888888-8888-8888-8888-888888888888', 'authenticated', 'select app.has_consent()'), 'false', 'documents alone are not enough');
select pg_temp.run_as('88888888-8888-8888-8888-888888888888', 'authenticated', $$ insert into app.consent_records (user_id, notice_version) values ('88888888-8888-8888-8888-888888888888', '1') $$);
select is(pg_temp.val_as('88888888-8888-8888-8888-888888888888', 'authenticated', 'select app.has_consent()'), 'false', 'documents and notice are not enough without a country');
select pg_temp.run_as('88888888-8888-8888-8888-888888888888', 'authenticated', $$ select app.complete_onboarding('IN', 'north', 'INR') $$);
select is(pg_temp.val_as('88888888-8888-8888-8888-888888888888', 'authenticated', 'select app.has_consent()'), 'true', 'documents, notice and a supported country make a participant eligible');

-- ---- WO-0042 F1: the role never comes from sign-up metadata (raw_user_meta_data is chosen by the person signing up) ---------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('99999999-0000-0000-0000-000000000001', 'meta1@example.test', '{"role": "admin"}', '{"role": "admin"}'),
  ('99999999-0000-0000-0000-000000000002', 'meta2@example.test', '{"role": "vendor", "age_confirmed": true}', '{}');
select is((select role from app.profiles where id = '99999999-0000-0000-0000-000000000001'), 'consumer', 'sign-up with role admin in the metadata gives a consumer');
select is((select role || age_confirmed::text from app.profiles where id = '99999999-0000-0000-0000-000000000002'), 'consumerfalse', 'sign-up with role vendor and age_confirmed in the metadata gives an unconfirmed consumer');
select is(pg_temp.val_as('99999999-0000-0000-0000-000000000001', 'authenticated', 'select app.current_role()'), 'consumer', 'and the policies see a consumer');

-- ---- WO-0042 F10: invitations hold lower-case printable ASCII only ----------------------------------------------------------
select throws_ok(format('insert into ops.invitations (email) values (%L)', 'caf' || chr(233) || '@example.test'), '23514', null, 'a non-ASCII invitation address is refused');
select throws_ok($$ insert into ops.invitations (email) values ('two words@example.test') $$, '23514', null, 'an address with a space is refused');
select throws_ok($$ insert into ops.invitations (email) values ('') $$, '23514', null, 'an empty address is refused');
select lives_ok($$ insert into ops.invitations (email) values ('plain+tag@example.test') $$, 'a plain lower-case ASCII address is accepted');

select * from finish();
rollback;
