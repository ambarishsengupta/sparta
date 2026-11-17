-- WO-0071 (R5b) / follow-ups of the WO-0070 review: app.is_recent_sign_in() (its answers against the deletion's own are compared in 008),
-- the 003 policy checks that must exclude EXACTLY {worker_role} (MINOR-4), and the corrected comments (MINOR-1, MINOR-5).
begin;
\ir helpers.inc
select plan(19);

-- ---- app.is_recent_sign_in() --------------------------------------------------------------------------------------------------------
select has_function('app', 'is_recent_sign_in', array[]::text[], 'app.is_recent_sign_in() exists');
select ok((select prosecdef from pg_proc where oid = 'app.is_recent_sign_in()'::regprocedure), 'it is security definer');
select ok((select proconfig from pg_proc where oid = 'app.is_recent_sign_in()'::regprocedure) = array['search_path=""'], 'with the search path pinned to nothing');
select ok(has_function_privilege('authenticated', 'app.is_recent_sign_in()', 'execute') and not has_function_privilege('anon', 'app.is_recent_sign_in()', 'execute')
  and not has_function_privilege('worker_role', 'app.is_recent_sign_in()', 'execute'), 'authenticated may run it; anon and worker_role may not');
select pg_temp.mk_user(pg_temp.ua());
select pg_temp.make_eligible(pg_temp.ua());
select is(pg_temp.val_fresh(pg_temp.ua(), 'authenticated', 'select app.is_recent_sign_in()'), 'true', 'a fresh password sign-in is recent');
select is(pg_temp.val_as(pg_temp.ua(), 'authenticated', 'select app.is_recent_sign_in()'), 'false', 'a token with no amr is not');
select is(pg_temp.val_claims(pg_temp.ua(), 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 4000))), 'select app.is_recent_sign_in()'), 'false', 'a sign-in an hour ago is not');
select is(pg_temp.val_claims(null, 'authenticated', jsonb_build_object('amr', jsonb_build_array(pg_temp.amr_entry('password', 0))), 'select app.is_recent_sign_in()'), 'false', 'a fresh sign-in with no user id is not (nobody to purge)');
select is(pg_temp.run_as(null, 'anon', 'select app.is_recent_sign_in()'), 'err=42501', 'anon cannot call it');

-- ---- MINOR-4: the policy checks of 003 look at every policy except exactly {worker_role} --------------------------------------------
-- The old predicate (roles = {authenticated}) did not see a policy for {authenticated, worker_role}; the new one must.
create policy zz_two_roles on app.items for select to authenticated, worker_role using (true);
select is((select count(*) from pg_policies where schemaname = 'app' and tablename = 'items' and policyname = 'zz_two_roles' and roles = array['authenticated']::name[]), 0::bigint,
  'the earlier 003 predicate (roles equal to {authenticated}) cannot see a policy for two roles');
select is((select count(*) from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[] and policyname = 'zz_two_roles'
  and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'auth\.uid'), 1::bigint, 'the new predicate flags a policy for {authenticated, worker_role} that is not tied to auth.uid()');
select is((select count(*) from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[] and policyname = 'zz_two_roles'
  and tablename not in ('profiles', 'consent_records', 'document_acceptances') and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'has_consent'), 1::bigint, 'and one without has_consent');
drop policy zz_two_roles on app.items;
create policy zz_worker_only on app.items for select to worker_role using (true);
select is((select count(*) from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[] and policyname = 'zz_worker_only'), 0::bigint, 'a policy for exactly {worker_role} is the one exception');
drop policy zz_worker_only on app.items;
create policy zz_public_role on app.items for select to public using (true);
select is((select count(*) from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[] and policyname = 'zz_public_role'
  and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'auth\.uid'), 1::bigint, 'a policy for public is flagged as well');
drop policy zz_public_role on app.items;
create policy zz_other_role on app.items for select to service_role using (true);
select is((select count(*) from pg_policies where schemaname = 'app' and roles <> array['worker_role']::name[] and policyname = 'zz_other_role'
  and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'auth\.uid'), 1::bigint, 'and so is one for any other single role');
drop policy zz_other_role on app.items;
select is((select count(*) from pg_policies where schemaname = 'app' and policyname like 'zz\_%'), 0::bigint, 'the test policies are gone');
select is((select count(*) from pg_policies where schemaname = 'app' and roles = array['worker_role']::name[]), 2::bigint, 'exactly the two worker policies on app.jobs remain exceptions (select and update)');

-- ---- MINOR-1, MINOR-5: the comments say what the database does ----------------------------------------------------------------------
select matches(obj_description('app.jobs_state_machine()'::regprocedure, 'pg_proc'), 'session_replication_role is replica', 'the state machine comment names the replica-mode exception');
select matches(shobj_description((select oid from pg_roles where rolname = 'worker_role'), 'pg_authid'), 'ADMIN membership of it without INHERIT and without SET', 'the worker_role comment states its creator membership exactly');

select * from finish();
rollback;
