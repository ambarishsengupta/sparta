-- WO-0130 (A13) part 2: app.rate_limit_hit and ops.rate_limit_windows, the count that every server instance shares. Synthetic and rolled back.
-- The caller is the secret-key client (service_role), as in the routes; two "instances" are two separate role switches that share only the database.
begin;
\ir helpers.inc
select plan(30);

create function pg_temp.hit(p_role text, p_bucket text, p_max int, p_window int) returns text language sql as
  $f$ select pg_temp.val_as(null, p_role, format('select app.rate_limit_hit(%L, %s, %s)', p_bucket, p_max, p_window)) $f$;
create function pg_temp.hits(p_bucket text) returns bigint language sql stable as $f$ select coalesce(sum(hits), 0) from ops.rate_limit_windows where bucket = p_bucket $f$;

-- the table: deny by default
select has_table('ops', 'rate_limit_windows', 'ops.rate_limit_windows exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.rate_limit_windows'::regclass), 'row-level security is enabled and forced');
select ok(not has_table_privilege('anon', 'ops.rate_limit_windows', 'select,insert,update,delete,truncate,references,trigger'), 'anon has no privilege on the table');
select ok(not has_table_privilege('authenticated', 'ops.rate_limit_windows', 'select,insert,update,delete,truncate,references,trigger'), 'authenticated has no privilege on the table');
select ok(not has_table_privilege('service_role', 'ops.rate_limit_windows', 'select,insert,update,delete,truncate,references,trigger'), 'service_role has no direct privilege on the table (only the function touches it)');
select is(pg_temp.run_as(null, 'authenticated', 'select * from ops.rate_limit_windows'), 'err=42501', 'authenticated can not read the table');
select is(pg_temp.run_as(null, 'service_role', 'insert into ops.rate_limit_windows values (''x'', now(), 1)'), 'err=42501', 'service_role can not write the table directly');

-- the function: one, security definer, search_path pinned, executable by service_role only
create temp table fn as select p.oid, p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'rate_limit_hit';
select is((select count(*) from fn), 1::bigint, 'app.rate_limit_hit exists once');
select ok((select prosecdef from fn), 'it is security definer');
select is((select proconfig from fn), array['search_path=""'], 'its search_path is pinned to empty');
select ok(not has_function_privilege('anon', (select oid from fn), 'execute') and not has_function_privilege('authenticated', (select oid from fn), 'execute'), 'anon and authenticated can not execute it');
select ok(not has_function_privilege('public', (select oid from fn), 'execute'), 'public can not execute it');
select ok(has_function_privilege('service_role', (select oid from fn), 'execute'), 'service_role can execute it');
select matches(pg_temp.hit('authenticated', 'worker.ok', 5, 60), '^err=42501', 'a signed-in user calling it is refused');
select matches(pg_temp.hit('anon', 'worker.ok', 5, 60), '^err=42501', 'anon calling it is refused');

-- the count: the first p_max calls pass, the next are refused, in the order they arrive
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'true', 'call 1 of 3 passes');
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'true', 'call 2 of 3 passes (a second instance, same database)');
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'true', 'call 3 of 3 passes');
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'false', 'call 4 is refused');
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'false', 'call 5 is refused as well');
select is(pg_temp.hits('test.limit'), 5::bigint, 'refused calls are counted too');
select is(pg_temp.hit('service_role', 'test.other', 3, 3600), 'true', 'another bucket has its own count');

-- a new window starts a new count
update ops.rate_limit_windows set window_start = window_start - interval '2 hours' where bucket = 'test.limit';
select is(pg_temp.hit('service_role', 'test.limit', 3, 3600), 'true', 'in the next window the bucket is open again');
select is((select count(*) from ops.rate_limit_windows where bucket = 'test.limit'), 2::bigint, 'and the old window is a row of its own');

-- old windows are cleaned up on the way
insert into ops.rate_limit_windows values ('test.old', now() - interval '3 days', 9);
select pg_temp.hit('service_role', 'test.clean', 3, 60);
select is(pg_temp.hits('test.old'), 0::bigint, 'a window older than one day is deleted by the next call');

-- bad arguments raise and count nothing
select matches(pg_temp.hit('service_role', 'Bad Bucket', 3, 60), '^err=22023', 'a bucket with capitals or spaces is refused');
select matches(pg_temp.val_as(null, 'service_role', 'select app.rate_limit_hit(null, 3, 60)'), '^err=22023', 'a null bucket is refused');
select matches(pg_temp.hit('service_role', 'test.bad', 0, 60), '^err=22023', 'a limit of 0 is refused');
select matches(pg_temp.hit('service_role', 'test.bad', 3, 0), '^err=22023', 'a window of 0 seconds is refused');
select is(pg_temp.hits('test.bad'), 0::bigint, 'none of those counted anything');

select * from finish();
rollback;
