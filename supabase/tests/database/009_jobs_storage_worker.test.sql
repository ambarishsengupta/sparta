-- WO-0070 (R5b) / CC2: app.jobs (owner-only RLS, consent gate, input check, rate limit, status machine), the claim and reaper functions,
-- worker_role (exactly LLD 7.1, read from the catalog and exercised), the storage buckets and owner-folder policies, and the storage and
-- jobs part of app.delete_my_account(). The two-connection claim race is in workflow/gates/db_tests.test.ts (pgTAP is one session).
begin;
\ir helpers.inc
select plan(297);   -- WO-0080: two more app tables, each with one "the worker cannot read" assertion

-- the session role (postgres) may become worker_role only inside this rolled-back transaction, to exercise its rights
grant worker_role to postgres with set true, inherit false;

create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return 'err=' || sqlstate; end $f$;
create function pg_temp.mkjob(p_uid uuid) returns bigint language plpgsql as $f$
declare i bigint;
begin
  insert into app.jobs (user_id, type, input) values (p_uid, 'photo', jsonb_build_object('path', p_uid::text || '/' || gen_random_uuid()::text || '.webp')) returning id into i;
  return i;
end $f$;
create function pg_temp.st(p_id bigint) returns text language sql as
  $f$ select status || '/' || attempts || '/' || coalesce(last_error, '-') from app.jobs where id = p_id $f$;
create function pg_temp.upd(p_id bigint, p_set text) returns text language sql as
  $f$ select pg_temp.try(format('update app.jobs set %s where id = %s', p_set, p_id)) $f$;
create function pg_temp.obj(p_bucket text, p_name text, p_size bigint) returns void language sql as
  $f$ insert into storage.objects (bucket_id, name, metadata) values (p_bucket, p_name, jsonb_build_object('size', p_size)) $f$;

select pg_temp.mk_user(pg_temp.ua());
select pg_temp.mk_user(pg_temp.ub());
select pg_temp.mk_user('cccccccc-cccc-cccc-cccc-cccccccccccc');   -- C: no consent
select pg_temp.mk_user('dddddddd-dddd-dddd-dddd-dddddddddddd');   -- D: vendor
select pg_temp.mk_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');   -- E: rate limit
select pg_temp.mk_user('ffffffff-ffff-ffff-ffff-ffffffffffff');   -- F: quota
select pg_temp.make_eligible(u) from unnest(array[pg_temp.ua(), pg_temp.ub(), 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff']::uuid[]) u;
update app.profiles set role = 'vendor' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- ======== 1. the table ==========================================================================================================
select has_table('app', 'jobs', 'app.jobs exists');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'app' and table_name = 'jobs'),
  array['id','user_id','type','status','input','result','attempts','last_error','run_after','created_at','started_at','finished_at'], 'jobs has the LLD 7.2 columns');
select ok((select is_identity = 'YES' from information_schema.columns where table_schema = 'app' and table_name = 'jobs' and column_name = 'id'), 'jobs.id is an identity column');
select is((select confdeltype::text from pg_constraint where conrelid = 'app.jobs'::regclass and contype = 'f' and confrelid = 'app.profiles'::regclass), 'c', 'jobs.user_id references profiles on delete cascade');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app.jobs'::regclass), 'RLS is enabled and forced on jobs');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and tablename = 'jobs' and indexdef ~ '\(status, run_after, id\) WHERE \(status = ''queued''::text\)'), 'the claim index is partial on queued');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'jobs'), 'jobs is in the supabase_realtime publication');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{"path":"x"}') $$), 'ok', 'the table itself does not check paths (the policy does); a valid object is accepted');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'video', '{}') $$), 'err=23514', 'an unknown job type is refused');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '[]') $$), 'err=23514', 'an input that is not an object is refused');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', jsonb_build_object('path', repeat('x', 5000))) $$), 'err=23514', 'an input over 4096 bytes is refused');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, attempts) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 4) $$), 'err=23514', 'attempts above 3 are refused');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 'weird') $$), 'err=23514', 'an unknown status is refused');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, last_error) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', repeat('e', 501)) $$), 'err=23514', 'a last_error over 500 bytes is refused');

-- ======== 2. what a client can do ===============================================================================================
select ok(has_table_privilege('authenticated', 'app.jobs', 'select') and not has_table_privilege('authenticated', 'app.jobs', 'update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated', 'app.jobs', 'insert'), 'authenticated: select only at table level');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'app.jobs'::regclass and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('authenticated', 'app.jobs', a.attname, 'insert')), array['input','type','user_id'], 'authenticated may insert exactly user_id, type and input');
select is((select count(*) from pg_attribute a where a.attrelid = 'app.jobs'::regclass and a.attnum > 0 and not a.attisdropped
  and has_column_privilege('authenticated', 'app.jobs', a.attname, 'update')), 0::bigint, 'authenticated may update no column');
select ok(not has_any_column_privilege('anon', 'app.jobs', 'select,insert,update,references') and not has_table_privilege('anon', 'app.jobs', 'delete,truncate,trigger'), 'anon has no privilege on jobs');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'app' and tablename = 'jobs' and roles = array['authenticated']::name[]),
  array['jobs_insert:INSERT', 'jobs_select:SELECT'], 'authenticated has exactly a select and an insert policy on jobs');
select ok((select qual ~ 'has_consent' and qual ~ 'current_role' and qual ~ 'auth\.uid' from pg_policies where tablename = 'jobs' and policyname = 'jobs_select'), 'the select policy checks owner, consumer role and consent');
select ok((select with_check ~ 'has_consent' and with_check ~ 'current_role' and with_check ~ 'auth\.uid' and with_check ~ 'job_input_ok' and with_check ~ 'recent_job_count' from pg_policies where tablename = 'jobs' and policyname = 'jobs_insert'),
  'the insert policy checks owner, consumer role, consent, the input and the rate limit');

