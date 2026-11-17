# WO-0100 mutation proof (CC15)

Method: for each mutant a scratch SQL file OUTSIDE the repository (the scratchpad of the session, removed afterwards) took the two committed WO-0100 migrations, applied ONE textual change to them, and ran the committed test `017_wo0100_vendor_access.test.sql` (with `helpers.inc` inlined) in one transaction on the local stack (`docker exec supabase_db_sparta psql`, local stack only). The test's own `rollback` ends the transaction, so nothing is ever committed and no committed file was edited. A mutant is killed when at least one assertion fails, the file errors, or fewer than 177 assertions pass. The unmutated migrations pass 177 of 177 the same way.

Result: 43 mutants, 43 killed, 0 survivors. The work order asks for at least 20 killed and names six; all six are below (M01 `<>` for `is distinct from`, M02 agreement reading any version, M03 limit `>` 200, M04 refusal logged, M05 filter value interpolated, M06 `users_floor` check dropped).

Notes on named mutants:
- M04 ("refusal logged"): a call that raises rolls back its own log row, in PostgREST (one transaction per request) and in any caller's savepoint, so a refusal that raises and still leaves a row can not be written as a mutation. The mutant is therefore the observable form of the same fault: the 201st call is logged and answered instead of refused. It is killed by the 201st-call test. The property "refused calls write no log row" is asserted directly (log count after the 27-call role matrix and after maintenance and invalid_dimension refusals), and M14 (log_and_limit called before the agreement check) shows the order of the checks is pinned too.
- M05 interpolates the filter value into an `execute` before the query; it is killed by the source test (no dynamic SQL) and, in behaviour, by the quote-and-semicolon value that would otherwise run the injected `drop table`.
- M39 (advisory lock dropped) and M43 (missing maintenance setting treated as off) were SURVIVORS of the first test version (41 of 43 killed); two assertions were added (a second session holding vendor B's advisory lock makes vendor B's call wait while vendor A is not held up; a missing maintenance setting refuses the call) and both are now killed.

