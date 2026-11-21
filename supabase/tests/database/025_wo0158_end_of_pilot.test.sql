-- WO-0158 (R8a) / FR-69, BR-45: the end of the pilot in the database. The setter, the preview, the batch that marks the next participants, the
-- delete of one marked participant, and ops.delete_participant (shared with app.delete_my_account()). Everything runs in this rolled-back
-- transaction. People: E and E2 admins; V1 and V2 vendors; A a consumer who accepted the current notice (with a full set of rows and files);
-- B and C consumers who have not (B sorts before C); X a consumer used for refusals only.
begin;
\ir helpers.inc
select plan(111);

-- a known, empty population (rolled back with the rest): no user, no invitation
delete from auth.users;
delete from ops.invitations;

select pg_temp.mk_user(u) from unnest(array['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
  'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', pg_temp.ua(),
  'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003']::uuid[]) u;
update app.profiles set role = 'admin' where id in ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02');
update app.profiles set role = 'vendor' where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'dddddddd-dddd-dddd-dddd-ddddddddddd2');
select pg_temp.make_eligible(pg_temp.ua());
select pg_temp.seed_user(pg_temp.ua());
create function pg_temp.obj(p_bucket text, p_name text) returns void language sql as
  $f$ insert into storage.objects (bucket_id, name, metadata) values (p_bucket, p_name, jsonb_build_object('size', 10)) $f$;
select pg_temp.obj('item-images', pg_temp.ua()::text || '/p1.webp');
select pg_temp.obj('receipts', pg_temp.ua()::text || '/r.pdf');
select pg_temp.obj('exports', pg_temp.ua()::text || '/e1/part-1.zip');
select pg_temp.obj('item-images', 'dddddddd-dddd-dddd-dddd-ddddddddddd1/v.webp');   -- a vendor's file: never touched
insert into ops.invitations (email, accepted_at) values ('unused1@example.test', null), ('unused2@example.test', null), ('used@example.test', now());

create function pg_temp.sv(p_sql text) returns text language sql as $f$ select pg_temp.val_as(null, 'service_role', p_sql) $f$;
create function pg_temp.setp(p_end text, p_outcome text) returns void language sql as
  $f$ update ops.settings set value = case key when 'pilot_end_date' then p_end else p_outcome end where key in ('pilot_end_date', 'pilot_outcome') $f$;
create function pg_temp.audit_n(p_action text) returns bigint language sql as $f$ select count(*) from ops.admin_audit_log where action = p_action $f$;
create function pg_temp.marked() returns text language sql as
  $f$ select coalesce(string_agg(substr(id::text, 1, 2), ',' order by id), '-') from app.profiles where deleting $f$;
create function pg_temp.set_end(p_date text, p_outcome text) returns text language sql as
  $f$ select pg_temp.sv(format('select app.admin_set_pilot_end(%L, %L::date, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', p_date, p_outcome)) $f$;
create function pg_temp.nxt(p_limit text) returns text language sql as
  $f$ select pg_temp.sv(format('select app.admin_end_pilot_next(%L, %s)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', p_limit)) $f$;
create function pg_temp.del(p_user text) returns text language sql as
  $f$ select pg_temp.sv(format('select app.admin_end_pilot_delete(%L, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', p_user)) $f$;
create function pg_temp.prev() returns jsonb language sql as $f$ select pg_temp.sv('select app.admin_end_pilot_preview()')::jsonb $f$;

-- ---- 1. grant matrix (public, anon, authenticated, service_role) for every new function --------------------------------------------------
create temp table fn (name text primary key, oid oid, want_service boolean);
insert into fn select 'ops.delete_participant', 'ops.delete_participant(uuid)'::regprocedure, false
  union all select 'app.admin_set_pilot_end', 'app.admin_set_pilot_end(uuid,date,text)'::regprocedure, true
  union all select 'app.admin_end_pilot_preview', 'app.admin_end_pilot_preview()'::regprocedure, true
  union all select 'app.admin_end_pilot_next', 'app.admin_end_pilot_next(uuid,int)'::regprocedure, true
  union all select 'app.admin_end_pilot_delete', 'app.admin_end_pilot_delete(uuid,uuid)'::regprocedure, true;
