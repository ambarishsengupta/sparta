# WO-0100 notes: vendor access, agreement, query log, rate limit, ownership mix, coverage and filter options (R7a, Release 0)

## What was built (new migrations only; no old migration touched)
- `20261112120000_wo0100_vendor_access.sql`: `grant select on catalog.vendor_members to authenticated` with policy `vendor_members_own_select` (`user_id = (select auth.uid())`, no write grant);
  `catalog.vendor_agreement_acceptances` exactly as LLD 4.9 (RLS enabled and forced, select own rows, insert own row only: caller is the user, is a member of that vendor, version = `app.public_setting('current_vendor_agreement_version')`;
  insert is granted on `(vendor_id, user_id, version)` only so `accepted_at` can not be chosen; no update, no delete, nothing for anon or service_role); `ops.vendor_query_log` (LLD 5.7, RLS forced, no grant to any client role).
- `20261112120100_wo0100_vendor_functions.sql`: `analytics.log_and_limit` (advisory lock per vendor, 200 an hour for the vendor's users together, `forbidden` for zero or several memberships, never a 21000 error);
  `analytics_private.vendor_guard(p_fn, p_params)` with the checks in order role (`is distinct from 'vendor'`), agreement (current version), maintenance, `log_and_limit`;
  internal `analytics_private.q_ownership_mix`, `q_coverage`, `q_filter_options` (read the published cube only, rows with `users_floor >= min_group_size`, rounded values only, no dynamic SQL; names checked with `case`, values are parameters);
  thin wrappers `analytics.ownership_mix(p_dim, p_filter_dim, p_filter_value)`, `analytics.coverage()`, `analytics.filter_options()` (security definer, volatile, `search_path = ''`, execute revoked from public, anon and service_role, granted to authenticated).
- Test `supabase/tests/database/017_wo0100_vendor_access.test.sql` (177 assertions). The spec names it `016_wo0100_vendor_access`; 015 and 016 are WO-0098 and WO-0099's, so the next free number, 017, is used.
- Existing exact lists extended or replaced (never loosened, same plan counts): `013_wo0083_catalogue` (the catalog table list now has the acceptances table; the RLS list names it; "authenticated has no privilege on catalog.vendor_members" REPLACED by anon none + authenticated select only; "a consumer can not read vendor_members: 42501" REPLACED by `rows=0`, the select policy shows each user its own rows);
  `008_data_rights` (the ops table list names `vendor_query_log` and pins its columns, next to `aggregate_runs`); `003_schema_and_grants` (the function catalogue now also covers schemas `analytics` and `analytics_private`, so every function there must pin `search_path` and the exact list of functions authenticated may execute names the three wrappers).
  001, 009, 015, 016 needed no change (015 passes against the new migrations; 016 runs in the gate).

## Decisions where the documents are silent (all easy to reverse; flagged for the checker)
- **Error codes.** `forbidden` carries SQLSTATE 42501 like every other `forbidden` in the schema; `agreement_required`, `maintenance`, `rate_limited` and `invalid_dimension` use the default P0001. Anon gets 42501 from the missing schema usage (`permission denied for schema analytics`).
- **Maintenance fails closed.** The guard refuses unless the `maintenance` setting exists and is exactly `off` (LLD 5.4 says "is off, otherwise `maintenance`"); `app.has_consent()` treats a missing row as off, the vendor guard does not.
- **Coverage reads the run row.** The cube has no total row (every grouping set has a dimension), so "rounded user count of the cohort" is `users_included` of the latest `ok` run in `ops.aggregate_runs`, rounded to the nearest 5, and null when `floor(users / 5) * 5 < min_group_size` (the same floor test as `users_floor`, 5.3 step 3). The last run time is that run's `finished_at`. A later failed run changes nothing. This is the one internal function that reads something besides `analytics.cube` (the work order says cube only); there is no other source of a cohort size or a run time.
- **Latest period.** The ownership mix reads the latest period that the cube holds for kind `owned` (the cube is replaced each run, so normally one period), then applies the floor to the rows. A stale month is never shown as the current one.
- **Segment of a combined dimension** is the two values joined with ` / ` (for example `Tops / Blue`). A filter needs both a name and a value or neither (otherwise `invalid_dimension`); a value longer than 100 characters is `invalid_dimension` (the log holds the value, so it is bounded; a raising call rolls back its own log row anyway).
- **A call that raises leaves no log row** (the transaction is rolled back, in PostgREST and in a test savepoint alike); so an `invalid_dimension` call is neither logged nor counted. This is also why "refusal logged" can only be mutated in its observable form (see the mutation file).
- **Filter options** list the values that have a visible row of any kind (owned, wishlist, purchase), condition-band rows excluded.
- **Log parameters** are the argument names and values as passed (`{"dim", "filter_dim", "filter_value"}`, with JSON null for a missing one); coverage and filter_options log `{}`.
- **No consumer id, raw count or row under the threshold is returned**: the three result types are pinned by test (`segment, users_rounded`; `users_rounded, last_run_at`; `filter_dim, filter_value`).

## Checks
- pgTAP 017: 177 of 177 ok (run on the local stack in the mutation scratch and in the gate; see the report for the gate output). Mutation proof: `WO-0100-mutation.md` (43 mutants, 43 killed, 0 survivors; two were survivors of the first test version and led to two more assertions).
- The concurrency test uses `dblink` (ships with the local stack; created in the test transaction and rolled back; the lock-holding session is closed in the test) over TCP with the stack's default local login, the same way as 016. Nothing is added to a migration or a dependency list.
- Counted lines: see the report (estimate before starting about 420, under the 650 limit; no flag needed).
- No H&M name, photograph or customer id anywhere; every fixture is generated in the test (invented vendors `Zor Vane Outfitters` and `Quillon Threads`, invented brand `Aster Loom`, `@example.test` addresses by the helpers); no dependency added; no real account; nothing committed, staged or pushed.

## Environment notes
- The Write and Edit tools were not needed; migrations and tests were written with Bash heredocs and python, as allowed.
- The local stack was already running when the work started (I did not start it and did not stop it); the gate's `db_tests` stage runs `supabase db reset`.
