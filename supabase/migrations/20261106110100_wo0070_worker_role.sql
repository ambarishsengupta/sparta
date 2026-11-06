-- WO-0070 (R5b) migration 2: the limited database role `worker_role`, the worker heartbeat table and the atomic claim function
-- (LLD 4.5 limited roles, 7.1, 7.2, 7.6, 10).
--
-- THE PASSWORD IS NOT HERE. The role is created with LOGIN but no password, so nobody can sign in as it until a password is set outside
-- the repository: locally by the git-ignored script supabase/scripts/set-worker-password.sh (reads an environment variable); on a hosted
-- project in the dashboard or with `alter role` run by hand. The role is not a member of any other role, nobody is a member of it
-- (PostgREST's `authenticator` cannot become it), and it has no bypassrls, so every table it can touch has an explicit policy for it.
--
-- Roles live outside the database: `supabase db reset` keeps them. So the role is created only if missing; its password (set by the
-- script) is never touched here.

-- The privileged attributes (superuser, bypassrls, replication, createdb, createrole) can only be given or changed by a superuser, so they are
-- stated once, when the role is created; the pgTAP suite reads them from the catalog and fails if the role ever has one.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'worker_role') then
    create role worker_role with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication connection limit 5;
  else
    alter role worker_role with login noinherit connection limit 5;
  end if;
end $$;
alter role worker_role set statement_timeout = '60s';
alter role worker_role set idle_in_transaction_session_timeout = '60s';

-- ---- the worker heartbeat (LLD 7.6): its only ops table ----------------------------------------------------------------------
create table ops.worker_heartbeat (
  worker_id text primary key check (char_length(worker_id) between 1 and 64),
  seen_at timestamptz not null default now(),
  queue_depth int not null default 0 check (queue_depth >= 0),
  oldest_queued_age int check (oldest_queued_age >= 0),     -- seconds
  version text check (char_length(version) <= 64)
);
alter table ops.worker_heartbeat enable row level security;
alter table ops.worker_heartbeat force row level security;
revoke all on ops.worker_heartbeat from public, anon, authenticated, service_role;

-- ---- privileges, exactly LLD 7.1 -----------------------------------------------------------------------------------------------
-- usage on app, catalog, ops, extensions; select and update on app.jobs (update only on the columns the worker writes: status, started_at,
-- attempts, result, last_error, run_after, finished_at); select on the catalog lookups (catalog.catalog_items does not exist yet: R6 adds
-- its grant and policy); select, insert, update on ops.worker_heartbeat. Nothing on storage: the worker reaches bytes through signed URLs (LLD 7.1).
grant usage on schema app, catalog, ops, extensions to worker_role;
grant select on app.jobs to worker_role;
grant update (status, started_at, attempts, result, last_error, run_after, finished_at) on app.jobs to worker_role;
grant select, insert, update on ops.worker_heartbeat to worker_role;

-- each grant has its policy (LLD 4.5); the state machine trigger limits what an update may do
create policy jobs_worker_select on app.jobs for select to worker_role using (true);
create policy jobs_worker_update on app.jobs for update to worker_role using (true) with check (true);
create policy worker_heartbeat_select on ops.worker_heartbeat for select to worker_role using (true);
create policy worker_heartbeat_insert on ops.worker_heartbeat for insert to worker_role with check (true);
create policy worker_heartbeat_update on ops.worker_heartbeat for update to worker_role using (true) with check (true);

do $$
declare t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'catalog'::regnamespace and c.relkind = 'r' and c.relname like 'lk\_%' loop
    execute format('grant select on catalog.%I to worker_role', t);
    execute format('create policy %I on catalog.%I for select to worker_role using (true)', t || '_worker_read', t);
  end loop;
end $$;

-- ---- the claim (LLD 7.2) -------------------------------------------------------------------------------------------------------
-- One statement: pick the oldest due queued job that no other session has locked (for update skip locked), mark it running, count the
-- attempt. Two workers claiming at the same time can never get the same job, because a locked row is skipped, not waited for. A job with
-- attempts already at 3 is never due (it is failed, not requeued). SECURITY INVOKER on purpose: it runs with the caller's rights, so only
-- a role that holds select and update on app.jobs plus the policies above (worker_role, or the owner) can use it.
create function app.claim_job() returns table (id bigint, user_id uuid, type text, input jsonb, attempts int)
language sql volatile security invoker set search_path = '' as $$
  update app.jobs j set status = 'running', started_at = now(), attempts = j.attempts + 1
  where j.id = (select q.id from app.jobs q
                where q.status = 'queued' and q.run_after <= now() and q.attempts < 3
                order by q.id
                for update skip locked
                limit 1)
  returning j.id, j.user_id, j.type, j.input, j.attempts $$;
revoke execute on function app.claim_job() from public, anon, authenticated;
grant execute on function app.claim_job() to worker_role;
