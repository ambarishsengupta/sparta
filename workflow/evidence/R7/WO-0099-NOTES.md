# WO-0099 notes: aggregation run, cube, suppression, rounding and audit (R7a, Release 0)

## What was built (new migrations only; no old migration touched)
- `20261112110000_wo0099_run_aggregation.sql`: `analytics.run_aggregation() returns bigint` (security definer, `search_path = ''`, owned by the migration role, execute revoked from public, anon, authenticated and service_role).
  Steps: advisory xact lock (key 7099001; `aggregation_running`, SQLSTATE 55P03, no run row), run row, then an inner `begin ... exception` block: min-group-size check (positive multiple of 5), random salt in a local variable,
  `build_facts` (a statement of its own), `cube_stage` filled with the 35 grouping sets of LLD 5.2 (7 dimension groups x 5 filter choices, generated from fixed arrays; no caller input) plus the condition-spectrum pass (owned, rated only),
  rows under the minimum marked, the complementary loop of LLD 5.3 step 2 (bounded at 1,000 passes, then `suppression_did_not_converge`), marked rows deleted, rounding to 5 with `users_floor`, rows rounding to 0 dropped,
  `analytics.cube` replaced, `cube_stage` and `facts` truncated, run row finished `ok` with users, items, rows suppressed and duration. On any error the handler keeps only a fixed code and the previous cube stays (the inner block is a subtransaction).
- `20261112110100_wo0099_aggregation_schedule.sql`: pg_cron job `sparta-run-aggregation` at `30 20 * * *`, created only if pg_cron exists and the job is missing (local stack only).
- Test `supabase/tests/database/016_wo0099_aggregation.test.sql` (58 assertions). The spec names it `015_wo0099_aggregation`; 015 is WO-0098's, so the next free number, 016, is used.

## Decisions where the documents are silent (flagged for the checker)
- **The error path returns the run id instead of raising.** WO-0099 lists `invalid_min_group_size` as a refusal, but CC3 and LLD 13.2 want a failed run to record status `error` with a fixed code; raising would roll back the audit row (R7.md Document points).
  So the min-group-size check runs after the run row is inserted, inside the inner block, and the function returns normally. `aggregation_running` is the one refusal that raises (nothing ran, so there is no row to keep).
  Fixed codes: `invalid_min_group_size`, `suppression_did_not_converge`, `invalid_salt`, and `run_failed` for anything else (never the message text).
- **Hidden flags live in a temp table of row ids** (`pg_temp.run_marks`, dropped at the end of the run), because `cube_stage` has no flag column and test 015 pins its columns exactly. It is created inside the inner block, so a failed run leaves nothing behind.
- **Parent and child rows are found by attribute sets**: a child has the same kind and period and the parent's attributes plus exactly one more of the nine (the four dimensions, the four filters, the condition band). A parent that does not exist as a row (for example a filter alone) simply matches nothing.
  A finer dimension group counts as a child of a coarser one, in both directions (`colour_family` = Blue is split by `category`; `category` = Tops is split by `colour_family`); condition bands are the children of their category.
  Ties for "smallest unmarked child" go to the lower row id, so a run is deterministic for one set of facts.
- **Rows suppressed** = rows marked by steps 1 and 2 plus rows that round to 0 (step 4). `users_included` = distinct `user_hash`; `items_included` = `owned` fact rows (glossary).
- **Concurrency test** uses `dblink` (an extension that ships with the local stack; created in the test transaction and rolled back) over TCP with the stack's default local login, the same login other local tests in the repository use. A second session holds the lock, so the refusal is proven for real. Nothing is added to a migration or a dependency list.

## Checks
- pgTAP 016: 58 of 58 ok. Mutation proof: `WO-0099-mutation.md` (36 mutants, 34 killed, 2 explained: one equivalent, one unreachable).
- Counted lines: about 333 (105 + 9 migration lines, 219 test lines; estimate before starting about 520, so under the 650 limit).
- No H&M name, photograph or customer id anywhere; every fixture is generated in the test (users `@example.test`); no dependency added; nothing committed, staged or pushed.