select is((select count(*) from fn), 5::bigint, 'the five new functions exist');
select is_empty($$ select name from fn where has_function_privilege('anon', oid, 'execute') $$, 'FR-69 grants: anon can execute none of the new functions');
select is_empty($$ select name from fn where has_function_privilege('authenticated', oid, 'execute') $$, 'FR-69 grants: authenticated can execute none of them');
select is_empty($$ select f.name from fn f, pg_proc p where p.oid = f.oid and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'FR-69 grants: PUBLIC holds execute on none of them (the acl is explicit)');
select is_empty($$ select name from fn where has_function_privilege('service_role', oid, 'execute') <> want_service $$,
  'FR-69 grants: service_role holds execute on the four admin functions and not on ops.delete_participant');
select is_empty($$ select f.name from fn f, pg_proc p, aclexplode(p.proacl) a where p.oid = f.oid and a.grantee <> p.proowner and a.grantee <> 'service_role'::regrole $$,
  'FR-69 grants: no other role holds execute on any of them');
select is_empty($$ select f.name from fn f, pg_proc p, aclexplode(p.proacl) a where p.oid = f.oid and f.name = 'ops.delete_participant' and a.grantee <> p.proowner $$,
  'FR-69 grants: ops.delete_participant is granted to no role at all (its owner only)');
select is_empty($$ select f.name from fn f join pg_proc p on p.oid = f.oid where not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""'] or pg_get_userbyid(p.proowner) <> 'postgres' $$,
  'FR-69 grants: all five are security definer, pin an empty search_path and are owned by postgres');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select app.admin_end_pilot_next(%L, 5)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')),
  'err=42501: permission denied for function admin_end_pilot_next', 'FR-69 grants: a signed-in person naming the admin cannot run the batch');
select is(pg_temp.val_as(null, 'anon', 'select app.admin_end_pilot_preview()'), 'err=42501: permission denied for function admin_end_pilot_preview', 'FR-69 grants: anon cannot run the preview');
select is(left(pg_temp.val_as(pg_temp.ua(), 'authenticated', format('select ops.delete_participant(%L)', pg_temp.ub())), 9), 'err=42501',
  'FR-69 grants: a signed-in person cannot call ops.delete_participant');
select ok(has_function_privilege('authenticated', 'app.delete_my_account()', 'execute') and not has_function_privilege('anon', 'app.delete_my_account()', 'execute')
  and not has_function_privilege('service_role', 'app.delete_my_account()', 'execute') and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.delete_my_account()'::regprocedure),
  'FR-69 grants: app.delete_my_account keeps its grants, definer and empty search_path');