create temp table inp (n int, label text, input jsonb, ok bool);
insert into inp values
  (1, 'one own path', jsonb_build_object('path', pg_temp.ua() || '/a1.webp'), true),
  (2, 'own paths list of two', jsonb_build_object('paths', jsonb_build_array(pg_temp.ua() || '/a2.webp', pg_temp.ua() || '/a3.webp')), true),
  (3, 'path and a currency', jsonb_build_object('path', pg_temp.ua() || '/a4.jpg', 'currency', 'INR'), true),
  (4, 'another user''s path', jsonb_build_object('path', pg_temp.ub() || '/a5.webp'), false),
  (5, 'a path that climbs', jsonb_build_object('path', pg_temp.ua() || '/../' || pg_temp.ub() || '/x.webp'), false),
  (6, 'a nested path', jsonb_build_object('path', pg_temp.ua() || '/sub/a6.webp'), false),
  (7, 'a file name starting with a dot', jsonb_build_object('path', pg_temp.ua() || '/.hidden'), false),
  (8, 'no folder', jsonb_build_object('path', 'a7.webp'), false),
  (9, 'no path at all', jsonb_build_object('currency', 'INR'), false),
  (10, 'an unknown key', jsonb_build_object('path', pg_temp.ua() || '/a8.webp', 'options', 'x'), false),
  (11, 'a path that is a number', jsonb_build_object('path', 7), false),
  (12, 'an empty paths list', jsonb_build_object('paths', jsonb_build_array()), false),
  (13, 'five paths', jsonb_build_object('paths', jsonb_build_array(pg_temp.ua() || '/1', pg_temp.ua() || '/2', pg_temp.ua() || '/3', pg_temp.ua() || '/4', pg_temp.ua() || '/5')), false),
  (14, 'paths with another user''s path', jsonb_build_object('paths', jsonb_build_array(pg_temp.ua() || '/b1.webp', pg_temp.ub() || '/b2.webp')), false),
  (15, 'a lower-case currency', jsonb_build_object('path', pg_temp.ua() || '/a9.webp', 'currency', 'inr'), false),
  (16, 'paths that is not a list', jsonb_build_object('paths', pg_temp.ua() || '/a10.webp'), false),
  (17, 'a path with a trailing newline', jsonb_build_object('path', pg_temp.ua() || E'/a11.webp\n'), false),
  (18, 'a path with a space', jsonb_build_object('path', pg_temp.ua() || '/a 12.webp'), false),
  (19, 'an input that is a list', jsonb_build_array(pg_temp.ua() || '/a13.webp'), false),
  (20, 'a path in upper-case user id', jsonb_build_object('path', upper(pg_temp.ua()::text) || '/a14.webp'), false);
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', pg_temp.ua(), 'photo', input)),
  case when ok then 'rows=1' else 'err=42501' end, 'input check: ' || label) from inp order by n;
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', pg_temp.ua(), 'receipt', jsonb_build_object('path', pg_temp.ua() || '/r1.pdf', 'currency', 'INR'))),
  'rows=1', 'a receipt job with its own path and a currency is accepted');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', pg_temp.ua(), 'export', jsonb_build_object('path', pg_temp.ua() || '/r1.pdf'))),
  'err=42501', 'a job type outside photo and receipt is refused');
select ok(not app.job_input_ok(null, 'photo', '{}') and not app.job_input_ok(pg_temp.ua(), null, '{"path":"x"}') and not app.job_input_ok(pg_temp.ua(), 'photo', null), 'the input check is false for nulls');

-- defaults for a client insert
select is((select status || '/' || attempts || '/' || coalesce(result::text, '-') || '/' || coalesce(last_error, '-') || '/' || (started_at is null) || '/' || (finished_at is null) from app.jobs where user_id = pg_temp.ua() order by id limit 1),
  'queued/0/-/-/true/true', 'a client job starts queued, unattempted, empty');
-- a client cannot set any server column
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input, %I) values (%L, %L, %L::jsonb, %s)', col, pg_temp.ua(), 'photo',
  jsonb_build_object('path', pg_temp.ua() || '/z.webp'), val)), 'err=42501', 'a client cannot set jobs.' || col || ' on insert')
  from (values ('status', '''done'''), ('result', '''{}''::jsonb'), ('attempts', '2'), ('last_error', '''x'''), ('run_after', '''2030-01-01'''), ('started_at', 'now()'), ('finished_at', 'now()'), ('created_at', '''2000-01-01''')) v(col, val);
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input, id) values (%L, %L, %L::jsonb, 999999)', pg_temp.ua(), 'photo', jsonb_build_object('path', pg_temp.ua() || '/z.webp'))),
  'err=428C9', 'a client cannot set jobs.id on insert (identity column, always generated)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'update app.jobs set status = ''done'''), 'err=42501', 'a client cannot update jobs');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'delete from app.jobs'), 'err=42501', 'a client cannot delete jobs');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', pg_temp.ub(), 'photo', jsonb_build_object('path', pg_temp.ub() || '/z.webp'))),
  'err=42501', 'a client cannot insert a job for another user');
select pg_temp.run_as(pg_temp.ub(), 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', pg_temp.ub(), 'photo', jsonb_build_object('path', pg_temp.ub() || '/b.webp')));
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select count(*) from app.jobs'), '1', 'B sees only B''s job');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select count(*) from app.jobs where user_id <> auth.uid()'), '0', 'A sees none of B''s jobs');
select is(pg_temp.run_as(null, 'anon', 'select 1 from app.jobs'), 'err=42501', 'anon cannot read jobs');
select is(pg_temp.run_as(null, 'anon', pg_temp.tpl('jobs', pg_temp.ua(), 9)), 'err=42501', 'anon cannot insert jobs');
-- consent gate and role
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'photo', jsonb_build_object('path', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c.webp'))),
  'err=42501', 'a user without consent cannot insert a job');
select is(pg_temp.run_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', format('insert into app.jobs (user_id, type, input) values (%L, %L, %L::jsonb)', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'photo', jsonb_build_object('path', 'dddddddd-dddd-dddd-dddd-dddddddddddd/c.webp'))),
  'err=42501', 'a vendor cannot insert a job');
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', pg_temp.tpl('jobs', pg_temp.ua(), 10)), 'err=42501', 'maintenance mode blocks job inserts');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from app.jobs'), 'rows=0', 'maintenance mode hides jobs');
update ops.settings set value = 'off' where key = 'maintenance';
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from app.jobs'), 'rows=' || (select count(*) from app.jobs where user_id = pg_temp.ua()), 'after maintenance A sees their jobs again');

