# WO-0102 notes: reports and the demo insights seed (R7a, Release 0, REDUCED SCOPE of the cull of 2026-11-12)

## What was built (new migration only; no old migration touched)
- `20261112140000_wo0102_reports.sql`: `ops.reports (id, period, generated_at, reviewed_by, reviewed_at, payload jsonb)` (RLS enabled and forced, `revoke all` from public, anon, authenticated, service_role);
  `analytics.build_report(p_period date) returns uuid` (security definer, volatile, `search_path = ''`, execute for service_role only; the migration also grants service_role `usage` on schema `analytics`, which it did not have, and nothing else);
  `analytics_private.q_reports()` and `q_report(p_id)` (internal, no client execute, reviewed rows only) and the guarded wrappers `analytics.reports()` and `analytics.report(p_id)` (WO-0100 `vendor_guard`, authenticated only).
  DROPPED per the cull: the four `app.admin_*` functions and `already_reviewed`.
- Payload (CC6), keys exactly `period, coverage {users_rounded, last_run_at}, cube_first_period, cube_last_period, gaps, rising_wishlist, condition_spectrum`: top 10 `q_gaps('category_colour_family')`; top 10 rising `category` wishlist rows
  (`q_trend('wishlist','category')`, report month above the month before, both rows visible, ranked by the increase; fields `users_rounded`, `previous_users_rounded`, `increase`); `q_condition_spectrum` for every active `lk_category`; `q_coverage`; min and max cube period.
  Built only from the internal q_* functions (and the min/max of `analytics.cube.period`), so hidden rows never reach it.
- `supabase/scripts/seed-demo-insights.sh` (+ `--counts`, `--remove`) and `seed-demo-insights.test.ts`. Test `019_wo0102_reports.test.sql` (64 assertions; 018 is WO-0101's, so the next free number is 019).

## The seed (what a demo gets)
150 invented consumers `panel-001..150@example.test` (auth rows by SQL, no password), 434 items, 434 purchases (leaning to recent months, last 150 days), 210 wishlist entries (some bought; 29 from Wardrobe unlock, which never count), six invented brands (also `lk_brand` rows `demo-*`),
the vendor `Northwind Demo Outfitters`, a local admin profile `demo-admin@example.test` (no password) recorded as reviewer, and one report for the current month marked reviewed with `update ops.reports ... ` as postgres.
After the real `analytics.run_aggregation()` (150 users, 434 items, about 5,600 rows suppressed, 846 published cube rows): Activewear (7 owners) and Ethnic wear (9) are hidden as categories, single cells and one condition band are hidden, Footwear / White shows a gap of 3.0,
Accessories, Activewear and Outerwear colour cells show "no visible ownership" (owner row hidden, wishlist row visible), Outerwear and Footwear are rising. A vendor probe (SQL as the vendor, `request.jwt.claims` set) returned at least one visible segment for every function and every one of the seven dimensions (ownership_mix, gaps, trend purchase and wishlist), 14 filter options, coverage 150, a Tops spectrum with three visible bands, one report.
Prices are in USD (no `ops.fx_rates` row is written); items without a price (about 1 in 13) land in the `Unknown` price band.
Idempotence: fixed ids and `on conflict`; two runs leave identical counts (`--counts` line: `panel=150 items=434 wishlist=210 purchases=434 brands=6 vendors=1 members=1 acceptances=1 admins=1 reports=1 cube_rows=N`). Only `ops.aggregate_runs` gains a row per run (it is the audit of the run), so it is not in the comparison.

## Decisions where the documents are silent, and deviations (all easy to reverse; flagged for the checker)
- **Vendor member needs a user.** `catalog.vendor_members` and the acceptance row reference `app.profiles`, so the membership can not exist without a profile. The seed therefore creates a PASSWORDLESS `vendor-demo@example.test` (role vendor) when no such user exists, and wires membership and the current agreement to it if one does.
  WO-0097 must GIVE THAT ACCOUNT ITS PASSWORD (update the existing user, not create a new one with the same email), or create the account first and run the seed after; both orders work. `--remove` deletes the vendor user only while it still has no password.
- **`reviewed_by` has no foreign key.** With `references app.profiles ... on delete set null`, test 008 ("the only non-cascading key into auth.users or app.* is auth.scim_users") fails; a cascade would delete reviewed reports with an admin. A plain uuid is kept (it is an admin id, not participant data).
- **`p_period` and the gaps.** The gaps are those of the latest cube period (the cube holds one run); `p_period` names the report (normalised to the first of the month) and the rising month. A null period raises `unsupported_period` (no new code).
- **`reports()` returns id, period, reviewed_at; `report(p_id)` also the payload** (the spec names no columns; neither returns who reviewed). An unreviewed id and a missing id both return no rows. A call that raises leaves no log row (WO-0100).
- **Existing exact lists extended, never loosened** (same plan counts): 001 and 015 (usage on schema analytics: authenticated and service_role, none for anon or public), 003 (authenticated list gets `analytics.report` and `analytics.reports`, service_role list gets `analytics.build_report`), 017 (the "every other function" exclusion names the three new functions, pinned by 019),
  008 (the ops table list names `reports` and pins its columns).
- **Collection of the seed test.** `workflow/gates/db_tests.test.ts` imports `../../supabase/scripts/seed-demo-catalog.test`, so the existing seed tests ARE collected there. The new test is NOT yet collected, because that file is outside this work order's scope. It needs one line: `import '../../supabase/scripts/seed-demo-insights.test';` after line 14. I ran the test through a scratch vitest config outside the repo (10 passed, live idempotence included with `SEED_LIVE=1`).
  The live test is opt-in (`SEED_LIVE=1`) because it writes 150 demo users into the local database; without it a SKIPPED line is printed and the pure tests (refusal of 7 bad URLs in all three modes, synthetic-only text, idempotence by construction) run.
- Prices in USD, brands in `lk_brand` as `demo-*` rows (removed by `--remove`), `--remove` ends with one aggregation run so the cube no longer shows the panel.

## Checks
- pgTAP 019: 64 of 64 ok; full local suite `supabase test db`: PASS (2608 assertions) before the gate. Mutation proof: `WO-0102-mutation.md` (15 database mutants and 4 seed mutants, all killed; no maker minimum by the cull, the checker writes its own 5).
- Counted lines: about 440 (73 migration, 139 pgTAP, 140 seed script, 62 seed test, 24 changed in 001, 003, 008, 015, 017; the estimate before building was about 380, the cull target about 380; under 500, no flag needed).
- No H&M name, photograph or customer id; all data generated by code (fixed rule-based sequences, invented brands, `@example.test`); no dependency; no real account; no password or key; nothing committed, staged or pushed.

## Environment notes
- The Write and Edit tools were refused (worktree guard); files were written with Bash heredocs and python, as allowed. The local stack was already running (not started, not stopped by me); `supabase migration up` applied the new migration to it; the demo data was removed again with `--remove` before the gate.