-- ---- 2. the setter ----------------------------------------------------------------------------------------------------------------------
create temp table a0 as select pg_temp.audit_n('pilot.set_end') as n;
select is(pg_temp.sv(format('select app.admin_set_pilot_end(%L, current_date + 3, %L)', pg_temp.ua(), 'close')), 'err=42501: forbidden', 'FR-69 setter refused for a consumer');
select is(pg_temp.sv(format('select app.admin_set_pilot_end(%L, current_date + 3, %L)', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'close')), 'err=42501: forbidden', 'FR-69 setter refused for a vendor');
select is(pg_temp.sv('select app.admin_set_pilot_end(null, current_date + 3, ''close'')'), 'err=42501: forbidden', 'FR-69 setter refused with no admin id');
select is(pg_temp.set_end(to_char(current_date + 3, 'YYYY-MM-DD'), 'maybe'), 'err=22023: invalid_outcome', 'FR-69 setter refuses an outcome that is neither close nor continue');
select is(pg_temp.set_end(to_char(current_date + 3, 'YYYY-MM-DD'), 'Close'), 'err=22023: invalid_outcome', 'FR-69 setter refuses a wrong-case outcome');
select is(pg_temp.sv(format('select app.admin_set_pilot_end(%L, current_date + 3, null)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), 'err=22023: invalid_outcome', 'FR-69 setter refuses a null outcome');
select is(pg_temp.set_end(to_char(current_date - 1, 'YYYY-MM-DD'), 'close'), 'err=22023: invalid_end_date', 'FR-69 setter refuses a past date when the stored date is empty (the date would change)');
select is(pg_temp.sv(format('select app.admin_set_pilot_end(%L, null, %L)', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'close')), 'err=22023: invalid_end_date', 'FR-69 setter refuses a null date');
select is((select value from ops.settings where key = 'pilot_end_date') || '|' || (select value from ops.settings where key = 'pilot_outcome'), '|', 'and the refused calls wrote nothing');
select is(pg_temp.audit_n('pilot.set_end') - (select n from a0), 0::bigint, 'and no audit row');
select is(pg_temp.set_end(to_char(current_date + 3, 'YYYY-MM-DD'), 'continue')::jsonb, jsonb_build_object('pilot_end_date', to_char(current_date + 3, 'YYYY-MM-DD'), 'pilot_outcome', 'continue'),
  'FR-69 setter accepts a future date with the outcome continue and returns the new values');
select is((select value from ops.settings where key = 'pilot_end_date') || '|' || (select value from ops.settings where key = 'pilot_outcome'),
  to_char(current_date + 3, 'YYYY-MM-DD') || '|continue', 'and stored them');
select is((select count(*) from ops.admin_audit_log where action = 'pilot.set_end' and admin_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  and target = to_char(current_date + 3, 'YYYY-MM-DD') || ':continue'), 1::bigint, 'FR-69 setter wrote one audit row with the action and the new values');
select is(pg_temp.audit_n('pilot.set_end') - (select n from a0), 1::bigint, 'and only that one');
select is((select count(*) from ops.admin_audit_log where target like '%@%'), 0::bigint, 'and no audit row holds an email address');
select is(pg_temp.set_end(to_char(current_date - 1, 'YYYY-MM-DD'), 'close'), 'err=22023: invalid_end_date', 'FR-69 setter refuses CHANGING the date to a past date');
select is((select value from ops.settings where key = 'pilot_end_date'), to_char(current_date + 3, 'YYYY-MM-DD'), 'and the stored date is unchanged');
select is(pg_temp.set_end(to_char(current_date, 'YYYY-MM-DD'), 'close')::jsonb ->> 'pilot_outcome', 'close', 'FR-69 setter accepts today as the new date');
-- the pilot has ended: yesterday is the stored date
select pg_temp.setp(to_char(current_date - 2, 'YYYY-MM-DD'), 'continue');
select is(pg_temp.set_end(to_char(current_date - 2, 'YYYY-MM-DD'), 'close')::jsonb ->> 'pilot_outcome', 'close', 'FR-69 the outcome alone can be changed after the end date (the date is unchanged)');
select is(pg_temp.set_end(to_char(current_date - 2, 'YYYY-MM-DD'), 'continue')::jsonb ->> 'pilot_outcome', 'continue', 'and changed back');
select is(pg_temp.set_end(to_char(current_date - 3, 'YYYY-MM-DD'), 'continue'), 'err=22023: invalid_end_date', 'FR-69 but a different past date is refused');
select is((select value from ops.settings where key = 'pilot_end_date'), to_char(current_date - 2, 'YYYY-MM-DD'), 'and the stored date is unchanged');

-- ---- 3. the preview (read-only) ------------------------------------------------------------------------------------------------------------
create temp table snap as select (select count(*) from app.profiles where deleting) as marked, (select count(*) from ops.admin_audit_log) as audits,
  (select count(*) from auth.users) as users, (select count(*) from ops.invitations) as invs;
select is(pg_temp.prev(), '{"vendor_users": 0, "unused_invitations": 2, "consumers_to_delete": 3}'::jsonb, 'FR-69 preview, continue: consumers without the current notice (A has it), unused invitations, no vendor');
select pg_temp.setp(to_char(current_date - 2, 'YYYY-MM-DD'), 'close');
select is(pg_temp.prev(), '{"vendor_users": 2, "unused_invitations": 2, "consumers_to_delete": 4}'::jsonb, 'FR-69 preview, close: every consumer, every vendor user, unused invitations');
select pg_temp.setp(to_char(current_date - 2, 'YYYY-MM-DD'), '');
select is(pg_temp.prev(), '{"vendor_users": 2, "unused_invitations": 2, "consumers_to_delete": 4, "outcome_unset": true}'::jsonb, 'FR-69 preview with no outcome: the same counts with outcome_unset');
select is((select count(*) from app.profiles where deleting) || '|' || (select count(*) from ops.admin_audit_log) || '|' || (select count(*) from auth.users) || '|' || (select count(*) from ops.invitations),
  (select marked || '|' || audits || '|' || users || '|' || invs from snap), 'FR-69 the preview changed nothing: no mark, no audit row, no user, no invitation');
select ok((select provolatile = 's' from pg_proc where oid = 'app.admin_end_pilot_preview()'::regprocedure), 'and it is declared stable (read-only)');

-- ---- 4. refusals of the batch and of the delete ---------------------------------------------------------------------------------------------
select is(pg_temp.nxt('5'), 'err=55000: outcome_unset', 'FR-69 batch refused while no outcome is set');
select pg_temp.setp(to_char(current_date + 1, 'YYYY-MM-DD'), 'close');
select is(pg_temp.nxt('5'), 'err=55000: pilot_not_ended', 'FR-69 batch refused before the end date');
select pg_temp.setp('', '');
select is(pg_temp.nxt('5'), 'err=55000: pilot_not_ended', 'FR-69 batch refused with no end date at all');
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'close');
select is(pg_temp.nxt('0'), 'err=22023: invalid_limit', 'FR-69 batch refuses a limit of 0');
select is(pg_temp.nxt('101'), 'err=22023: invalid_limit', 'FR-69 batch refuses a limit of 101');
select is(pg_temp.nxt('null'), 'err=22023: invalid_limit', 'FR-69 batch refuses a null limit');
select is(pg_temp.sv(format('select app.admin_end_pilot_next(%L, 5)', pg_temp.ua())), 'err=42501: forbidden', 'FR-69 batch refused for a consumer');
select is(pg_temp.sv(format('select app.admin_end_pilot_next(%L, 5)', 'dddddddd-dddd-dddd-dddd-ddddddddddd1')), 'err=42501: forbidden', 'FR-69 batch refused for a vendor');
select is(pg_temp.marked(), '-', 'FR-69 no refused batch call marked anyone');
select is(pg_temp.del('b0000000-0000-4000-8000-000000000001'), 'err=55000: not_marked', 'FR-69 delete refused for a consumer who was never marked');
update app.profiles set deleting = true, deletion_requested_at = now() where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02');   -- marked on purpose: only the role can refuse them
select is(pg_temp.del('dddddddd-dddd-dddd-dddd-ddddddddddd1'), 'err=55000: not_marked', 'FR-69 delete refused for a vendor, even one carrying a mark');
select is(pg_temp.del('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02'), 'err=55000: not_marked', 'FR-69 delete refused for an admin, even one carrying a mark');
update app.profiles set deleting = false, deletion_requested_at = null where id in ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02');
select is(pg_temp.del('99999999-0000-4000-8000-0000000000ff'), 'err=55000: not_marked', 'FR-69 delete refused for an id that is no user');
select is(pg_temp.sv(format('select app.admin_end_pilot_delete(%L, %L)', pg_temp.ua(), 'b0000000-0000-4000-8000-000000000001')), 'err=42501: forbidden', 'FR-69 delete refused for a non-admin caller');
select is((select count(*) from auth.users), (select users from snap), 'FR-69 and no user was deleted by the refused calls');
-- a marked consumer is still not deleted before the end date or with no outcome
update app.profiles set deleting = true, deletion_requested_at = now() where id = 'f0000000-0000-4000-8000-000000000003';
select pg_temp.setp(to_char(current_date + 1, 'YYYY-MM-DD'), 'close');
select is(pg_temp.del('f0000000-0000-4000-8000-000000000003'), 'err=55000: not_marked', 'FR-69 delete refused for a marked user before the end date');
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), '');
select is(pg_temp.del('f0000000-0000-4000-8000-000000000003'), 'err=55000: not_marked', 'FR-69 delete refused for a marked user while no outcome is set');
update app.profiles set deleting = false, deletion_requested_at = null where id = 'f0000000-0000-4000-8000-000000000003';
select is(pg_temp.marked(), '-', 'the test mark is removed again');

