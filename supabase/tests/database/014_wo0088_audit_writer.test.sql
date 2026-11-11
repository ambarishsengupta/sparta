-- WO-0088 (R6c) / CC9: app.write_admin_audit, the only writer of ops.admin_audit_log (LLD 4.1, 6).
-- Users: E admin, A consumer, D vendor. Everything runs in this rolled-back transaction.
begin;
\ir helpers.inc
select plan(33);

select pg_temp.mk_user(u) from unnest(array[pg_temp.ua(), 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[]) u;
update app.profiles set role = 'vendor' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
update app.profiles set role = 'admin' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
create temp table fn as select p.oid from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'write_admin_audit';
create function pg_temp.w(p_role text, p_admin text, p_action text, p_target text) returns text language sql as
  $f$ select pg_temp.val_as(null, p_role, format('select app.write_admin_audit(%L::uuid, %L, %L)', p_admin, p_action, p_target)) $f$;
create function pg_temp.n() returns bigint language sql as $f$ select count(*) from ops.admin_audit_log $f$;

-- ---- the function: one, definer, empty search_path, postgres-owned, service_role only --------------------------------------
select is((select count(*) from fn), 1::bigint, 'app.write_admin_audit exists once');
select is((select pg_get_function_identity_arguments(oid) from fn), 'p_admin uuid, p_action text, p_target text', 'its arguments are an admin id, an action and a target');
select is((select prorettype::regtype::text from pg_proc where oid = (select oid from fn)), 'bigint', 'it returns the new row id only');
select ok((select prosecdef from pg_proc where oid = (select oid from fn)), 'it is security definer');
select ok((select coalesce(proconfig, '{}') @> array['search_path=""'] from pg_proc where oid = (select oid from fn)), 'it pins an empty search_path');
select is((select pg_get_userbyid(proowner) from pg_proc where oid = (select oid from fn)), 'postgres', 'it is owned by postgres');
select ok(has_function_privilege('service_role', (select oid from fn), 'execute'), 'service_role can execute it');
select is_empty($$ select r from unnest(array['anon', 'authenticated', 'worker_role', 'collector_role']) r where has_function_privilege(r, (select oid from fn), 'execute') $$, 'anon, authenticated, worker_role and collector_role cannot');
select is_empty($$ select a.grantee::regrole::text from pg_proc p, aclexplode(p.proacl) a where p.oid = (select oid from fn) and a.grantee <> p.proowner and a.grantee <> 'service_role'::regrole $$, 'no other role, and not PUBLIC, holds execute (the acl is explicit)');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.write_admin_audit(''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'', ''source.list'', null)'), 'err=42501: permission denied for function write_admin_audit', 'a signed-in person (even naming the admin) cannot call it');
select is(pg_temp.val_as(null, 'anon', 'select app.write_admin_audit(''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'', ''source.list'', null)'), 'err=42501: permission denied for function write_admin_audit', 'anon cannot call it');
select ok(not (select p.prosrc ~* 'select\s+.*from\s+ops\.admin_audit_log' from pg_proc p where oid = (select oid from fn)), 'it never reads the log back');

-- ---- a good call writes exactly one row, with the admin, the action and the target ------------------------------------------
select is(pg_temp.w('service_role', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.create', null) ~ '^[0-9]+$', true, 'an admin id with a dotted action and no target is accepted and returns the row id');
select is(pg_temp.n(), 1::bigint, 'and wrote exactly one row');
select is((select admin_id::text || '|' || action || '|' || coalesce(target, '-') from ops.admin_audit_log), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee|source.create|-', 'with the admin, the action and a null target');
select is(pg_temp.w('service_role', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'catalog.review.update', '7f3a:+_-9') ~ '^[0-9]+$', true, 'a three-part action and a target made of id characters are accepted');
select is((select target from ops.admin_audit_log order by id desc limit 1), '7f3a:+_-9', 'the target is stored as given');
select is((select at between now() - interval '1 minute' and now() + interval '1 minute' from ops.admin_audit_log order by id desc limit 1), true, 'the time is now');

-- ---- refusals write nothing ---------------------------------------------------------------------------------------------------
create temp table bad (n int, who text, act text, tgt text, expect text, label text);
insert into bad values
  (1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'source.list', null, 'err=42501: forbidden', 'a vendor id is refused'),
  (2, '00000000-0000-4000-8000-0000000000aa', 'source.list', null, 'err=42501: forbidden', 'an unknown id is refused'),
  (3, null, 'source.list', null, 'err=42501: forbidden', 'a null admin id is refused'),
  (4, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Source.List', null, 'err=22023: invalid_audit_action', 'an upper-case action is refused'),
  (5, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'list', null, 'err=22023: invalid_audit_action', 'an action without a dot is refused'),
  (6, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list now', null, 'err=22023: invalid_audit_action', 'an action with a space is refused'),
  (7, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.takedown ann@example.test', null, 'err=22023: invalid_audit_action', 'free text with an email in the action is refused'),
  (8, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', null, null, 'err=22023: invalid_audit_action', 'a null action is refused'),
  (9, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a.' || repeat('b', 40), null, 'err=22023: invalid_audit_action', 'an over-long word in the action is refused'),
  (10, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list', 'ann@example.test', 'err=22023: invalid_audit_target', 'an email as target is refused'),
  (11, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list', 'removed because they asked', 'err=22023: invalid_audit_target', 'free text as target is refused'),
  (12, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list', repeat('9', 65), 'err=22023: invalid_audit_target', 'a 65-character target is refused'),
  (13, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list', '', 'err=22023: invalid_audit_target', 'an empty target is refused');
select is(pg_temp.w('service_role', who, act, tgt), expect, label) from bad order by n;
select is(pg_temp.n(), 2::bigint, 'none of the refused calls wrote a row (two rows from the good calls remain)');
select is(pg_temp.w('service_role', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'source.list', repeat('9', 64)) ~ '^[0-9]+$', true, 'a 64-character target is the longest accepted');

select * from finish();
rollback;
