# WO-0101 notes: trends, gaps and condition spectrum (R7a, Release 0)

## What was built (new migration only; no old migration touched)
- `20261112130000_wo0101_trends_gaps_spectrum.sql`: guarded wrappers `analytics.trend(p_kind, p_dim, p_period_unit default 'month', p_filter_dim, p_filter_value)`, `analytics.gaps(p_dim, p_filter_dim, p_filter_value, p_top_n default 20)`,
  `analytics.condition_spectrum(p_category)` (security definer, volatile, `search_path = ''`, execute revoked from public, anon, service_role, granted to authenticated), each doing `perform analytics_private.vendor_guard('<name>', <params>)` and then calling an internal function.
  There is no second copy of the role, agreement, maintenance or limit checks: a source test proves none of the new functions contains one. Internal functions (execute revoked from every client role): `q_cube_slice` (the shared reader of trend and gaps: one kind, one dimension group, at most one filter,
  published rows with `users_floor >= min_group_size` only, rounded values only), `q_trend`, `q_gaps`, `q_condition_spectrum`. Dimension and filter names are whitelisted with `case` expressions, values are parameters, no dynamic SQL.
- Test `supabase/tests/database/018_wo0101_trends_gaps_spectrum.test.sql` (132 assertions). The spec names it `017_wo0101_trends_gaps_spectrum`; 017 is WO-0100's, so the next free number, 018, is used.
- Existing exact lists extended (never loosened): `003_schema_and_grants` (the exact list of functions authenticated may execute now names `analytics.trend`, `analytics.gaps`, `analytics.condition_spectrum`; same assertion, same plan count);
  `017_wo0100_vendor_access` ("every other function in analytics and analytics_private is executable by no client role" now also excludes the three later wrappers by name; 018 pins them with the same checks plus the four internal functions). No test was deleted.

## Behaviour (each rule decided by one population, planted in `analytics.cube`; the last block uses a real `run_aggregation()` over 73 synthetic users)
- `trend`: `p_kind` `wishlist` returns `users_rounded` (events column null), `purchase` returns `events_rounded` (users column null); months with a suppressed row are absent; any other `p_period_unit` (including null, `Month`) raises `unsupported_period`.
- `gaps`: `gap_score = round(wishlist_users_rounded::numeric / nullif(owner_users_rounded, 0), 1)` from the `wishlist_open` and `owned` rows of the latest period (shared by both), only visible rows. A segment is listed only if its `wishlist_open` row is visible.
  An owner row that is missing, hidden (`users_floor` under the minimum) or zero gives a null score, a null owner count (hidden) and the label `no visible ownership`. Ranked by score descending, null scores last, ties by segment name; `p_top_n` 1 to 50 else `invalid_top_n`.
- `condition_spectrum`: every `lk_condition_band` row comes back; share = `events_rounded` over the sum of `events_rounded` of the visible bands (owned, rated, category only, latest period), to the nearest 5 points; fewer than two visible bands gives every band a null share.

## Decisions where the documents are silent (all easy to reverse; flagged for the checker)
- **`trend` result columns:** `period, segment, users_rounded, events_rounded`, the one that does not apply to the kind is null (the spec says "users_rounded for wishlist, events_rounded for purchase" and names no column set).
- **Unknown `p_kind`** raises `invalid_dimension` (the fixed-code list has no code for it). A consumer still gets `forbidden` first (guard order).
- **`gaps` extra column `label`** (`no visible ownership` or null), because LLD 5.4 asks for the label and lists no column for it. A visible owner row never carries it.
- **Owner zero:** `analytics.cube` has `check (users_rounded > 0)` (LLD 5.3 step 4 deletes rows that round to 0), so a zero owner row can only be hand-planted. The test drops that one check constraint inside the rolled-back test transaction to plant a zero row, and proves the label; in a real run a zero owner is simply a missing row (also tested).
- **Latest period for gaps:** the maximum period over the visible `wishlist_open` and `owned` rows, used for both sides; an owner row of an older month is never matched to a wishlist row of this month (tested).
- **Condition shares:** a visible band can round to 0 points when the other bands dominate (for example 10 events of 800); that is a visible band's rounded share, not a hidden one, and is left as the spec words it (nearest 5 points).
- **A call that raises leaves no log row** (inherited from WO-0100: the transaction is rolled back), so `invalid_*` and `unsupported_period` calls are neither logged nor counted.
- **Log parameters:** trend `{kind, dim, period_unit, filter_dim, filter_value}`, gaps `{dim, filter_dim, filter_value, top_n}`, condition_spectrum `{category}`; names and values as passed, nothing else.
- `q_ownership_mix` (WO-0100) keeps its own copy of the dimension masks; it was not refactored onto `q_cube_slice` because WO-0100's function is out of this work order's scope.

## Checks
- pgTAP 018: 132 of 132 ok on the local stack (scratch run, then the gate). Mutation proof: `WO-0101-mutation.md` (59 mutants, 59 killed, 0 survivors; the six named ones are M01/M02 (score from raw-count style values), M03, M04, M06, M07, M08).
- Counted lines: about 347 (105 migration, 238 test, 4 in 003 and 017); estimate before building about 320, under the 650 limit, no flag needed.
- No H&M name, photograph or customer id anywhere; every fixture is generated in the test (invented vendors `Zor Vane Outfitters` and `Quillon Threads`, invented brand `Aster Loom`, `@example.test` addresses); no dependency added; no real account; nothing committed, staged or pushed.
- Vendor test users are made by SQL as postgres inside the test transaction only (rolled back).

## Environment notes
- The local stack was already running when the work started (not started and not stopped by me); the gate's `db_tests` stage runs `supabase db reset`.
- The scratch runs (outside the repository) ran the new migration plus the test in one rolled-back transaction through `docker exec supabase_db_sparta psql`; `017`'s dblink part cannot connect that way (no password path), so 017 as a whole is proven by the gate, not by the scratch run (its 159 earlier assertions, including the one changed, passed in the scratch).