-- the rate limit: 20 jobs in the last hour, the 21st is refused; older jobs do not count; other users are not affected
insert into app.jobs (user_id, type, input, created_at)
  select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'photo', jsonb_build_object('path', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/old' || g || '.webp'), now() - interval '61 minutes' from generate_series(1, 30) g;
select is(pg_temp.val_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'select app.recent_job_count()'), '0', 'jobs older than an hour are not counted');
select is(pg_temp.run_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.tpl('jobs', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1)), 'rows=1', 'E can add a job after 30 old ones');
insert into app.jobs (user_id, type, input, created_at)
  select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'photo', jsonb_build_object('path', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/new' || g || '.webp'), now() - interval '59 minutes' from generate_series(1, 18) g;
select is(pg_temp.val_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'select app.recent_job_count()'), '19', 'recent_job_count counts the last hour only');
select is(pg_temp.run_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.tpl('jobs', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 2)), 'rows=1', 'the 20th job in an hour is accepted');
select is(pg_temp.run_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', pg_temp.tpl('jobs', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 3)), 'err=42501', 'the 21st job in an hour is refused');
select is(pg_temp.run_as(pg_temp.ub(), 'authenticated', pg_temp.tpl('jobs', pg_temp.ub(), 3)), 'rows=1', 'the limit is per user');
select is(pg_temp.val_as(null, 'anon', 'select app.recent_job_count()'), 'err=42501: permission denied for function recent_job_count', 'anon cannot call recent_job_count');

-- ======== 3. the status machine =================================================================================================
select ok((select tgenabled = 'O' from pg_trigger where tgrelid = 'app.jobs'::regclass and tgname = 'jobs_state_machine'), 'the status machine trigger exists and is enabled');
select ok(not has_function_privilege('authenticated', 'app.jobs_state_machine()', 'execute') and not has_function_privilege('anon', 'app.jobs_state_machine()', 'execute'), 'clients cannot call the trigger function');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 'running') $$), 'err=23514', 'insert: a job cannot start running');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, status, finished_at, result) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 'done', now(), '{}') $$), 'err=23514', 'insert: a job cannot start done');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, attempts) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 1) $$), 'err=23514', 'insert: a job cannot start with an attempt');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, last_error) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', 'x') $$), 'err=23514', 'insert: a job cannot start with an error');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, started_at) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', now()) $$), 'err=23514', 'insert: a job cannot start with a start time');
select is(pg_temp.try($$ insert into app.jobs (user_id, type, input, finished_at) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'photo', '{}', now()) $$), 'err=23514', 'insert: a job cannot start with a finish time');

create temp table j as select pg_temp.mkjob(pg_temp.ua()) as q1, pg_temp.mkjob(pg_temp.ua()) as q2, pg_temp.mkjob(pg_temp.ua()) as q3, pg_temp.mkjob(pg_temp.ua()) as q4, pg_temp.mkjob(pg_temp.ua()) as q5;
select is(pg_temp.upd((select q1 from j), 'status = ''done'', result = ''{}'''), 'err=23514', 'queued -> done is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''failed'', last_error = ''x'''), 'err=23514', 'queued -> failed is refused');
select is(pg_temp.upd((select q1 from j), 'run_after = now() + interval ''1 hour'''), 'err=23514', 'queued -> queued (a change that keeps the status) is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''running'''), 'err=23514', 'a claim that does not add an attempt is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''running'', attempts = 2'), 'err=23514', 'a claim that adds two attempts is refused');
select is(pg_temp.upd((select q1 from j), 'attempts = 1'), 'err=23514', 'attempts cannot change while the status stays queued');
select is(pg_temp.upd((select q1 from j), 'status = ''running'', attempts = 1, started_at = ''2000-01-01'''), 'ok', 'queued -> running with one more attempt is accepted');
select is(pg_temp.st((select q1 from j)), 'running/1/-', 'the job is running with one attempt');
select ok((select started_at = now() from app.jobs where id = (select q1 from j)), 'started_at is set by the database, not by the caller');
select is(pg_temp.upd((select q1 from j), 'attempts = 2'), 'err=23514', 'running -> running is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''done'''), 'err=23514', 'running -> done without a result is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''done'', result = ''{}'', attempts = 2'), 'err=23514', 'running -> done with a changed attempts is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''done'', result = ''[]'''), 'err=23514', 'a result that is not an object is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''done'', result = jsonb_build_object(''x'', repeat(''y'', 262144))'), 'err=23514', 'a result over 256 KB is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''queued'''), 'err=23514', 'running -> queued without an error is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''queued'', last_error = ''x'', run_after = now() - interval ''1 hour'''), 'err=23514', 'a retry that runs in the past is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''queued'', last_error = ''x'', attempts = 0, run_after = now() + interval ''30 seconds'''), 'err=23514', 'a retry that changes attempts is refused');
select is(pg_temp.upd((select q1 from j), 'status = ''done'', result = ''{"ok":true}'', finished_at = ''2000-01-01'''), 'ok', 'running -> done with a result is accepted');
select is(pg_temp.st((select q1 from j)), 'done/1/-', 'the job is done');
select ok((select finished_at = now() from app.jobs where id = (select q1 from j)), 'finished_at is set by the database');
select is(pg_temp.upd((select q1 from j), 'status = ''queued'', last_error = ''x'', run_after = now() + interval ''30 seconds'''), 'err=23514', 'done is final: not back to queued');
select is(pg_temp.upd((select q1 from j), 'status = ''running'''), 'err=23514', 'done is final: not back to running');
select is(pg_temp.upd((select q1 from j), 'result = ''{"ok":false}'''), 'err=23514', 'done is final: the result cannot change');

select is(pg_temp.upd((select q2 from j), 'status = ''running'', attempts = 1'), 'ok', 'job 2: claimed');
select is(pg_temp.upd((select q2 from j), 'status = ''failed'''), 'err=23514', 'running -> failed without an error is refused');
select is(pg_temp.upd((select q2 from j), 'status = ''failed'', last_error = ''no_lines'', result = ''{}'''), 'err=23514', 'running -> failed with a result is refused');
select is(pg_temp.upd((select q2 from j), 'status = ''failed'', last_error = ''no_lines'''), 'ok', 'running -> failed with an error is accepted');
select ok((select finished_at = now() and result is null from app.jobs where id = (select q2 from j)), 'a failed job has a finish time and no result');
select is(pg_temp.upd((select q2 from j), 'last_error = ''other'''), 'err=23514', 'failed is final');

-- retry path: three attempts, then failed
select is(pg_temp.upd((select q3 from j), 'status = ''running'', attempts = 1'), 'ok', 'job 3: attempt 1');
select is(pg_temp.upd((select q3 from j), 'status = ''queued'', last_error = ''boom'', run_after = now() + interval ''30 seconds'''), 'ok', 'job 3: requeued after attempt 1');
select is(pg_temp.upd((select q3 from j), 'status = ''running'', attempts = 2'), 'err=23514', 'job 3: a claim before run_after is refused');
alter table app.jobs disable trigger jobs_state_machine;
update app.jobs set run_after = now() where id = (select q3 from j);      -- the test moves time forward; only the test may bypass the trigger
alter table app.jobs enable trigger jobs_state_machine;
select is(pg_temp.upd((select q3 from j), 'status = ''running'', attempts = 2'), 'ok', 'job 3: attempt 2 once due');
select is(pg_temp.upd((select q3 from j), 'status = ''queued'', last_error = ''boom'', run_after = now()'), 'ok', 'job 3: requeued after attempt 2');
select is(pg_temp.upd((select q3 from j), 'status = ''running'', attempts = 3'), 'ok', 'job 3: attempt 3');
select is(pg_temp.upd((select q3 from j), 'status = ''queued'', last_error = ''boom'', run_after = now() + interval ''30 seconds'''), 'err=23514', 'job 3: no requeue after the third attempt');
select is(pg_temp.upd((select q3 from j), 'status = ''running'', attempts = 4'), 'err=23514', 'job 3: no fourth attempt');
select is(pg_temp.upd((select q3 from j), 'status = ''failed'', last_error = ''boom'''), 'ok', 'job 3: failed after the third attempt');