-- ---- 5. outcome continue: only consumers without the current notice, ones already marked first ---------------------------------------------------
create temp table dc0 as select coalesce((select n from ops.daily_counts where metric = 'deletions' and day = current_date), 0) as n;
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'continue');
select is(pg_temp.nxt('1')::jsonb, '{"user_ids": ["b0000000-0000-4000-8000-000000000001"], "remaining": 2, "done": false, "invitations_deleted": 0}'::jsonb, 'FR-69 continue: a batch of 1 marks the first consumer without the current notice and counts the rest');
select is(pg_temp.marked(), 'b0', 'and only that one is marked');
select ok((select deletion_requested_at is not null and deletion_requested_at >= now() - interval '1 minute' from app.profiles where id = 'b0000000-0000-4000-8000-000000000001'), 'with deletion_requested_at set');
select is(pg_temp.nxt('2')::jsonb, '{"user_ids": ["b0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002"], "remaining": 1, "done": false, "invitations_deleted": 0}'::jsonb,
  'FR-69 the next batch hands out the already marked user first, then the next one');
select is(pg_temp.marked(), 'b0,c0', 'FR-69 continue marks consumers without the notice; A (has it), the vendors and the admins are not marked');
select is(pg_temp.nxt('100')::jsonb, '{"user_ids": ["b0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002", "f0000000-0000-4000-8000-000000000003"], "remaining": 0, "done": false, "invitations_deleted": 0}'::jsonb,
  'FR-69 a batch of 100 covers all three and leaves none');
