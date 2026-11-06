# WO-0070 notes (R5b database)

## What was built
- `20261106110000_wo0070_jobs.sql`: `app.jobs` (LLD 7.2), input check `app.job_input_ok`, rate limit `app.recent_job_count`, status-machine trigger, owner-only select and insert policies with the consent gate, column-limited grants, Realtime publication, reaper `app.reap_stuck_jobs` + pg_cron job every minute.
- `20261106110100_wo0070_worker_role.sql`: `worker_role` (login, no password in the repo), `ops.worker_heartbeat`, the grants and policies of LLD 7.1, `app.claim_job()`.
- `20261106110200_wo0070_storage.sql`: buckets `item-images`, `receipts`, `exports` (private, LLD 4.6 limits), `app.storage_used`, read and write policies on `storage.objects`, none for update or delete.
- `20261106110300_wo0070_delete_account_storage_jobs.sql`: `app.delete_my_account()` also removes the caller's storage object rows (also on the retry); jobs go by cascade.
- `supabase/scripts/set-worker-password.sh` (git-ignored, see below), `supabase/tests/database/009_jobs_storage_worker.test.sql` (295 assertions), a live block in `workflow/gates/db_tests.test.ts` (migrations carry no password; the script; real worker_role logins; the two-connection claim race).

## Changes to existing tests (each needed by the new table; none weakened)
- `helpers.inc`: insert template for `jobs`, `jobs` in `seed_user`, and a row `('jobs', true, true, false, false)` in the privilege matrix.
- `003`: the table list gains `jobs`; the three policy checks and the "every granted operation has a policy" check now look at policies for `authenticated` only (the worker policies `using (true)` are by design not tied to `auth.uid()`; 009 tests them exactly); the function list gains `job_input_ok`, `recent_job_count`, `storage_used`; the plan constant `count*2+47` became `count+63` (same number, 79, for 16 tables; the old coefficient was wrong for any other table count, the run showed 80 for 17 tables).
- `006`: "the only policy in ops" became "the only policy on ops.invitations" (three policies on `ops.worker_heartbeat` are tested in 009).
- `008`: ops table list gains `worker_heartbeat`; the no-argument function list gains `claim_job`, `reap_stuck_jobs`, `recent_job_count`, `storage_used`; plan `nt*7+207` -> `nt*11+147` (the same 319 for 16 tables; 334 for 17 incl. 4 new functions).

## Judgements
- The worker has NO storage privilege. LLD 7.1: "Storage access: Through the signed URLs from `/api/worker/signed-urls`. The Supabase secret key is never on the worker machine." The "controlled path" of CC2 is therefore that route, not a database grant.
- `app.claim_job()` is security INVOKER (it runs with `worker_role`'s own grants and policies); the LLD gives the plain query, the function wraps it and adds `attempts < 3`.
- Update on `app.jobs` is column-limited to the seven columns LLD 7.1 lists; the status machine trigger decides which transitions are allowed, for every role including the secret-key client; it also sets `started_at` and `finished_at` itself.
- `catalog.catalog_items` does not exist yet (R6): its grant and policy for the worker belong to that migration.
- Storage write policy is stricter than LLD 4.6: also requires the consumer role and that the object sits directly in `{user_id}/`.
- Job input allows only the keys `path`, `paths`, `currency` and only own-folder file names (LLD 7.2 says "every input path starts with the user's own ID"; the key names are this work order's choice: WO-0071/0072 must use them or add a migration).

## Document gaps (quote both sides)
1. WO-0070 Instructions: "a git-ignored script `supabase/scripts/set-worker-password.sh`" vs its In scope list (`supabase/migrations/**, supabase/tests/**, supabase/config.toml, supabase/seed/**, workflow/gates/db_tests.test.ts, workflow/evidence/R5b/**`): neither `supabase/scripts` nor `.gitignore` is in scope. I created the script and ignored it through `.git/info/exclude` (local only). **The orchestrator must add `supabase/scripts/set-worker-password.sh` to `.gitignore` (WO-0071 may) and re-create the script on another machine; its text is short and holds no secret.**
2. R5b CC2: "`worker_role` ... read/write storage objects of the job's owner only through a controlled path" vs LLD 7.1 "Storage access: Through the signed URLs from `/api/worker/signed-urls`" and R5b CC5 "no secret key anywhere in apps/web or services/worker" vs LLD 6: the signing route "/api/worker/signed-urls ... returns a signed download URL ... and signed upload URLs" needs `SUPABASE_SECRET_KEY` in the web server. No work order builds that route or says where its secret key lives; WO-0071's end-to-end test (CC4) cannot move bytes without it.
3. LLD 4.6 / 6: storage objects are deleted with the Storage API (bytes). SQL can only delete the `storage.objects` ROWS (the Storage trigger `protect_delete` blocks direct deletes unless `storage.allow_delete_query` is 'true', which the function sets for its own transaction). After `delete_my_account()` the file bytes of the stored objects may remain in the storage backend with no row pointing to them, and the LLD housekeeping step "delete objects ... whose folder belongs to no profile" can no longer find them through the API. Options for the security review: the app lists and removes the caller's objects through the Storage API before calling the function (needs a user delete policy, which LLD 4.6 excludes, or a route with the secret key), or the function leaves the rows to housekeeping. I followed the work order (rows removed in the function). Not verified against the Storage API's file backend here.
4. LLD 7.1 gives `usage` on schema `extensions`; PUBLIC can read `extensions.pg_stat_statements*` (and pgTAP's views in tests). The suite lists extension-owned open relations separately. They hold query statistics, not application data.
5. LLD 4.4 names `item_features` as written "by the browser", with an owner trigger; unchanged here.
6. The container loopback (`127.0.0.1`, `::1`) is `trust` in the local `pg_hba.conf`: a `docker exec ... psql -h 127.0.0.1 -U worker_role` works with ANY password. A connection from outside the container (host port 54322, the Docker network) needs scram. The Dockerised worker (WO-0071) connects over the Docker network, so the password counts; verify it there.

## Not done
- No Storage API (HTTP) test of upload limits (MIME, size) or of the signed URL path: only the database part is tested. Bucket limits are asserted as data.
- No hosted-project check (pooler user `worker_role.<ref>`).
- The Realtime delivery of job changes to a browser is not exercised, only the publication membership.
