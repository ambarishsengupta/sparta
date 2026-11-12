# WO-0110 notes: R7a checker fixes (suppression remainder in distinct users; log allowlist)

## What changed (new migrations and tests only; no old migration touched)
- `20261112150000_wo0110_suppression_distinct_users.sql`: `analytics.run_aggregation()` redefined with `create or replace` (same security definer, `search_path = ''`, revoke repeated, same signature so grants are kept).
  LLD 5.3 step 2 no longer sums `users` over the hidden children (a person once per child). For each unmarked parent and sibling set with at least one hidden child, the rule fires when there is exactly one hidden child
  (unchanged) or when the number of DISTINCT users of the parent with no fact in any visible child of that set is under `min_group_size`. The users come from `analytics_private.facts` (still present at that point of the run; the fact column is the stage column without `d_` or `f_`).
  The remainder therefore also holds users outside every child (for condition bands, the Unrated owners), which is what an attacker computing parent minus visible children actually sees. Everything else is untouched.
- `20261112150100_wo0110_log_allowlist.sql`: `analytics_private.vendor_guard` redefined (create or replace, same grants). New order: role, agreement, maintenance, ALLOWLISTS, log. `filter_value` (by `filter_dim`: size = `system:code` of `lk_size`, `Other`, `Unknown`; season = `lk_season` code or `Multi-season`;
  price_band = `lk_price_band` code; region = `lk_region` code or `Unknown`) and `category` (a `lk_category` code) must be on the list or the call raises `invalid_dimension` before `log_and_limit`. One guard covers `ownership_mix`, `trend`, `gaps` and `condition_spectrum`. Brands and colour families are never filter values or free parameters, so they need no list.
- Test `020_wo0110_suppression.test.sql` (33 assertions): the checker's counter-example (A: 20 black + 5 users with navy and red) and two neighbours (B: 6 + 6 on different users, nothing more hidden; C: 6 + 6 with 3 users owning both = 9 distinct, black hidden);
  30 seeded random populations (`setseed` 0.01 to 0.30, 30 to 89 users, skewed picks so many tail cells are small, 1 to 3 items per user, overlapping owners) checked by an independent distinct-user "parent minus visible children" count from facts rebuilt with the test's own salt;
  a canary (a hand-made leaky cube must be reported); and the log allowlist (invented name and email as filter value or category, other-list value, no filter name: refused with `invalid_dimension`, no log row, consumer still gets `forbidden` first, all cube-possible values accepted).

## Existing tests
- 016: 58 of 58 unchanged. Nothing in it relied on the over-count.
- 017, 018: expectations changed only where they relied on free text being accepted and logged (the allowlist intentionally refuses it). No assertion deleted; each was changed in place:
  - 017 "a value with a quote and a semicolon ..." and "an empty value ...": were `-` (matches nothing); now `err=P0001: invalid_dimension`.
  - 017 "all seven dimensions and all four filters are accepted": used the value `x`; now one allowlisted value per filter (018 has the same assertion for trend and gaps, changed the same way).
  - 017 "four answered calls" / "a colleague's call is logged ... plain text": the colleague's call used `x'; drop table ...`; now the allowlisted `Letter:S`, so it is still an answered, logged call (the injection text is covered by test 020, refused and unlogged).
  - 018 "an unknown category returns every band with a null share" (`Nope`): now `err=P0001: invalid_dimension`. The null-category assertion is unchanged.
- 019: 64 of 64 unchanged.

## Mutants (scratch outside the repo, rolled-back transactions on the local stack; removed afterwards)
| # | Mutant | Result |
|---|---|---|
| 1 | distinct-user measure replaced by the old sum over hidden children | killed (020: A, C and the random leak count) |
| 2 | recovery check weakened (`between 1 and 9` to an empty range) against the sum mutant | killed (A and C row counts, and the canary) |
| 3 | allowlist dropped on `filter_value` | killed (seven assertions) |
| 4 | allowlist dropped on `category` | killed (category refusals, no-log-row count) |
| 5 | log written before validation | survives, EQUIVALENT: a refused call raises, so its log row is rolled back (PostgREST transaction, test savepoint). Same as WO-0100 notes. |
Extra: the 020 file run against the OLD run_aggregation fails A, C and the random test (11 leaks over the 30 populations); against the new one it passes.

## Item 3 (record only)
The agreement check ignores `vendor_id` (it looks for an acceptance by the user at the current version, not for one by that vendor). LLD 5.4 words it that way; accepted, not changed.

## Limits worth knowing
- Not fixed, flagged for the checker and the owner: Unrated owners. If every band row of a category is visible (no hidden child, so the rule does not fire) but 1 to 9 users own only Unrated items, the checker's formula (parent minus visible bands) leaves those users as a residual.
  Reproduced by hand: 20 Good, 12 Worn, 3 Unrated owners of Activewear publishes parent 35, Good 20, Worn 10, so the Unrated count is recoverable to within rounding. LLD 5.3 step 2 only reacts to a HIDDEN child and Unrated is not a published row, so the WO's rule does not cover it;
  closing it means firing the rule whenever the remainder is 1 to 9 even with nothing hidden (hide the smallest band), which is a change to the LLD wording and outside "keep every other behaviour". The 30 random populations found no such case.
- Counted lines: 111 + 26 migration, 153 new test, 18 changed test lines = about 308 (estimate before building about 300, no flag needed).
- Nothing committed, staged or pushed; no dependency; no account or secret.