select is(pg_temp.marked(), 'b0,c0,f0', 'and A, the vendors and the admins still are not marked');
select is(pg_temp.audit_n('pilot.end_next'), 3::bigint, 'FR-69 each batch call wrote one audit row');
select is((select string_agg(target, ',' order by id) from ops.admin_audit_log where action = 'pilot.end_next'), '1,2,3', 'with the count of ids as the target');
-- C has accepted the current notice since being marked (a stale mark): the delete re-applies the selection rule and keeps C
insert into app.consent_records (user_id, notice_version) values ('c0000000-0000-4000-8000-000000000002', (select value from ops.settings where key = 'current_notice_version'));
select is(pg_temp.del('c0000000-0000-4000-8000-000000000002')::jsonb ->> 'deleted', 'false', '(Re-check D) continue: a marked user who accepted the current notice since is not deleted');
select is((select deleting::text || '|' || coalesce(deletion_requested_at::text, 'null') from app.profiles where id = 'c0000000-0000-4000-8000-000000000002'), 'false|null', 'and is unmarked');
select is(pg_temp.del('c0000000-0000-4000-8000-000000000002'), 'err=55000: not_marked', 'with not_marked, since C is no longer marked');
select is((select count(*) from auth.users where id = 'c0000000-0000-4000-8000-000000000002'), 1::bigint, 'and C is still there with all its rows');
select is(pg_temp.del('b0000000-0000-4000-8000-000000000001')::jsonb ->> 'deleted', 'true', 'FR-69 continue: B, marked and without the current notice, is deleted');
select is((select count(*) from auth.users where id = 'b0000000-0000-4000-8000-000000000001'), 0::bigint, 'B is gone from auth.users');
select is(pg_temp.del('b0000000-0000-4000-8000-000000000001'), 'err=55000: not_marked', 'a call on a deleted participant deletes nothing');
select is((select count(*) from ops.invitations where accepted_at is null), 2::bigint, 'FR-69 the unused invitations are kept while a marked consumer is left');
select is(pg_temp.del('f0000000-0000-4000-8000-000000000003')::jsonb, '{"deleted": true, "unmarked": false, "done": true, "invitations_deleted": 2}'::jsonb,
  'FR-69 the last deletion reports done and the two unused invitations deleted');
