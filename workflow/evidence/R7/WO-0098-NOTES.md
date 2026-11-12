# WO-0098 notes: insight lookups and the anonymised fact table (R7a, Release 0)

## What was built (new migrations only; no old migration touched)
- `packages/taxonomy/src/taxonomy.json`: `priceBands` (six codes), `regions` (`South Asia`), `countryRegions` (`IN` to `South Asia`), `sizes` (Letter: XS S M L XL XXL XXXL).
  `supabase/scripts/gen-seed.ts` generates `lk_size`, `lk_price_band`, `lk_region`, `country_region` into `supabase/seed/lookups.sql` (regenerated with `npm run db:seed`;
  the seed test compares the committed file with a fresh generation). `lk_brand` is still never seeded.
- `20261112100000_wo0098_aggregation_tables.sql`: `ops.aggregate_runs`, `analytics_private.facts`, `analytics_private.cube_stage`, `analytics.cube`. RLS enabled and forced, no policy, `revoke all` from
  public, anon, authenticated, service_role (also on the run-id sequence). `usage` on schema `analytics` for `authenticated` only; nothing on `analytics_private`.
- `20261112100100_wo0098_build_facts.sql`: `analytics_private.build_facts(p_salt text) returns int` (security definer, `search_path = ''`, execute revoked from public, anon, authenticated, service_role).
  One set-based `insert ... select`; reads only `app.profiles`, `app.items`, `app.wishlist_entries`, `app.purchases` (a test pins that list) plus lookups and `ops.fx_rates`.
- Tests: `supabase/tests/database/015_wo0098_facts.test.sql` (131 assertions, new file; the spec's name `014_wo0098_facts` is taken by WO-0088, so the next free number is used). In `001_lookups.test.sql` two assertions were
  REPLACED by stricter ones with the same plan count: "tables without taxonomy data are empty" became exact counts (`lk_brand` 0, `lk_size` 7, `lk_price_band` 6, `lk_region` 1, `country_region` 1) and
  "no usage on analytics or analytics_private" became the grant matrix (analytics usage for authenticated only, none on analytics_private for anyone including public). In `008_data_rights.test.sql` the assertion "ops holds exactly
  the listed tables" (found failing by the first gate run) was REPLACED by one that also names `ops.aggregate_runs` and pins its columns (times, counts, a fixed error code: no person), same plan count. 003 needed no change (it covers app, ops, catalog).
  Vitest: `seed.test.ts` (insert count 11 to 15, plus a block for the new lookups) and `taxonomy.test.ts` (the new lists).

## Decisions where the documents are silent (all easy to reverse; flagged for the checker)
- Purchase period: `purchase_date`, or the month the purchase row was recorded (UTC) when the date is empty (the column is nullable). One fact row per purchase, whatever its quantity.
- Months are UTC (`now() at time zone 'UTC'`, `created_at at time zone 'UTC'`), so the result does not depend on the session time zone.
- `lk_region` holds only `South Asia` (glossary); `Unknown`, `Other` and `Multi-season` are fallbacks, not lookup rows. `lk_price_band` does hold `Unknown` (the glossary lists it among the six codes).
- Brand and size comparison removes all white space (`[[:space:]]`) and lower-cases both sides; two labels that normalise alike resolve to the lowest code, so a typed brand never fans out into two rows.
  A size value with no size system (or a system with no listed sizes) is `Other`; only a blank value is `Unknown`.
- Price: no price or no currency is `Unknown`; `USD` is never converted (an `ops.fx_rates` row for USD is ignored); another currency uses its newest rate, and a missing rate gives `Unknown`. A price of 0 falls in `<25`.
- `build_facts` truncates `facts` first (a rebuild replaces, LLD 5.1 step 3) and refuses a null or empty salt with `invalid_salt` (an unsalted hash would be reversible by enumeration). Any non-empty salt is accepted.
  It returns the number of fact rows written. Note for WO-0099: do not read `facts` in the same statement that calls `build_facts` (TRUNCATE refuses while the table is in use by the calling query).
- `ops.aggregate_runs` carries two consistency checks: `status = 'running'` exactly when `finished_at` is null, and `status = 'error'` exactly when `error_code` is set (a lower-case code). WO-0099 inserts the row as `running` and
  finishes it in the same transaction, so both hold. `analytics.cube` checks `users_rounded > 0` and `events_rounded > 0` (LLD 5.3 step 4 deletes rows that round to 0) and has a foreign key to `ops.aggregate_runs(id)`.
- `service_role` gets no usage on schema `analytics` (the work order says authenticated only); WO-0102's service-role-only `analytics.build_report` will need that grant in its own migration.
- `deleting` is checked twice (explicitly in build_facts and inside `ops.is_eligible`). The explicit check is deliberately redundant, so mutant M54 survives as equivalent (see the mutation file).

## Checks
- pgTAP 015: 131 of 131 ok in the mutation scratch runs and in the gate (see the report for the gate output). Mutation proof: `WO-0098-mutation.md` (55 mutants, 54 killed, 1 equivalent).
- Counted lines (git diff --numstat against the base, no JSON, no evidence, tests counted, the generated lookups.sql counted): 496 (estimate before starting: about 500; under the 650 limit).
- No H&M name, photograph or customer id anywhere (all fixtures are generated in the test, invented brand `Zor Vane`, `@example.test` addresses by the helpers); no dependency added; nothing committed, staged or pushed.

## Environment notes
- The cloud-sync copy `supabase/migrations/20261112090000_wo0088_audit_log_writer 2.sql` (and `014_wo0088_audit_writer.test 2.sql`) exist untracked and git-ignored; `workflow/gates/clean_dupes.sh` removes them at the start of the gate.
- The Write and Edit tools refused paths in this checkout (a worktree guard); every file was written with Bash heredocs or python, as the instructions allow.