| Mutant | Change | Result | Assertions | First failing test |
| --- | --- | --- | --- | --- |
| M01 | role check `<>` instead of `is distinct from` | KILLED | ok=173 not_ok=4 err=0 | the guard checks the role with is distinct from (a null role is refused) |
| M02 | agreement check accepts any version | KILLED | ok=174 not_ok=3 err=0 | a new agreement version refuses a vendor who accepted only the old one (not any version) |
| M03 | rate limit `>` 200 instead of `>=` 200 | KILLED | ok=175 not_ok=2 err=0 | the 201st call (u1) raises rate_limited |
| M04 | rate_limited refusal logs the call and answers it instead of refusing | KILLED | ok=171 not_ok=6 err=0 | the 201st call (u1) raises rate_limited |
| M05 | filter value interpolated into dynamic SQL | KILLED | ok=173 not_ok=4 err=0 | no dynamic SQL in the guard or the internal functions |
| M06 | users_floor check dropped from the ownership query | KILLED | ok=173 not_ok=4 err=0 | FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 a |
| M07 | users_floor check dropped from filter_options | KILLED | ok=174 not_ok=3 err=0 | FR-77: filter_options lists the values with a visible row (any kind), and not Letter:S or  |
| M08 | ownership query tests users_rounded instead of users_floor | KILLED | ok=174 not_ok=3 err=0 | FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 a |
| M09 | rate-limit window of a day instead of an hour | KILLED | ok=176 not_ok=1 err=0 | a row older than one hour is not counted: the call is answered |
| M10 | limit counted per user, not per vendor | KILLED | ok=171 not_ok=6 err=0 | the 201st call (u1) raises rate_limited |
| M11 | several memberships allowed (first one used) | KILLED | ok=172 not_ok=5 err=0 | vendor with two memberships: coverage |
| M12 | maintenance check dropped | KILLED | ok=171 not_ok=6 err=0 | maintenance on: coverage |
| M13 | maintenance checked before the agreement | KILLED | ok=176 not_ok=1 err=0 | maintenance on: a vendor without the agreement gets agreement_required (agreement before m |
| M14 | log_and_limit called before the agreement check | KILLED | ok=148 not_ok=5 err=44 | vendor with nothing (agreement is checked before the log): coverage |
| M15 | role check dropped (agreement is the first check) | KILLED | ok=164 not_ok=13 err=0 | the guard checks the role with is distinct from (a null role is refused) |
| M16 | unknown dimension falls back to category | KILLED | ok=170 not_ok=7 err=0 | invalid_dimension for ownership_mix('colour') |
| M17 | unknown filter name ignored | KILLED | ok=171 not_ok=6 err=0 | invalid_dimension for ownership_mix('category', 'bogus', 'x') |
| M18 | filter name and value pairing not checked | KILLED | ok=174 not_ok=3 err=0 | invalid_dimension for ownership_mix('category', 'size') |
| M19 | filter value length not limited | KILLED | ok=175 not_ok=2 err=0 | invalid_dimension for ownership_mix('category', 'size', repeat('x', 101)) |
| M20 | wrapper without a fixed search_path | KILLED | ok=176 not_ok=1 err=0 | all three pin search_path |
| M21 | coverage declared stable | KILLED | ok=176 not_ok=1 err=0 | all three are volatile (each writes the log) |
| M22 | filter_options executable by anon | KILLED | ok=176 not_ok=1 err=0 | executable by authenticated only (not public, anon or service_role) |
| M23 | log_and_limit executable by authenticated | KILLED | ok=174 not_ok=3 err=0 | analytics.log_and_limit is executable by no authenticated |
| M24 | acceptance insert policy: version not checked | KILLED | ok=173 not_ok=4 err=0 | an old version is refused |
| M25 | acceptance insert policy: membership not checked | KILLED | ok=173 not_ok=4 err=0 | a member of vendor B cannot accept for vendor A |
| M26 | acceptance insert policy: user not checked | KILLED | ok=175 not_ok=2 err=0 | nor accept in the name of another user |
| M27 | vendor_members policy shows every row | KILLED | ok=173 not_ok=4 err=0 | the policy is user_id = (select auth.uid()) |
| M28 | insert granted on every column of the acceptances | KILLED | ok=172 not_ok=5 err=0 | authenticated: select, no table-level insert, no update, no delete |
| M29 | coverage threshold tested on the rounded cohort | KILLED | ok=176 not_ok=1 err=0 | coverage: 9 users (rounds up to 10) is under the minimum and is not shown |
| M30 | coverage takes the latest run of any status | KILLED | ok=171 not_ok=6 err=0 | a later failed run does not change coverage |
| M31 | ownership query not limited to the latest period | KILLED | ok=175 not_ok=2 err=0 | FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 a |
| M32 | condition-band rows included in the mix | KILLED | ok=176 not_ok=1 err=0 | FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 a |
| M33 | other kinds included in the mix (wishlist, purchase) | KILLED | ok=176 not_ok=1 err=0 | FR-72: category mix (Shoes with users_floor 5, Outerwear rounded to 10 from a floor of 5 a |
| M34 | log omits the filter value | KILLED | ok=175 not_ok=2 err=0 | a row holds the vendor, the user, the function and the parameters |
| M35 | coverage logged under the wrong function name | KILLED | ok=153 not_ok=0 err=44 | ERROR:  more than one row returned by a subquery used as an expression |
| M36 | min_group_size hard-coded to 10 in the ownership query | KILLED | ok=176 not_ok=1 err=0 | with min_group_size 50 the 40-user category is not returned |
| M37 | coverage returns the raw cohort | KILLED | ok=172 not_ok=5 err=0 | coverage: 47 users of the last good run, rounded to 45 |
| M38 | vendor_guard executable by authenticated | KILLED | ok=176 not_ok=1 err=0 | every other function in analytics and analytics_private is executable by no client role |
| M39 | advisory lock dropped from log_and_limit | KILLED | ok=176 not_ok=1 err=0 | FR-88: while another session holds the vendor's lock the call waits (lock timeout) |
| M40 | log row written with the vendor id as the user | KILLED | ok=173 not_ok=4 err=0 | no refused caller has a log row |
| M41 | ownership_mix not security definer | KILLED | ok=116 not_ok=47 err=26 | all three are security definer |
| M42 | ownership_mix skips the guard | KILLED | ok=156 not_ok=21 err=0 | admin: ownership_mix |
| M43 | missing maintenance setting treated as off | KILLED | ok=176 not_ok=1 err=0 | a missing maintenance setting refuses the call (fail closed) |