select is((select string_agg(email, ',') from ops.invitations), 'used@example.test', 'FR-69 unused invitations are deleted at the end, used ones are kept');
select is((select count(*) from app.profiles where role = 'consumer'), 2::bigint, 'A and C remain (both have the current notice); nothing else of the consumers');
select is((select count(*) from app.profiles where role in ('vendor', 'admin')), 4::bigint, 'FR-69 vendors and admins were not touched by the continue outcome');
select is(pg_temp.nxt('100')::jsonb, '{"user_ids": [], "remaining": 0, "done": true, "invitations_deleted": 0}'::jsonb, 'FR-69 a batch call after the end finds nothing left');
select is(pg_temp.marked(), '-', 'and marks nobody');
select is((select n from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from dc0), 2, 'each deletion was counted once in ops.daily_counts');
select is(pg_temp.audit_n('pilot.end_done'), 1::bigint, 'one audit row for the completed end');

-- ---- 6. outcome close: every consumer, the cascade of a participant's rows and files -----------------------------------------------------------
select is(pg_temp.set_end(to_char(current_date, 'YYYY-MM-DD'), 'close')::jsonb ->> 'pilot_outcome', 'close', 'the outcome is changed to close on the end date itself');
select is(pg_temp.prev(), '{"vendor_users": 2, "unused_invitations": 0, "consumers_to_delete": 2}'::jsonb, 'FR-69 preview, close, after the continue run: both remaining consumers');
select is(pg_temp.nxt('1')::jsonb, '{"user_ids": ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"], "remaining": 1, "done": false, "invitations_deleted": 0}'::jsonb, 'FR-69 close marks a consumer WITH the current notice too (A first)');
select is(pg_temp.nxt('100')::jsonb ->> 'remaining', '0', 'and then everyone else');
select is(pg_temp.marked(), 'aa,c0', 'FR-69 close marks every consumer; vendors and admins are never marked');
create temp table before_a as select
  (select count(*) from app.items where user_id = pg_temp.ua()) as items, (select count(*) from app.consent_records where user_id = pg_temp.ua()) as consent,
  (select count(*) from app.document_acceptances where user_id = pg_temp.ua()) as docs, (select count(*) from app.jobs where user_id = pg_temp.ua()) as jobs,
  (select count(*) from storage.objects where (storage.foldername(name))[1] = pg_temp.ua()::text) as objs;
select ok((select items > 0 and consent > 0 and docs > 0 and jobs > 0 and objs = 3 from before_a), 'A has items, consent rows, document acceptances, a job and three storage objects before the delete');
select is(pg_temp.del(pg_temp.ua()::text)::jsonb, '{"deleted": true, "unmarked": false, "done": false, "invitations_deleted": 0}'::jsonb, 'FR-69 A is deleted and the batch is not done while C is left');
select is((select count(*) from app.items where user_id = pg_temp.ua()) + (select count(*) from app.consent_records where user_id = pg_temp.ua())
  + (select count(*) from app.document_acceptances where user_id = pg_temp.ua()) + (select count(*) from app.jobs where user_id = pg_temp.ua())
  + (select count(*) from app.profiles where id = pg_temp.ua()), 0::bigint, 'FR-69 a deleted participant''s items, consent rows, acceptances, jobs and profile are gone (cascade)');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = pg_temp.ua()::text), 0::bigint, 'FR-69 and so are the storage object rows, in every bucket');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'), 1::bigint, 'while a vendor''s object row is untouched');
select is(current_setting('storage.allow_delete_query', true), 'false', 'and the storage delete switch is back to false');
select is(pg_temp.del('c0000000-0000-4000-8000-000000000002')::jsonb ->> 'done', 'true', 'FR-69 the last consumer deleted under close reports done');
select is((select count(*) from app.profiles where role = 'consumer'), 0::bigint, 'FR-69 no consumer is left');
select is((select count(*) from app.profiles where role in ('vendor', 'admin') and not deleting), 4::bigint, 'FR-69 the vendors and admins are all still there and unmarked (the vendor part is WO-0159)');
select is(pg_temp.nxt('100')::jsonb, '{"user_ids": [], "remaining": 0, "done": true, "invitations_deleted": 0}'::jsonb, 'FR-69 a call after the end changes nothing');