-- immutable columns (job 4 stays queued)
select is(pg_temp.upd((select q4 from j), 'user_id = ''' || pg_temp.ub() || ''''), 'err=23514', 'user_id never changes');
select is(pg_temp.upd((select q4 from j), 'type = ''receipt'''), 'err=23514', 'type never changes');
select is(pg_temp.upd((select q4 from j), 'input = ''{"path":"x"}'''), 'err=23514', 'input never changes');
select is(pg_temp.upd((select q4 from j), 'created_at = ''2000-01-01'''), 'err=23514', 'created_at never changes');
select is(pg_temp.upd((select q4 from j), 'id = id + 1000000'), 'err=428C9', 'id never changes (an always-generated identity column refuses the update)');
-- immutable columns also while the status moves (job 5 is claimed in the next section only; use its own claim attempts that must fail)
select is(pg_temp.upd((select q5 from j), 'status = ''running'', attempts = 1, input = ''{"path":"x"}'''), 'err=23514', 'a claim cannot also change the input');
select is(pg_temp.upd((select q5 from j), 'status = ''running'', attempts = 1, user_id = ''' || pg_temp.ub() || ''''), 'err=23514', 'a claim cannot also change the owner');
select is(pg_temp.upd((select q5 from j), 'status = ''running'', attempts = 1, type = ''receipt'''), 'err=23514', 'a claim cannot also change the type');
select is(pg_temp.upd((select q2 from j), 'status = ''queued'''), 'err=23514', 'a failed job cannot be requeued');
select is(pg_temp.upd((select q2 from j), 'status = ''running'', attempts = 2'), 'err=23514', 'a failed job cannot be claimed');
select is(pg_temp.upd((select q2 from j), 'status = ''done'', result = ''{}'''), 'err=23514', 'a failed job cannot become done');
select is(pg_temp.upd((select q1 from j), 'status = ''failed'', last_error = ''x'''), 'err=23514', 'a done job cannot become failed');
-- the machine binds every role, the secret-key client included
select is(pg_temp.run_as(null, 'service_role', format('update app.jobs set status = ''done'', result = ''{}'' where id = %s', (select q4 from j))), 'err=23514', 'service_role cannot jump queued -> done');
select is(pg_temp.run_as(null, 'service_role', format('update app.jobs set status = ''running'', attempts = 1 where id = %s', (select q4 from j))), 'rows=1', 'service_role can claim (it is a valid transition)');
select is(pg_temp.st((select q5 from j)), 'queued/0/-', 'job 5 is untouched so far');

-- ======== 4. worker_role: exactly LLD 7.1 =======================================================================================
select ok((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit and rolcanlogin and rolconnlimit = 5
  from pg_roles where rolname = 'worker_role'), 'worker_role: login, connection limit 5, and no superuser, createdb, createrole, replication, bypassrls or inherit');
select ok((select rolconfig @> array['statement_timeout=60s', 'idle_in_transaction_session_timeout=60s'] from pg_roles where rolname = 'worker_role'), 'worker_role has statement and idle-in-transaction timeouts');
select is((select count(*) from pg_auth_members where member = 'worker_role'::regrole), 0::bigint, 'worker_role is a member of no role');
select is((select array_agg(member::regrole::text order by member::regrole::text) from pg_auth_members where roleid = 'worker_role'::regrole and not (inherit_option = false and member = 'postgres'::regrole and set_option = false and admin_option) and member <> 'postgres'::regrole),
  null, 'no role other than its creator is a member of worker_role (the API roles cannot become it)') ;
select ok(not pg_has_role('authenticator', 'worker_role', 'member') and not pg_has_role('authenticated', 'worker_role', 'member') and not pg_has_role('service_role', 'worker_role', 'member')
  and not pg_has_role('anon', 'worker_role', 'member') and not pg_has_role('supabase_auth_admin', 'worker_role', 'member'), 'authenticator, anon, authenticated, service_role and supabase_auth_admin cannot become worker_role');
select ok(has_schema_privilege('worker_role', 'app', 'usage') and has_schema_privilege('worker_role', 'catalog', 'usage') and has_schema_privilege('worker_role', 'ops', 'usage') and has_schema_privilege('worker_role', 'extensions', 'usage'), 'usage on app, catalog, ops and extensions');
select is((select array_agg(nspname::text order by nspname) from pg_namespace where has_schema_privilege('worker_role', oid, 'usage') and nspname not like 'pg\_%' and nspname <> 'information_schema'),
  array['app','catalog','extensions','ops','public'], 'usage on no other schema (public is open to everyone and holds no application table)');
select is_empty($$ select nspname from pg_namespace where has_schema_privilege('worker_role', oid, 'create') and nspname not like 'pg\_temp\_%' $$, 'create on no schema (apart from its own temporary schema)');
-- every relation the worker can touch, from the catalog
create temp table wr as
  select n.nspname || '.' || c.relname as rel, c.oid, c.relkind::text as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp\_%' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_schema_privilege('worker_role', n.oid, 'usage')               -- a table in a schema without usage cannot be reached
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')   -- extension members: listed in the next assertion
    and (has_any_column_privilege('worker_role', c.oid, 'select,insert,update,references') or has_table_privilege('worker_role', c.oid, 'delete,truncate,trigger'));
select is((select array_agg(rel order by rel) from wr where rel not like 'catalog.lk\_%'), array['app.jobs', 'ops.worker_heartbeat'], 'the worker touches app.jobs, ops.worker_heartbeat and the catalog lookups, and no other table or view that it can reach');
-- relations that belong to an extension and are open to every role (PUBLIC): pg_stat_statements views, pgTAP views. They sit in the extensions schema
-- (LLD 7.1 gives the worker usage on it for extensions.similarity) and hold no application data.
select is_empty($$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'extensions') and n.nspname not like 'pg\_%'
    and has_schema_privilege('worker_role', n.oid, 'usage') and exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    and (has_any_column_privilege('worker_role', c.oid, 'select,insert,update,references') or has_table_privilege('worker_role', c.oid, 'delete,truncate,trigger')) $$,
  'an extension relation open to everyone can only sit in the extensions schema');
