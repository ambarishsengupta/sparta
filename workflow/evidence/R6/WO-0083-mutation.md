# WO-0083 mutation proof (R6b, catalogue tables, take-down, audit log, collector and worker grants)

Method: scratch harness OUTSIDE the repository (session scratchpad, not committed). For each mutant ONE transaction on the local stack: `create extension pgtap` inside the transaction, the mutation (a `create or replace function` built from the committed migration text with one substitution, or a policy, grant, constraint, trigger, index or role change), then pgTAP file 013 with `\ir helpers.inc` inlined, ending in its own `rollback`. Nothing was committed to the database. Baseline (no mutation, after `supabase db reset` with both migrations): 186 of 186 pass; the full suite `supabase test db`: 13 files, 2,011 tests, PASS.

## Database mutants: 31 run, 31 killed, 0 survived

| Mutant | Change | Result | Caught by (first failing assertion of 013) |
| --- | --- | --- | --- |
| M01 | unique key without nulls not distinct | KILLED (3 failing lines) | not ok 11 - the unique key treats nulls as equal |
| M02 | gtin check dropped | KILLED (2 failing lines) | not ok 17 - catalog_items: a 13-digit gtin |
| M03 | status check dropped | KILLED (1 failing lines) | not ok 21 - catalog_items: an unknown status |
| M04 | consumer policy without status = active | KILLED (5 failing lines) | not ok 48 - consumer A sees exactly the three active rows (two from sources, one from a vendor) |
| M05 | consumer policy without the consent check | KILLED (3 failing lines) | not ok 52 - a signed-in user without consent sees no catalogue rows |
| M06 | consumer policy without the consumer-role check | KILLED (1 failing lines) | not ok 59 - the policy checks active, consumer and consent |
| M07 | select on catalog.sources granted to authenticated | KILLED (3 failing lines) | not ok 68 - authenticated has no privilege on catalog.sources |
| M08 | take_down_source without the admin check | KILLED (8 failing lines) | not ok 101 - a consumer cannot take a source down |
| M09 | take_down_source deletes the source row instead of keeping it | KILLED (17 failing lines) | not ok 112 - the admin takes source 1 down and is told how many catalogue rows were deleted |
| M10 | take_down_source does not delete the items | KILLED (7 failing lines) | not ok 110 - a failing delete makes the call fail |
| M11 | take_down_source does not set allowed = false | KILLED (6 failing lines) | not ok 110 - a failing delete makes the call fail |
| M12 | items key on delete cascade (user item deleted with the catalogue row) | KILLED (3 failing lines) | not ok 5 - items and wishlist_entries point at catalog_items, validated, on delete set null |
| M13 | wishlist key without on delete set null (no action) | KILLED (6 failing lines) | not ok 5 - items and wishlist_entries point at catalog_items, validated, on delete set null |
| M14 | take_down_source deletes the catalogue rows of every source | KILLED (5 failing lines) | not ok 112 - the admin takes source 1 down and is told how many catalogue rows were deleted |
| M15 | collector select policy lets it see vendor rows | KILLED (2 failing lines) | not ok 159 - it sees the source row C-1 and not the vendor row T-4 |
| M16 | delete on catalog_items granted to collector_role | KILLED (2 failing lines) | not ok 139 - catalog_items: select, insert, update; no delete |
| M17 | collector can update every column of sources | KILLED (4 failing lines) | not ok 137 - sources: table-level select only |
| M18 | insert on the audit log granted to authenticated | KILLED (1 failing lines) | not ok 71 - authenticated has no privilege on ops.admin_audit_log |
| M19 | audit target check dropped (free text and e-mail allowed) | KILLED (3 failing lines) | not ok 89 - audit log: an e-mail address as target |
| M20 | worker policy shows every status | KILLED (3 failing lines) | not ok 176 - one worker policy on catalog_items: select where status = active |
| M21 | colour trigger dropped from catalog_items | KILLED (6 failing lines) | not ok 42 - the trigger derives the hex code and the family (golden vector #00008B is Navy) |
| M22 | take_down_source executable by anon | KILLED (1 failing lines) | not ok 125 - take_down_source is security definer, pins search_path, and only authenticated may execute it |
| M23 | collector cannot execute rgb_hex (trigger fails) | KILLED (9 failing lines) | not ok 142 - the collector can execute only the four colour functions its trigger needs |
| M24 | sources_allowed_ck dropped | KILLED (4 failing lines) | not ok 37 - allowed needs robots_allowed (policy section 4) |
| M25 | gtin index not partial | KILLED (1 failing lines) | not ok 10 - index: gtin, partial where not null |
| M26 | take_down_source security invoker | KILLED (12 failing lines) | not ok 107 - an unknown source raises source_not_found |
| M27 | collector insert policy accepts vendor rows | KILLED (1 failing lines) | not ok 152 - it cannot insert a vendor row |
| M28 | collector_role allowed to inherit | KILLED (1 failing lines) | not ok 127 - collector_role: login, connection limit 3, and no superuser, createdb, createrole, replication, bypassrls or inherit |
| M29 | update (any column) on catalog_items for worker_role | KILLED (2 failing lines) | not ok 175 - worker_role: select only on catalog_items |
| M30 | take_down_source without the source row lock/not-found check | KILLED (1 failing lines) | not ok 107 - an unknown source raises source_not_found |
| M31 | price CHECK reduced to price >= 0 (drops the upper bound that refuses NaN) | KILLED (1 failing lines) | not ok 26 - catalog_items: a NaN price |

## Seed script mutants: 6 run, 6 killed (vitest file supabase/scripts/seed-demo-catalog.test.ts, scratch copy of the script, `SEED_SCRIPT` override)

| Mutant | Change | Result | Caught by |
| --- | --- | --- | --- |
| S1 | the host guard accepts any host | KILLED (5 failing) | the refusal tests for db.example.test, 10.0.0.5, localhost.evil.test, 127.0.0.1.evil.test and the userinfo trick |
| S2 | the guard has no end anchor (a query string such as ?host= is allowed) | KILLED | refuses ...?host=db.example.test |
| S3 | the user-info part of the URL may contain an at sign | KILLED | refuses postgresql://postgres@evil.test@127.0.0.1/postgres |
| S4 | the demo source is seeded with allowed = true | KILLED | the demo source is never allowed |
| S5 | an item brand replaced by a real-looking brand name | KILLED | no real brand data, no H&M reference (and the invented brand list) |
| S6 | the upsert key removed (not idempotent) | KILLED | idempotent by construction |

Total: 37 mutants, all killed (the work order asks for at least 15).

## Notes on single mutants
- M12 and M13 are killed twice over: by the catalog of foreign keys (assertion 5) and by the behaviour (the user's item survives the take-down).
- M26 (security invoker) fails 12 assertions: the admin's own session has no privilege on catalog.sources, so the function only works as a definer.
- Not mutated, because one session cannot show it: the `for update` row lock in take_down_source (it makes the function wait for a collector insert still in flight). It is a concurrency guard and is covered by review, not by a test.
- Infinity as a price is refused by the column type (numeric(12,2), SQLSTATE 22003) before the CHECK; the `price < 'Infinity'` half of the CHECK exists for NaN, which sorts above infinity (M31 shows the NaN assertion kills its removal).
