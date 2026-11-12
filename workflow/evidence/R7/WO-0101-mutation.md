# WO-0101 mutation proof (CC15)

Method: for each mutant a scratch SQL file OUTSIDE the repository (the session scratchpad, removed afterwards) took the committed WO-0101 migration (for M56 to M59 also the WO-0098 `build_facts` migration as `create or replace`), applied ONE textual change, and ran the committed test `018_wo0101_trends_gaps_spectrum.test.sql` (with `helpers.inc` inlined) in one transaction that is rolled back, through `docker exec supabase_db_sparta psql` on the local stack (local stack only; pgtap created inside the transaction). A mutant is KILLED when at least one assertion fails or the run errors.

Result: 59 mutants, 59 killed, 0 survivors. The work order asks for at least 20 and names six; all six are below: score from raw-count style values (M01 events, M02 `users_floor`), `no visible ownership`/a score shown when the wishlist row is hidden (M03, the floor check skipped for `wishlist_open`), share over all bands (M04), share rounded to 1 point (M06), `p_top_n` unbounded (M07), `unsupported_period` skipped (M08).

Notes:
- Raw counts exist only in `analytics_private.cube_stage`, which is truncated after every run and which the new functions never read (a source test asserts it), so "score from raw counts" can only be written in an observable form: the score taken from the other published columns that differ from the rounded user counts (events, `users_floor`).
- M58 and M59 were SURVIVORS of the first test version (57 of 59 killed). The real-run population was changed so that the users with open entries have them in the two months before the current one (so a `wishlist_open` row counted by creation month leaves the current month without a wishlist row), and 12 users with only an archived Footwear item were added (so archived ownership would create a visible owner). Both are now killed; all 59 were then run again against the final test.
- M56 to M59 mutate WO-0098's `build_facts` in the scratch only; they prove that the unlock exclusion, the current-month rule of `wishlist_open` and the active-items-only rule reach the vendor functions end to end.

