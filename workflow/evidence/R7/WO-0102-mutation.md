# WO-0102 mutation proof (reduced scope: no maker minimum by the cull of 2026-11-12; the checker writes its own 5)

Method: scratch copies OUTSIDE the repository (the session scratchpad, removed afterwards). Database mutants: the migration's functions re-created with one change (`create or replace`) or one extra grant/revoke, followed by the committed test
`019_wo0102_reports.test.sql`, all inside one transaction that the test's own `rollback` ends (the committed files are never edited). Seed mutants: a modified copy of `seed-demo-insights.sh` run through `seed-demo-insights.test.ts` with `SEED_SCRIPT` and `SEED_LIVE=1`
(the demo data was removed with the real script after each). 15 database mutants and 4 seed mutants, 19 of 19 killed.

| # | Mutant | Killed by |
| --- | --- | --- |
| M01 | `q_reports()` without the reviewed-only filter | 019 "a vendor lists the reviewed report only" |
| M02 | `q_report(p_id)` without the reviewed-only filter | 019 "an unreviewed report is not returned" |
| M03 | `build_report` also granted to authenticated | 019 grants ("executable by service_role only"), "a vendor can not call build_report" and 6 more |
| M04 | `build_report` granted to public | the same 8 assertions |
| M05 | gaps on `category` instead of `category_colour_family` | 019 "gaps are on category x colour family" |
| M06 | rising: lower instead of higher | 019 "rising wishlist: ... 10 to 20" |
| M07 | coverage count plus 1 (not a multiple of 5) | 019 "coverage: the rounded cohort (40)" and "every count ... is a multiple of 5" |
| M08 | `reports()` without the vendor guard | 019 "each wrapper calls the guard with its own name", the consumer, admin and no-membership rows (9 assertions) |
| M09 | service_role loses usage on schema analytics | 019 "service_role has usage on analytics", "a null period raises unsupported_period" and 1 more |
| M10 | period not normalised to the month | the table check (`period = date_trunc('month', period)`) rejects the report, the test run fails at "service_role built one report" (killed by an error) |
| M11 | null period accepted | 019 "a null period raises unsupported_period" |
| M12 | `report()` logs under the name `reports` | 019 "each wrapper calls the guard with its own name", "each call logs its function name" |
| M13 | gaps payload read from the cube with no floor (planted under-threshold row) | 019 gaps tests (4 assertions) |
| M14 | `build_report` granted to authenticated and anon | the same 8 assertions as M03 |
| M15 | `reports()` oldest period first | 019 "newest period first" |
| S1 | seed: random item ids (rows double on a second run) | seed-demo-insights.test "two runs leave identical row counts" |
| S2 | seed: host check accepts any host | the refusal tests (every bad URL, three modes) |
| S3 | seed: report never marked reviewed | the construction test (direct update) and the live count test (`reports=1`) |
| S4 | seed: report rebuilt on every run | the live idempotence test (`reports=2` on the second run) |

Survivors: none. Not mutated (covered by earlier work orders): the threshold and rounding inside `run_aggregation` (WO-0099 mutants), the role/agreement/maintenance/limit checks in `vendor_guard` (WO-0100 mutants); the payload's multiple-of-5 property is covered by M07.