select is((select count(*) from wr where rel like 'catalog.lk\_%'), (select count(*) from pg_class where relnamespace = 'catalog'::regnamespace and relkind = 'r' and relname like 'lk\_%'), 'select on every catalog.lk_* table');
select is_empty($$ select rel from wr where rel like 'catalog.lk\_%' and (has_any_column_privilege('worker_role', oid, 'insert,update,references') or has_table_privilege('worker_role', oid, 'delete,truncate,trigger') or not has_table_privilege('worker_role', oid, 'select')) $$, 'and select only on the lookups');
select ok(has_table_privilege('worker_role', 'app.jobs', 'select') and not has_table_privilege('worker_role', 'app.jobs', 'insert,delete,truncate,references,trigger') and not has_table_privilege('worker_role', 'app.jobs', 'update'), 'app.jobs: table-level select, no insert, delete, truncate or table-level update');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = 'app.jobs'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('worker_role', 'app.jobs', a.attname, 'update')),
  array['attempts','finished_at','last_error','result','run_after','started_at','status'], 'app.jobs: update only status, started_at, attempts, result, last_error, run_after, finished_at');
select ok(has_table_privilege('worker_role', 'ops.worker_heartbeat', 'select,insert,update') and not has_table_privilege('worker_role', 'ops.worker_heartbeat', 'delete,truncate,references,trigger'), 'ops.worker_heartbeat: select, insert, update');
select ok(not has_any_column_privilege('anon', 'ops.worker_heartbeat', 'select,insert,update,references') and not has_any_column_privilege('authenticated', 'ops.worker_heartbeat', 'select,insert,update,references')
  and not has_any_column_privilege('service_role', 'ops.worker_heartbeat', 'select,insert,update,references'), 'nobody else has a privilege on ops.worker_heartbeat');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.worker_heartbeat'::regclass), 'RLS is enabled and forced on ops.worker_heartbeat');
select is((select count(*) from (select c.oid from pg_class c where c.relkind = 'S' and c.relnamespace::regnamespace::text not in ('pg_catalog', 'information_schema') and c.relnamespace::regnamespace::text not like 'pg\_temp\_%' and has_schema_privilege('worker_role', c.relnamespace, 'usage') offset 0) s where has_sequence_privilege('worker_role', s.oid, 'usage,select,update')), 0::bigint, 'the worker has no privilege on any reachable sequence');
select is((select array_agg(n.nspname || '.' || p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'ops', 'catalog', 'analytics', 'analytics_private') and has_function_privilege('worker_role', p.oid, 'execute')), array['app.claim_job'], 'the worker can execute one function in the application schemas: app.claim_job');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where roles = array['worker_role']::name[] and schemaname in ('app', 'ops')),
  array['jobs_worker_select:SELECT', 'jobs_worker_update:UPDATE', 'worker_heartbeat_insert:INSERT', 'worker_heartbeat_select:SELECT', 'worker_heartbeat_update:UPDATE'], 'the worker has exactly the five app and ops policies');
select is((select count(*) from pg_policies where roles = array['worker_role']::name[] and schemaname = 'catalog' and cmd = 'SELECT' and qual = 'true'), (select count(*) from wr where rel like 'catalog.lk\_%'), 'and one select policy per lookup');
select is((select count(*) from pg_policies where roles @> array['worker_role']::name[] and (roles <> array['worker_role']::name[])), 0::bigint, 'no policy mixes worker_role with another role');
-- behaviour as the worker
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from app.jobs'), 'rows=' || (select count(*) from app.jobs), 'the worker sees every job');
select is(pg_temp.run_as(null, 'worker_role', format('select 1 from app.%I', t)), 'err=42501', 'the worker cannot read app.' || t) from (select tbl t from pg_temp.app_tables where tbl <> 'jobs') x order by t;
select is(pg_temp.run_as(null, 'worker_role', q), 'err=42501', 'the worker cannot read ' || q) from unnest(array['select 1 from ops.settings', 'select 1 from ops.invitations', 'select 1 from ops.daily_counts', 'select 1 from auth.users',
  'select 1 from auth.audit_log_entries', 'select 1 from storage.objects', 'select 1 from storage.buckets', 'select 1 from pg_authid', 'select 1 from catalog.colour_family_ref', 'select 1 from catalog.country_region']) q order by q;
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from catalog.lk_category'), 'rows=' || (select count(*) from catalog.lk_category), 'the worker reads the lookups');
select is(pg_temp.run_as(null, 'worker_role', 'delete from app.jobs'), 'err=42501', 'the worker cannot delete jobs');
select is(pg_temp.run_as(null, 'worker_role', pg_temp.tpl('jobs', pg_temp.ua(), 20)), 'err=42501', 'the worker cannot insert jobs');
select is(pg_temp.run_as(null, 'worker_role', c), 'err=42501', 'the worker cannot change ' || c) from unnest(array['update app.jobs set input = input', 'update app.jobs set user_id = user_id', 'update app.jobs set type = type', 'update app.jobs set created_at = created_at']) c order by c;
select is(pg_temp.run_as(null, 'worker_role', format('update app.jobs set last_error = ''x'' where id = %s', (select q5 from j))), 'err=23514', 'the worker is bound by the status machine (queued job, no error without a transition)');
select is(pg_temp.run_as(null, 'worker_role', $$ insert into ops.worker_heartbeat (worker_id, queue_depth, oldest_queued_age, version) values ('w1', 2, 10, 'test') $$), 'rows=1', 'the worker writes its heartbeat');
select is(pg_temp.run_as(null, 'worker_role', $$ update ops.worker_heartbeat set seen_at = now(), queue_depth = 3 where worker_id = 'w1' $$), 'rows=1', 'and updates it');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from ops.worker_heartbeat'), 'rows=1', 'and reads it');
select is(pg_temp.run_as(null, 'worker_role', 'delete from ops.worker_heartbeat'), 'err=42501', 'but cannot delete it');
select is(pg_temp.run_as(null, 'worker_role', $$ insert into ops.worker_heartbeat (worker_id, queue_depth) values ('', 1) $$), 'err=23514', 'a heartbeat needs a worker id');
select is(pg_temp.run_as(null, 'worker_role', c), 'err=42501', 'the worker cannot: ' || c) from unnest(array['create table app.x (a int)', 'create table ops.x (a int)', 'create table public.x (a int)', 'create schema x', 'create function public.f() returns int language sql as ''select 1''',
  'select app.delete_my_account()', 'select app.export_my_data()', 'select app.reap_stuck_jobs()', 'select app.storage_used()', 'select app.has_consent()', 'select ops.is_eligible(gen_random_uuid())']) c order by c;