| Mutant | Change | Result | Assertions | First failing test |
| --- | --- | --- | --- | --- |
| M01 | gap score from event counts, not the published user counts (raw-count style) | KILLED | ok=107 not_ok=25 err=0 | vendor with the agreement: gaps |
| M02 | slice returns users_floor in place of users_rounded (score from unrounded counts) | KILLED | ok=128 not_ok=4 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M03 | 'no visible ownership' / a score shown for segments whose wishlist row is hidden (floor check skipped for wishlist_open) | KILLED | ok=125 not_ok=7 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M04 | share over all bands (hidden band counted in the total and shown) | KILLED | ok=130 not_ok=2 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M05 | share over all rows including Unrated | KILLED | ok=131 not_ok=1 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M06 | share rounded to 1 point | KILLED | ok=130 not_ok=2 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M07 | p_top_n unbounded above | KILLED | ok=130 not_ok=2 err=0 | invalid_top_n for gaps('category', null, null, 51) |
| M08 | unsupported_period skipped | KILLED | ok=126 not_ok=6 err=0 | unsupported_period for trend('wishlist', 'category', 'week') |
| M09 | p_top_n of 0 allowed | KILLED | ok=130 not_ok=2 err=0 | invalid_top_n for gaps('category', null, null, 0) |
| M10 | p_top_n 51 allowed | KILLED | ok=130 not_ok=2 err=0 | invalid_top_n for gaps('category', null, null, 51) |
| M11 | null p_top_n allowed (no limit) | KILLED | ok=130 not_ok=2 err=0 | invalid_top_n for gaps('category', null, null, null) |
| M12 | ranked by score ascending | KILLED | ok=129 not_ok=3 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M13 | null scores ranked first | KILLED | ok=128 not_ok=4 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M14 | ties broken by segment name descending | KILLED | ok=130 not_ok=2 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M15 | p_top_n limit not applied | KILLED | ok=130 not_ok=2 err=0 | p_top_n 3 keeps the three best (the limit is applied after the ranking) |
| M16 | score rounded to a whole number | KILLED | ok=127 not_ok=5 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M17 | score not rounded | KILLED | ok=127 not_ok=5 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M18 | owner row joined across periods | KILLED | ok=128 not_ok=4 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M19 | gaps not limited to the current period | KILLED | ok=129 not_ok=3 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M20 | gaps read wishlist (trend kind) instead of wishlist_open | KILLED | ok=125 not_ok=7 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M21 | wishlist trend returns events instead of users | KILLED | ok=129 not_ok=3 err=0 | FR-74: the wishlist trend returns users_rounded (not events) by month and segment; the month with a floor of 5 |
| M22 | trend returns both counts | KILLED | ok=124 not_ok=8 err=0 | FR-74: the wishlist trend returns users_rounded (not events) by month and segment; the month with a floor of 5 |
| M23 | trend accepts any kind | KILLED | ok=127 not_ok=5 err=0 | invalid_dimension for trend('sales', 'category') |
| M24 | trend accepts kind wishlist_open | KILLED | ok=130 not_ok=2 err=0 | invalid_dimension for trend('wishlist_open', 'category') |
| M25 | period unit case-insensitive | KILLED | ok=130 not_ok=2 err=0 | unsupported_period for trend('wishlist', 'category', 'Month') |
| M26 | period unit null allowed | KILLED | ok=130 not_ok=2 err=0 | unsupported_period for trend('wishlist', 'category', null) |
| M27 | users_floor check dropped from the slice | KILLED | ok=121 not_ok=11 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M28 | slice tests users_rounded instead of users_floor | KILLED | ok=123 not_ok=9 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M29 | condition-band rows included in the slice | KILLED | ok=125 not_ok=7 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M30 | slice accepts any filter name (filter ignored) | KILLED | ok=129 not_ok=3 err=0 | invalid_dimension for trend('wishlist', 'category', 'month', 'bogus', 'x') |
| M31 | filter name and value pairing not checked | KILLED | ok=128 not_ok=4 err=0 | invalid_dimension for trend('wishlist', 'category', 'month', 'size') |
| M32 | filter value length not limited | KILLED | ok=129 not_ok=3 err=0 | invalid_dimension for trend('wishlist', 'category', 'month', 'size', repeat('x', 101)) |
| M33 | unknown dimension falls back to category | KILLED | ok=126 not_ok=6 err=0 | invalid_dimension for trend('wishlist', 'colour') |
| M34 | spectrum: one visible band is enough | KILLED | ok=131 not_ok=1 err=0 | a category with one visible band (and a stale month) gives every band a null share |
| M35 | spectrum: three visible bands needed | KILLED | ok=129 not_ok=3 err=0 | exactly two visible bands are enough: 50 and 50 |
| M36 | spectrum shares from users_rounded | KILLED | ok=131 not_ok=1 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M37 | spectrum not limited to the latest period | KILLED | ok=131 not_ok=1 err=0 | a category with one visible band (and a stale month) gives every band a null share |
| M38 | spectrum ignores the other attributes of the row | KILLED | ok=131 not_ok=1 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M39 | spectrum returns only the visible bands (inner join) | KILLED | ok=124 not_ok=8 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M40 | spectrum category filter dropped | KILLED | ok=126 not_ok=6 err=0 | a 40-user category with a 9-user band: that band (rounded to 10, floor 5, 100 events) comes back with a null s |
| M41 | label shown for every segment | KILLED | ok=126 not_ok=6 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M42 | label never shown | KILLED | ok=130 not_ok=2 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M43 | zero owner row not treated as no visible ownership | KILLED | ok=131 not_ok=1 err=0 | gaps: score = wishlist_open users_rounded / owned users_rounded to 1 decimal (Tops 15/40 = 0.4), ranked by sco |
| M44 | division without nullif | KILLED | ok=121 not_ok=11 err=0 | vendor with the agreement: gaps |
| M45 | trend skips the guard | KILLED | ok=115 not_ok=17 err=0 | each wrapper calls analytics_private.vendor_guard with its own name |
| M46 | gaps skips the guard | KILLED | ok=114 not_ok=18 err=0 | each wrapper calls analytics_private.vendor_guard with its own name |
| M47 | condition_spectrum skips the guard | KILLED | ok=117 not_ok=15 err=0 | each wrapper calls analytics_private.vendor_guard with its own name |
| M48 | gaps logged under the trend name | KILLED | ok=112 not_ok=2 err=2 | each wrapper calls analytics_private.vendor_guard with its own name |
| M49 | trend not security definer | KILLED | ok=83 not_ok=49 err=0 | all three are security definer |
| M50 | gaps without a fixed search_path | KILLED | ok=131 not_ok=1 err=0 | all three pin search_path |
| M51 | trend declared stable | KILLED | ok=131 not_ok=1 err=0 | all three are volatile (each writes the log) |
| M52 | condition_spectrum executable by anon | KILLED | ok=131 not_ok=1 err=0 | executable by authenticated only (not public, anon or service_role) |
| M53 | internal q_gaps executable by authenticated | KILLED | ok=131 not_ok=1 err=0 | the four internal functions are executable by no client role |
| M54 | trend executable by public (not revoked) | KILLED | ok=131 not_ok=1 err=0 | executable by authenticated only (not public, anon or service_role) |
| M55 | trend takes the vendor check itself (second copy of the role check) | KILLED | ok=131 not_ok=1 err=0 | no second copy of the role, agreement, maintenance or limit checks: none of the new functions holds one |
| M56 | build_facts: unlock entries counted in wishlist_open (gap from unlock entries) | KILLED | ok=131 not_ok=1 err=0 | FR-81: 13 users with two open entries each (in two months) count once (15 of 40 rounded, 0.4, not 25); the 9-u |
| M57 | build_facts: unlock entries counted in the wishlist trend | KILLED | ok=131 not_ok=1 err=0 | FR-74: the wishlist trend counts the user once in each month of its entries (none this month), and the unlock  |
| M58 | build_facts: wishlist_open entries counted by their month, not the current month | KILLED | ok=131 not_ok=1 err=0 | FR-81: 13 users with two open entries each (in two months) count once (15 of 40 rounded, 0.4, not 25); the 9-u |
| M59 | build_facts: owned counts archived items (ownership side of a gap) | KILLED | ok=131 not_ok=1 err=0 | FR-81: 13 users with two open entries each (in two months) count once (15 of 40 rounded, 0.4, not 25); the 9-u |
