-- WO-0070 (R5b) migration 1: app.jobs, its status machine, owner-only RLS with the consent gate, the rate limit, Realtime and the reaper
-- (LLD 4.4, 7.2, 10). The worker role, the claim function and the storage buckets follow in the next two migrations.
--
-- Users insert and read their own jobs and nothing else: `authenticated` has `select` and a column-limited `insert (user_id, type, input)`,
-- no update, no delete. So status, result, attempts, run_after and the timestamps always take their defaults for a client, and only the
-- worker role (next migration) changes a job. Deleting is by cascade from app.profiles only.

create table app.jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.profiles(id) on delete cascade,
  type text not null check (type in ('photo', 'receipt')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  input jsonb not null check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 4096),
  result jsonb check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 262144),
  attempts int not null default 0 check (attempts between 0 and 3),
  last_error text check (octet_length(last_error) <= 500),
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- the result exists exactly when the job is done; finished_at exactly when it is done or failed; a running job has started
  constraint jobs_result_iff_done check ((status = 'done') = (result is not null)),
  constraint jobs_finished_iff_terminal check ((status in ('done', 'failed')) = (finished_at is not null)),
  constraint jobs_running_has_started check (status <> 'running' or started_at is not null),
  constraint jobs_queued_not_attempted_past_limit check (status <> 'queued' or attempts < 3)
);
-- LLD 4.7: the claim index
create index jobs_claim_idx on app.jobs (status, run_after, id) where status = 'queued';
create index jobs_user_created_idx on app.jobs (user_id, created_at desc);   -- the hourly rate limit and the owner's list