select is(pg_temp.run_as(null, 'worker_role', 'select count(*) from app.claim_job()'), 'rows=1', 'the worker can claim');
select is(pg_temp.run_as(null, 'worker_role', 'select extensions.similarity(''a'', ''b'')'), 'rows=1', 'and use extensions.similarity (LLD 7.1)');

-- ======== 5. the claim ==========================================================================================================
-- (the two-connection race is tested in workflow/gates/db_tests.test.ts)
select ok(not has_function_privilege('authenticated', 'app.claim_job()', 'execute') and not has_function_privilege('anon', 'app.claim_job()', 'execute') and has_function_privilege('worker_role', 'app.claim_job()', 'execute'), 'only the worker (and the owner) can execute app.claim_job');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select * from app.claim_job()'), 'err=42501', 'a user cannot claim a job');
select is(pg_temp.run_as(null, 'anon', 'select * from app.claim_job()'), 'err=42501', 'anon cannot claim a job');
select ok(not (select prosecdef from pg_proc where oid = 'app.claim_job()'::regprocedure) and (select provolatile = 'v' from pg_proc where oid = 'app.claim_job()'::regprocedure), 'the claim runs with the caller''s rights (security invoker) and is volatile');
select ok((select prosrc ~ 'for update skip locked' and prosrc ~ 'order by q\.id' and prosrc ~ 'run_after <= now\(\)' and prosrc ~ 'attempts < 3' from pg_proc where oid = 'app.claim_job()'::regprocedure), 'the claim text: oldest first, due only, fewer than 3 attempts, for update skip locked');
create temp table cl (n int, jid bigint, uid uuid, typ text, inp jsonb, att int);
-- clean slate for the claim tests: only the jobs made below are queued
alter table app.jobs disable trigger jobs_state_machine;
delete from app.jobs where status = 'queued';
alter table app.jobs enable trigger jobs_state_machine;
create temp table k as select pg_temp.mkjob(pg_temp.ub()) as first, pg_temp.mkjob(pg_temp.ua()) as second, pg_temp.mkjob(pg_temp.ua()) as third, pg_temp.mkjob(pg_temp.ub()) as fourth;
alter table app.jobs disable trigger jobs_state_machine;
update app.jobs set run_after = now() + interval '1 hour' where id = (select second from k);
update app.jobs set status = 'running', attempts = 1, started_at = now() where id = (select third from k);
alter table app.jobs enable trigger jobs_state_machine;
select is(pg_temp.val_as(null, 'worker_role', 'select id::text from app.claim_job()'), (select first::text from k), 'the claim returns the oldest due queued job (not the later one, not a running or future one)');
select is(pg_temp.st((select first from k)), 'running/1/-', 'and marks it running with one attempt');
select ok((select started_at = now() from app.jobs where id = (select first from k)), 'and sets started_at');
select is(pg_temp.val_as(null, 'worker_role', 'select id::text from app.claim_job()'), (select fourth::text from k), 'the next claim skips the running job and the job that is not due yet');
select is(pg_temp.run_as(null, 'worker_role', 'select * from app.claim_job()'), 'rows=0', 'with nothing due the claim returns no row');
select is(pg_temp.st((select second from k)), 'queued/0/-', 'the future job is untouched');
select is((select string_agg(a.attname::text, ',' order by a.attnum) from pg_proc p, unnest(p.proargnames) with ordinality as a(attname, attnum) where p.oid = 'app.claim_job()'::regprocedure), 'id,user_id,type,input,attempts', 'the claim returns id, user_id, type, input, attempts');

-- ======== 6. the reaper, the schedule ===========================================================================================
create temp table r as select pg_temp.mkjob(pg_temp.ua()) as stuck1, pg_temp.mkjob(pg_temp.ua()) as stuck3, pg_temp.mkjob(pg_temp.ua()) as recent, pg_temp.mkjob(pg_temp.ua()) as waiting, pg_temp.mkjob(pg_temp.ua()) as fin;
update app.jobs set status = 'running', attempts = 1 where id in (select stuck1 from r union select recent from r);
update app.jobs set status = 'running', attempts = 1 where id in (select stuck3 from r union select fin from r);
alter table app.jobs disable trigger jobs_state_machine;
update app.jobs set attempts = 3, started_at = now() - interval '6 minutes' where id = (select stuck3 from r);
update app.jobs set started_at = now() - interval '6 minutes' where id = (select stuck1 from r);
update app.jobs set started_at = now() - interval '4 minutes' where id = (select recent from r);
update app.jobs set started_at = now() - interval '10 minutes' where id = (select fin from r);
alter table app.jobs enable trigger jobs_state_machine;
update app.jobs set status = 'done', result = '{}' where id = (select fin from r);
select ok(not has_function_privilege('authenticated', 'app.reap_stuck_jobs()', 'execute') and not has_function_privilege('anon', 'app.reap_stuck_jobs()', 'execute') and not has_function_privilege('worker_role', 'app.reap_stuck_jobs()', 'execute'), 'nobody but the owner can run the reaper');
select ok((select prosecdef from pg_proc where oid = 'app.reap_stuck_jobs()'::regprocedure), 'the reaper is security definer (it runs under pg_cron as the owner)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select app.reap_stuck_jobs()'), 'err=42501', 'a user cannot run the reaper');
create temp table reaped as select app.reap_stuck_jobs() as n;
select is((select n from reaped), 2, 'the reaper touches the two jobs stuck for more than five minutes');
select is(pg_temp.st((select stuck1 from r)), 'queued/1/reaped_stuck_running', 'a stuck job with attempts left goes back to queued');
select ok((select run_after > now() + interval '25 seconds' and run_after <= now() + interval '31 seconds' and finished_at is null from app.jobs where id = (select stuck1 from r)), 'and runs again in about 30 seconds');
select is(pg_temp.st((select stuck3 from r)), 'failed/3/reaped_stuck_running', 'a stuck job on its third attempt is failed');
select ok((select finished_at is not null from app.jobs where id = (select stuck3 from r)), 'and has a finish time');
select is(pg_temp.st((select recent from r)), 'running/1/-', 'a job running for four minutes is left alone');
select is(pg_temp.st((select waiting from r)), 'queued/0/-', 'a queued job is left alone');
select is(pg_temp.st((select fin from r)), 'done/1/-', 'a done job is left alone');
select is((select app.reap_stuck_jobs()), 0, 'a second run reaps nothing');
select is((select schedule || '|' || command || '|' || active::text from cron.job where jobname = 'sparta-reap-stuck-jobs'), '* * * * *|select app.reap_stuck_jobs()|true', 'pg_cron runs the reaper every minute');

