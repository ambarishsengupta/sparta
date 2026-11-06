# WO-0070 mutation proof (R5b)

Method: each mutant is applied to the LOCAL database as SQL (a `create or replace function`, a policy or grant change) on top of the migrated schema, `supabase test db` runs the whole pgTAP suite (and, for the claim race, `npx vitest run workflow/gates/db_tests.test.ts -t "real connections"`), then the original statement is applied again. The harness is a scratch script (not committed); it reads the function and policy text out of the migration files. After the last mutant the database was rebuilt with `supabase db reset` and the whole suite passed again (see the report).

Result: 38 mutants, 37 killed, 1 equivalent (M08), 0 survived. A mutant counts as killed when at least one assertion fails (or the test file aborts).

| Mutant | Change | Result | Caught by |
| --- | --- | --- | --- |
| M01 | claim without FOR UPDATE SKIP LOCKED (comment keeps the words, so only the behaviour can catch it) | KILLED | vitest race only: "two real connections claiming at the same time never get the same job" (the second claim waits 4 s for the first session's row lock; pgTAP does not see it: the words are kept in a comment). Run: `python3 mutate.py M01` after the timing assertion was added |
| M02 | claim ignores run_after (takes jobs that are not due) | KILLED | pgTAP: 3 failed assertions in 009_jobs_storage_worker; first: the claim text: oldest first, due only, fewer than 3 attempts, for update skip locked  |
| M03 | claim takes the newest job (order by id desc) | KILLED | pgTAP: 4 failed assertions in 009_jobs_storage_worker; first: the claim returns the oldest due queued job (not the later one, not a running or future on  |
| M04 | claim does not skip jobs with 3 attempts (drops attempts < 3) | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: the claim text: oldest first, due only, fewer than 3 attempts, for update skip locked  |
| M05 | status machine: a failed or done job may be requeued (terminal check removed and the retry branch opened to any status) | KILLED | pgTAP: 4 failed assertions in 009_jobs_storage_worker; first: a failed job cannot be requeued  |
| M06 | status machine: input may change (immutable check removed) | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: a claim cannot also change the input  |
| M07 | status machine: a claim may add any number of attempts | KILLED | pgTAP: 7 failed assertions in 009_jobs_storage_worker; first: a claim that does not add an attempt is refused  |
| M08 | status machine: running -> done without a result | EQUIVALENT | not killable: the table CHECK jobs_result_iff_done refuses the same update (a second layer), so the mutated trigger behaves the same. Both layers are tested through the one assertion "running -> done without a result is refused" |
| M09 | status machine: queued -> done allowed (branch added) | KILLED | pgTAP: 8 failed assertions in 009_jobs_storage_worker; first: queued -> done is refused  |
| M10 | insert policy without the input check | KILLED | pgTAP: 19 failed assertions in 009_jobs_storage_worker; first: the insert policy checks owner, consumer role, consent, the input and the rate limit  |
| M11 | insert policy without the rate limit | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the insert policy checks owner, consumer role, consent, the input and the rate limit  |
| M12 | select policy without the consent gate | KILLED | pgTAP: 4 failed assertions in 003_schema_and_grants,005_consent_gate,009_jobs_storage_worker; first: every gated app policy calls has_consent  |
| M13 | authenticated may insert jobs.status | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: authenticated may insert exactly user_id, type and input  |
| M14 | authenticated may update jobs.result | KILLED | pgTAP: 2 failed assertions in 003_schema_and_grants,009_jobs_storage_worker; first: authenticated holds exactly the documented privilege on each app table  |
| M15 | path check allows nested folders (slash allowed in the file name) | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: input check: a nested path  |
| M16 | worker_role may read app.items | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the worker touches app.jobs, ops.worker_heartbeat and the catalog lookups, and no other ta  |
| M17 | worker_role may insert jobs | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: app.jobs: table-level select, no insert, delete, truncate or table-level update  |
| M18 | worker_role may update jobs.input | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: app.jobs: update only status, started_at, attempts, result, last_error, run_after, finishe  |
| M19 | worker_role may read ops.settings | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the worker touches app.jobs, ops.worker_heartbeat and the catalog lookups, and no other ta  |
| M20 | worker_role may delete jobs | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: app.jobs: table-level select, no insert, delete, truncate or table-level update  |
| M21 | storage read policy without the folder test | KILLED | pgTAP: 5 failed assertions in 009_jobs_storage_worker; first: the read policy checks folder, user and consent  |
| M22 | storage write policy without the quota | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the write policy checks folder, user, role, consent and the quota  |
| M23 | storage write policy allows the exports bucket | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: A cannot upload into exports  |
| M24 | users get an update policy on their own folder (overwrite) | KILLED | pgTAP: 4 failed assertions in 009_jobs_storage_worker; first: storage.objects has exactly a read and a write policy: none to update or delete  |
| M25 | users get a delete policy on their own folder | KILLED | pgTAP: 5 failed assertions in 009_jobs_storage_worker; first: storage.objects has exactly a read and a write policy: none to update or delete  |
| M26 | item-images bucket made public | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: the three buckets are private with the LLD 4.6 limits and types  |
| M27 | item-images size limit raised to 50 MB | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: the three buckets are private with the LLD 4.6 limits and types  |
| M28 | delete_my_account does not delete storage objects | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: all of its storage objects are gone, in every bucket  |
| M29 | delete_my_account deletes any object whose name mentions the user id | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: another user's objects are untouched, including one named after the deleted user  |
| M30 | delete_my_account leaves the storage delete switch on | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the storage delete switch is set back to false after the call  |
| M31 | delete_my_account no longer asks for re-authentication | KILLED | pgTAP: 55 failed assertions in 008_data_rights,009_jobs_storage_worker; first: refused, nothing deleted: a fresh amr only inside app_metadata  |
| M32 | reaper reaps jobs running for more than one minute | KILLED | pgTAP: 2 failed assertions in 009_jobs_storage_worker; first: the reaper touches the two jobs stuck for more than five minutes  |
| M33 | reaper requeues a job that has used all attempts | KILLED | pgTAP run aborts: the reaper statement then violates jobs_queued_not_attempted_past_limit (a queued job with 3 attempts), so 009 stops with an error |
| M34 | the reaper schedule is removed | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: pg_cron runs the reaper every minute  |
| M35 | jobs.user_id no longer cascades from profiles | KILLED | pgTAP: 66 failed assertions in 004_rls_isolation,008_data_rights,009_jobs_storage_worker; first: every app table reaches auth.users through cascading foreign ke  |
| M36 | RLS no longer forced on jobs | KILLED | pgTAP: 3 failed assertions in 003_schema_and_grants,009_jobs_storage_worker; first: RLS is enabled and forced on app.jobs  |
| M37 | claim function made security definer (runs with the owner rights) | KILLED | pgTAP: 1 failed assertions in 009_jobs_storage_worker; first: the claim runs with the caller's rights (security invoker) and is volatile  |
| M38 | anon may execute app.claim_job | KILLED | pgTAP: 2 failed assertions in 003_schema_and_grants,009_jobs_storage_worker; first: anon can execute nothing but app.supported_countries  |

First run note: M05 and M06 first survived (the transition table already refused those updates, so the terminal and immutable-column checks were redundant for the tested cases). Tests were added that move the status and change an immutable column in the same update, and M05 now removes the terminal check AND opens the retry branch to any status; both are killed.