-- ---- input check (used by the insert policy) ---------------------------------------------------------------------------------
-- The input is an object whose keys are only path, paths and currency. Every path is `<own user id>/<file name>` with a plain file name
-- (no further slash, starts with a letter or digit, at most 128 characters). A photo or receipt job needs a path or a list of 1 to 4 paths.
-- Written with CASE so no branch is evaluated on a value of the wrong JSON type.
create function app.job_input_ok(p_uid uuid, p_type text, p_input jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    p_type in ('photo', 'receipt')
    and p_uid is not null
    and jsonb_typeof(p_input) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_input) k where k not in ('path', 'paths', 'currency'))
    and (p_input ? 'path' or p_input ? 'paths')
    and case when p_input ? 'path'
             then jsonb_typeof(p_input -> 'path') = 'string'
                  and (p_input ->> 'path') ~ ('^' || p_uid::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
             else true end
    and case when p_input ? 'paths'
             then jsonb_typeof(p_input -> 'paths') = 'array'
                  and case when jsonb_typeof(p_input -> 'paths') = 'array'
                           then jsonb_array_length(p_input -> 'paths') between 1 and 4
                                and not exists (select 1 from jsonb_array_elements(p_input -> 'paths') e
                                                where jsonb_typeof(e) <> 'string'
                                                   or (e #>> '{}') !~ ('^' || p_uid::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'))
                           else false end
             else true end
    and case when p_input ? 'currency'
             then jsonb_typeof(p_input -> 'currency') = 'string' and (p_input ->> 'currency') ~ '^[A-Z]{3}$'
             else true end,
    false) $$;

-- LLD 7.2: the rate limit's count, as a definer function so the insert policy does not recurse into its own table
create function app.recent_job_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from app.jobs j
  where j.user_id = (select auth.uid()) and j.created_at > now() - interval '1 hour' $$;

-- ---- the status machine ------------------------------------------------------------------------------------------------------
-- One trigger for every role (the table owner and the secret-key client included). Insert: only a fresh queued job. Update:
--   id, user_id, type, input and created_at never change;
--   done and failed are final;
--   queued  -> running  the claim: attempts goes up by exactly one (at most 3 attempts), run_after has passed; started_at is set to now()
--                       here, not taken from the caller
--   running -> done     needs a result object; finished_at is set to now() here
--   running -> failed   needs last_error, no result; finished_at is set to now() here
--   running -> queued   a retry: attempts unchanged and below 3, last_error given, run_after not in the past
--   nothing else (no queued -> done, no done -> queued, no change that leaves the status as it is).
create function app.jobs_state_machine() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.result is not null or new.last_error is not null
       or new.started_at is not null or new.finished_at is not null then
      raise exception 'invalid_job_insert: a job starts queued, unattempted and empty' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.type is distinct from old.type
     or new.input is distinct from old.input or new.created_at is distinct from old.created_at then
    raise exception 'invalid_job_update: id, user_id, type, input and created_at never change' using errcode = '23514';
  end if;
  if old.status in ('done', 'failed') then
    raise exception 'invalid_job_transition: a % job is final', old.status using errcode = '23514';
  end if;

  if old.status = 'queued' and new.status = 'running' then
    if new.attempts <> old.attempts + 1 or old.attempts >= 3 then
      raise exception 'invalid_job_transition: a claim adds exactly one attempt, at most 3' using errcode = '23514';
    end if;
    if old.run_after > now() then
      raise exception 'invalid_job_transition: the job is not due yet' using errcode = '23514';
    end if;
    new.started_at := now();
    new.finished_at := null;
  elsif old.status = 'running' and new.status = 'done' then
    if new.attempts <> old.attempts or new.result is null then
      raise exception 'invalid_job_transition: done needs a result and the same attempts' using errcode = '23514';
    end if;
    new.finished_at := now();
  elsif old.status = 'running' and new.status = 'failed' then
    if new.attempts <> old.attempts or new.result is not null or new.last_error is null then
      raise exception 'invalid_job_transition: failed needs last_error, no result and the same attempts' using errcode = '23514';
    end if;
    new.finished_at := now();
  elsif old.status = 'running' and new.status = 'queued' then
    if new.attempts <> old.attempts or old.attempts >= 3 or new.last_error is null or new.result is not null
       or new.run_after < now() - interval '1 second' then
      raise exception 'invalid_job_transition: a retry keeps attempts (below 3), names the error and runs later' using errcode = '23514';
    end if;
    new.finished_at := null;
  else
    raise exception 'invalid_job_transition: % to % is not allowed', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;

create trigger jobs_state_machine before insert or update on app.jobs
  for each row execute function app.jobs_state_machine();

-- ---- RLS and grants -----------------------------------------------------------------------------------------------------------
alter table app.jobs enable row level security;
alter table app.jobs force row level security;
revoke all on app.jobs from public, anon, authenticated;
grant all on app.jobs to service_role;                       -- the secret-key client; the status machine still applies to it
grant select on app.jobs to authenticated;
grant insert (user_id, type, input) on app.jobs to authenticated;

create policy jobs_select on app.jobs for select to authenticated
  using (user_id = (select auth.uid()) and (select app.current_role()) = 'consumer' and (select app.has_consent()));
create policy jobs_insert on app.jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.current_role()) = 'consumer' and (select app.has_consent())
              and app.job_input_ok(user_id, type, input)
              and (select app.recent_job_count()) < 20);

revoke execute on function app.job_input_ok(uuid, text, jsonb), app.recent_job_count() from public, anon, authenticated;
grant execute on function app.job_input_ok(uuid, text, jsonb), app.recent_job_count() to authenticated;
revoke execute on function app.jobs_state_machine() from public, anon, authenticated;

-- ---- Realtime (LLD 7.2): the browser follows its own job row; Realtime applies the select policy above -----------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'jobs') then
    alter publication supabase_realtime add table app.jobs;
  end if;
end $$;

-- ---- the reaper (LLD 7.2) -----------------------------------------------------------------------------------------------------
-- A job stuck in running for more than five minutes (a crashed worker) gets the same rule as a failed handler: back to queued 30 seconds
-- later if it has attempts left, else failed. Runs every minute under pg_cron as the owner; nobody else can execute it.
create function app.reap_stuck_jobs() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update app.jobs j set
    status = case when j.attempts < 3 then 'queued' else 'failed' end,
    last_error = 'reaped_stuck_running',
    run_after = case when j.attempts < 3 then now() + interval '30 seconds' else j.run_after end
  where j.status = 'running' and j.started_at < now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.reap_stuck_jobs() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sparta-reap-stuck-jobs', '* * * * *', 'select app.reap_stuck_jobs()');
  end if;
end $$;