-- ======== 7. storage ============================================================================================================
select is((select array_agg(id || ':' || public || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') order by id) from storage.buckets where id in ('item-images', 'receipts', 'exports')),
  array['exports:false:52428800:application/zip', 'item-images:false:5242880:image/jpeg,image/png,image/webp', 'receipts:false:8388608:image/jpeg,image/png,image/webp,application/pdf'], 'the three buckets are private with the LLD 4.6 limits and types');
select is((select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  array['storage_own_folder_read:SELECT', 'storage_own_folder_write:INSERT'], 'storage.objects has exactly a read and a write policy: none to update or delete');
select is((select roles::text from pg_policies where schemaname = 'storage' and policyname = 'storage_own_folder_read'), '{authenticated}', 'the read policy is for authenticated only');
select is((select roles::text from pg_policies where schemaname = 'storage' and policyname = 'storage_own_folder_write'), '{authenticated}', 'the write policy is for authenticated only');
select ok((select qual ~ 'has_consent' and qual ~ 'foldername' and qual ~ 'auth\.uid' from pg_policies where policyname = 'storage_own_folder_read'), 'the read policy checks folder, user and consent');
select ok((select with_check ~ 'has_consent' and with_check ~ 'foldername' and with_check ~ 'auth\.uid' and with_check ~ 'storage_used' and with_check ~ 'current_role' from pg_policies where policyname = 'storage_own_folder_write'), 'the write policy checks folder, user, role, consent and the quota');
select ok(not has_function_privilege('anon', 'app.storage_used()', 'execute') and has_function_privilege('authenticated', 'app.storage_used()', 'execute'), 'storage_used is for signed-in users');
select pg_temp.obj('item-images', pg_temp.ua() || '/a1.webp', 1000);
select pg_temp.obj('receipts', pg_temp.ua() || '/r1.pdf', 2000);
select pg_temp.obj('exports', pg_temp.ua() || '/e1/part-1.zip', 4000000);
select pg_temp.obj('item-images', pg_temp.ub() || '/b1.webp', 500);
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select string_agg(name, '','' order by name) from storage.objects'),
  pg_temp.ua() || '/a1.webp,' || pg_temp.ua() || '/e1/part-1.zip,' || pg_temp.ua() || '/r1.pdf', 'A lists exactly A''s three objects');
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select string_agg(name, '','' order by name) from storage.objects'), pg_temp.ub() || '/b1.webp', 'B lists exactly B''s object');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from storage.objects where name = %L', pg_temp.ub() || '/b1.webp')), 'rows=0', 'A cannot fetch B''s object by name');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('select 1 from storage.objects where bucket_id = ''item-images'' and name like %L', pg_temp.ub() || '%')), 'rows=0', 'A cannot find B''s folder by prefix');
select is(pg_temp.run_as(null, 'anon', 'select 1 from storage.objects'), 'rows=0', 'anon lists nothing');
select is(pg_temp.run_as(null, 'anon', format('select 1 from storage.objects where name = %L', pg_temp.ua() || '/a1.webp')), 'rows=0', 'anon cannot fetch an object');
select is(pg_temp.run_as(null, 'anon', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', pg_temp.ua() || '/anon.webp')), 'err=42501', 'anon cannot upload');
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', 'select 1 from storage.buckets where id = ''item-images'''), 'rows=0', 'buckets are not listed to a user without consent (no bucket policy)');
select is(pg_temp.run_as(null, 'worker_role', 'select 1 from storage.objects'), 'err=42501', 'the worker has no access to storage.objects');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name, metadata) values (''item-images'', %L, ''{"size":10}'')', pg_temp.ua() || '/new1.webp')), 'rows=1', 'A can upload into their own folder in item-images');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name, metadata) values (''receipts'', %L, ''{"size":10}'')', pg_temp.ua() || '/new2.pdf')), 'rows=1', 'and into receipts');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', pg_temp.ub() || '/evil.webp')), 'err=42501', 'A cannot upload into B''s folder');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', pg_temp.ub() || '/b1.webp')), 'err=42501', 'A cannot write B''s file name (no overwrite)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'insert into storage.objects (bucket_id, name) values (''item-images'', ''stray.webp'')'), 'err=42501', 'A cannot upload outside any user folder');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', pg_temp.ua() || '/sub/deep.webp')), 'err=42501', 'A cannot upload deeper than their folder');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''exports'', %L)', pg_temp.ua() || '/e2.zip')), 'err=42501', 'A cannot upload into exports');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''somewhere'', %L)', pg_temp.ua() || '/x.webp')), 'err=42501', 'A cannot upload into another bucket');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', pg_temp.ua() || '/a1.webp')), 'err=23505', 'A''s own file name is taken: no second object with that name');
select is(pg_temp.run_as('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', 'dddddddd-dddd-dddd-dddd-dddddddddddd/v.webp')), 'err=42501', 'a vendor cannot upload');
select is(pg_temp.run_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', format('insert into storage.objects (bucket_id, name) values (''item-images'', %L)', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c.webp')), 'err=42501', 'a user without consent cannot upload');
update ops.settings set value = 'on' where key = 'maintenance';
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'select 1 from storage.objects'), 'rows=0', 'maintenance mode hides the files');
update ops.settings set value = 'off' where key = 'maintenance';
-- no update, no delete policy
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update storage.objects set name = %L where name = %L', pg_temp.ua() || '/renamed.webp', pg_temp.ua() || '/a1.webp')), 'rows=0', 'A cannot rename or overwrite their own object (no update policy)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('update storage.objects set metadata = ''{"size":1}'' where name = %L', pg_temp.ub() || '/b1.webp')), 'rows=0', 'A cannot change B''s object');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'update storage.objects set metadata = metadata'), 'rows=0', 'an update with no WHERE touches nothing');
select set_config('storage.allow_delete_query', 'true', true);   -- let the delete reach the policy: without this the storage trigger refuses first
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('delete from storage.objects where name = %L', pg_temp.ua() || '/a1.webp')), 'rows=0', 'A cannot delete their own object (no delete policy)');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', 'delete from storage.objects'), 'rows=0', 'a delete with no WHERE touches nothing');
select set_config('storage.allow_delete_query', 'false', true);
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('delete from storage.objects where name = %L', pg_temp.ua() || '/a1.webp')), 'err=42501', 'and the storage trigger refuses direct deletes anyway');
select is((select count(*) from storage.objects where name = pg_temp.ua() || '/a1.webp'), 1::bigint, 'A''s object is still there');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.storage_used()'), '3020', 'storage_used counts A''s item-images and receipts, not exports');
select is(pg_temp.val_as(pg_temp.ub(), 'authenticated', 'select app.storage_used()'), '500', 'and B''s own only');
-- the 8 MB quota: refused once the caller already stores 8 MiB (the total may exceed it by one file)
select pg_temp.obj('item-images', 'ffffffff-ffff-ffff-ffff-ffffffffffff/big1.webp', 5242880);
select pg_temp.obj('receipts', 'ffffffff-ffff-ffff-ffff-ffffffffffff/big2.pdf', 3145727);
select is(pg_temp.val_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'select app.storage_used()'), '8388607', 'F stores one byte under 8 MiB');
select is(pg_temp.run_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'insert into storage.objects (bucket_id, name, metadata) values (''item-images'', ''ffffffff-ffff-ffff-ffff-ffffffffffff/last.webp'', ''{"size":4000000}'')'), 'rows=1', 'one byte under the cap an upload is accepted (even if it takes the total over)');
select is(pg_temp.run_as('ffffffff-ffff-ffff-ffff-ffffffffffff', 'authenticated', 'insert into storage.objects (bucket_id, name, metadata) values (''item-images'', ''ffffffff-ffff-ffff-ffff-ffffffffffff/over.webp'', ''{"size":1}'')'), 'err=42501', 'above the cap the next upload is refused');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('insert into storage.objects (bucket_id, name, metadata) values (''item-images'', %L, ''{"size":1}'')', pg_temp.ua() || '/other-user-ok.webp')), 'rows=1', 'another user''s quota is separate');

-- ======== 8. delete_my_account: storage objects and jobs ========================================================================
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000a1');
select pg_temp.mk_user('99999999-0000-0000-0000-0000000000a2');
select pg_temp.make_eligible('99999999-0000-0000-0000-0000000000a1');
select pg_temp.make_eligible('99999999-0000-0000-0000-0000000000a2');
select pg_temp.obj('item-images', '99999999-0000-0000-0000-0000000000a1/p1.webp', 10);
select pg_temp.obj('item-images', '99999999-0000-0000-0000-0000000000a1/p1-thumb.webp', 10);
select pg_temp.obj('receipts', '99999999-0000-0000-0000-0000000000a1/r.pdf', 10);
select pg_temp.obj('exports', '99999999-0000-0000-0000-0000000000a1/e9/part-1.zip', 10);
select pg_temp.obj('item-images', '99999999-0000-0000-0000-0000000000a2/q1.webp', 10);
select pg_temp.obj('item-images', '99999999-0000-0000-0000-0000000000a2/99999999-0000-0000-0000-0000000000a1/trap.webp', 10);   -- a2's file, named after a1 inside a2's folder
select pg_temp.run_as(null, 'postgres', pg_temp.tpl('jobs', '99999999-0000-0000-0000-0000000000a1', 1));
select pg_temp.run_as(null, 'postgres', pg_temp.tpl('jobs', '99999999-0000-0000-0000-0000000000a1', 2));
select pg_temp.run_as(null, 'postgres', pg_temp.tpl('jobs', '99999999-0000-0000-0000-0000000000a2', 1));
select is((select count(*) from app.jobs where user_id = '99999999-0000-0000-0000-0000000000a1'), 2::bigint, 'the doomed user has two jobs');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a1'), 4::bigint, 'and four storage objects in three buckets');
-- refused re-authentication deletes nothing: no object, no job
select is(pg_temp.val_claims('99999999-0000-0000-0000-0000000000a1', 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 3600))), 'select app.delete_my_account()'),
  'err=42501: reauthentication_required', 'a stale sign-in is refused');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a1'), 4::bigint, 'and no object was removed');
select is((select count(*) from app.jobs where user_id = '99999999-0000-0000-0000-0000000000a1'), 2::bigint, 'and no job');
select is(pg_temp.val_as('99999999-0000-0000-0000-0000000000a1', 'authenticated', 'select app.delete_my_account()'), 'err=42501: reauthentication_required', 'a token with no sign-in proof is refused');
-- a vendor is refused and loses nothing
update app.profiles set role = 'vendor' where id = '99999999-0000-0000-0000-0000000000a1';
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000a1', 'authenticated', 'select app.delete_my_account()'), 'err=42501: forbidden', 'a vendor cannot use the consumer deletion');
update app.profiles set role = 'consumer' where id = '99999999-0000-0000-0000-0000000000a1';
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a1'), 4::bigint, 'and loses no object');
create temp table del_before as select coalesce((select n from ops.daily_counts where metric = 'deletions' and day = current_date), 0) as n;
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000a1', 'authenticated', 'select app.delete_my_account()'), 'deleted', 'a fresh sign-in deletes the account');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a1'), 0::bigint, 'all of its storage objects are gone, in every bucket');
select is((select count(*) from app.jobs where user_id = '99999999-0000-0000-0000-0000000000a1'), 0::bigint, 'and all of its jobs');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a2'), 2::bigint, 'another user''s objects are untouched, including one named after the deleted user');
select is((select count(*) from app.jobs where user_id = '99999999-0000-0000-0000-0000000000a2'), 1::bigint, 'and their jobs');
select is(current_setting('storage.allow_delete_query', true), 'false', 'the storage delete switch is set back to false after the call');
select is(pg_temp.run_as(pg_temp.ua(), 'authenticated', format('delete from storage.objects where name = %L', pg_temp.ua() || '/a1.webp')), 'err=42501', 'so a user''s direct delete is still refused afterwards');
-- the retry finishes an interrupted deletion: objects left behind for a user who no longer exists go too
select pg_temp.obj('item-images', '99999999-0000-0000-0000-0000000000a1/late.webp', 10);
select is(pg_temp.val_fresh('99999999-0000-0000-0000-0000000000a1', 'authenticated', 'select app.delete_my_account()'), 'already_deleted', 'asking again answers already_deleted');
select is((select count(*) from storage.objects where (storage.foldername(name))[1] = '99999999-0000-0000-0000-0000000000a1'), 0::bigint, 'and removes an object left behind');
select is((select n from ops.daily_counts where metric = 'deletions' and day = current_date) - (select n from del_before), 1, 'the deletion was counted once (and the retry did not count again)');
select ok(has_function_privilege('authenticated', 'app.delete_my_account()', 'execute') and not has_function_privilege('anon', 'app.delete_my_account()', 'execute') and not has_function_privilege('worker_role', 'app.delete_my_account()', 'execute'), 'delete_my_account is still for signed-in users only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.delete_my_account()'::regprocedure), 'and is still security definer with an empty search_path');

select * from finish();
rollback;