-- ---- 6b. the end with no consumer left to delete: next finishes the end itself; an empty current notice version is refused -------------------------------
-- everyone has accepted the current notice under continue (only the vendors and admins are left, plus new unused and used invitations)
insert into ops.invitations (email, accepted_at) values ('late1@example.test', null), ('late2@example.test', null), ('late3@example.test', null);
select pg_temp.setp(to_char(current_date, 'YYYY-MM-DD'), 'continue');
select pg_temp.mk_user('a1000000-0000-4000-8000-0000000000e1');
select pg_temp.make_eligible('a1000000-0000-4000-8000-0000000000e1');
create temp table ed0 as select pg_temp.audit_n('pilot.end_done') as n;
select is(pg_temp.nxt('10')::jsonb, '{"user_ids": [], "remaining": 0, "done": true, "invitations_deleted": 3}'::jsonb,
  'FR-69 continue, everyone accepted: the batch finds nobody, reports done and deletes the unused invitations');
select is((select string_agg(email, ',') from ops.invitations), 'used@example.test', 'FR-69 and the used invitation is kept');
select is(pg_temp.audit_n('pilot.end_done') - (select n from ed0), 1::bigint, 'FR-69 and one pilot.end_done audit row was written');
select is(pg_temp.nxt('10')::jsonb, '{"user_ids": [], "remaining": 0, "done": true, "invitations_deleted": 0}'::jsonb, 'FR-69 a second empty call deletes nothing more');
select is(pg_temp.audit_n('pilot.end_done') - (select n from ed0), 1::bigint, 'and writes no second pilot.end_done row');
select is(pg_temp.nxt('10')::jsonb ->> 'done', 'true', 'and still says done');
-- an empty current notice version: refused under continue, by both functions; close is not affected
update app.profiles set deleting = true, deletion_requested_at = now() where id = 'a1000000-0000-4000-8000-0000000000e1';
update ops.settings set value = '' where key = 'current_notice_version';
select is(pg_temp.nxt('10'), 'err=55000: notice_unset', 'FR-69 continue with no current notice version: the batch is refused (it would select every consumer)');
select is(pg_temp.del('a1000000-0000-4000-8000-0000000000e1'), 'err=55000: notice_unset', 'and so is the delete');
select is((select count(*) from auth.users where id = 'a1000000-0000-4000-8000-0000000000e1'), 1::bigint, 'and nobody was deleted');
delete from ops.settings where key = 'current_notice_version';
select is(pg_temp.nxt('10'), 'err=55000: notice_unset', 'FR-69 also when the setting row is missing');
update ops.settings set value = '1' where key = 'current_notice_version';
insert into ops.settings (key, value) values ('current_notice_version', '1') on conflict (key) do nothing;
update app.profiles set deleting = false, deletion_requested_at = null where id = 'a1000000-0000-4000-8000-0000000000e1';

-- ---- 7. ops.delete_participant itself -----------------------------------------------------------------------------------------------------------
select pg_temp.mk_user('99999999-0000-4000-8000-0000000000d1');
insert into ops.invitations (email, accepted_at) values ('99999999-0000-4000-8000-0000000000d1@example.test', now());
select is(ops.delete_participant('99999999-0000-4000-8000-0000000000d1'), 'deleted', 'ops.delete_participant deletes a user');
select is((select count(*) from ops.invitations where email like '99999999-0000-4000-8000-0000000000d1%'), 0::bigint, 'and that user''s invitation row');
select is(ops.delete_participant('99999999-0000-4000-8000-0000000000d1'), 'already_deleted', 'a second call answers already_deleted');
select is(ops.delete_participant(null), 'already_deleted', 'a null id deletes nothing');

select * from finish();
rollback;
