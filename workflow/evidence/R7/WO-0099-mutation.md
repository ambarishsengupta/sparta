# WO-0099 mutation proof (CC15)

Method: for each mutant a scratch SQL file OUTSIDE the repository (`/private/tmp/.../wo0099-scratch`, removed afterwards) took the committed test `016_wo0099_aggregation.test.sql`, inserted a `create or replace function` of the mutated `analytics.run_aggregation()` (M20 and M21: of the WO-0098 `build_facts`) right after the helper include, and ran the whole file in one transaction on the local stack (always rolled back; no committed file was edited). A mutant is killed when at least one assertion fails, the file errors, or fewer than 58 assertions pass.

Result: 36 mutants, 34 killed, 2 survivors, both explained (equivalent or unreachable). The work order asks for at least 20 killed and names seven; all seven are below (M01, M02, M03, M04, M05, M06, M07).

| Mutant | Change | Result | Passing / failing assertions | First failing test |
| --- | --- | --- | --- | --- |
| M01 | `<=` for `<` at the threshold | KILLED | ok=53 not_ok=5 err=0 | FR-80 shows segment of 10: users_rounded 10 |
| M02 | users rounded with floor | KILLED | ok=55 not_ok=3 err=0 | FR-82 rounds to the nearest 5: 12 users and 12 events give 10, 13 user |
| M03 | children set missing the filter dimension | KILLED | ok=52 not_ok=6 err=0 | LLD 5.3 step 2 repeats until nothing new is hidden: Tops x Blue (hidde |
| M04 | loop stops after one pass | KILLED | ok=57 not_ok=1 err=0 | LLD 5.3 step 2 repeats until nothing new is hidden: Tops x Blue (hidde |
| M05 | cube_stage not truncated after publishing | KILLED | ok=57 not_ok=1 err=0 | LLD 5.3 step 5: cube_stage and facts are empty after the run |
| M06 | zero rows kept (no zero filter on publish) | SURVIVED | ok=58 not_ok=0 err=0 | - |
| M07 | error block re-raises | KILLED | ok=39 not_ok=0 err=6 | psql:/tmp/t.sql:241: ERROR:  invalid_min_group_size |
| M08 | no min_group_size validation | KILLED | ok=54 not_ok=4 err=0 | LLD 13.2 a run with min_group_size 7 records status error with the fix |
| M09 | multiple-of-5 check dropped | KILLED | ok=55 not_ok=3 err=0 | LLD 13.2 a run with min_group_size 7 records status error with the fix |
| M10 | users_floor rounded instead of floored | KILLED | ok=55 not_ok=3 err=0 | FR-82 rounds to the nearest 5: 12 users and 12 events give 10, 13 user |
| M11 | events rounded with floor | KILLED | ok=55 not_ok=3 err=0 | FR-82 rounds to the nearest 5: 12 users and 12 events give 10, 13 user |
| M12 | users rounded up (ceil) | KILLED | ok=53 not_ok=5 err=0 | FR-82 rounds to the nearest 5: 12 users and 12 events give 10, 13 user |
| M13 | advisory lock key changed | KILLED | ok=56 not_ok=2 err=0 | a second concurrent run is refused with aggregation_running while the  |
| M14 | advisory lock not taken | KILLED | ok=56 not_ok=2 err=0 | a second concurrent run is refused with aggregation_running while the  |
| M15 | complementary: hidden sum <= min instead of < min | KILLED | ok=57 not_ok=1 err=0 | two hidden siblings with 10 users together hide no third sibling (Blue |
| M16 | complementary: single hidden child ignored | KILLED | ok=57 not_ok=1 err=0 | LLD 5.3 step 2 repeats until nothing new is hidden: Tops x Blue (hidde |
| M17 | complementary hides the largest visible child | KILLED | ok=52 not_ok=6 err=0 | complementary suppression leaves the big cell (Tops x Navy 40) visible |
| M18 | condition spectrum includes Unrated | KILLED | ok=55 not_ok=3 err=0 | FR-86 the run row of 9 users: ok, 9 users, 9 items, all 35 groups supp |
| M19 | condition bands not children of their category | KILLED | ok=56 not_ok=2 err=0 | LLD 5.2 and 5.3 step 2: the bands of a category are its children: a hi |
| M20 | facts include users who are deleting or without consent | KILLED | ok=55 not_ok=3 err=0 | FR-63 FR-64 deleting, unconsented and vendor users change no output |
| M21 | facts include vendors and admins | KILLED | ok=55 not_ok=3 err=0 | FR-63 FR-64 deleting, unconsented and vendor users change no output |
| M22 | users_included counts fact rows | KILLED | ok=57 not_ok=1 err=0 | FR-86 the run row: ok, 113 users, 118 items |
| M23 | rows_suppressed always 0 | KILLED | ok=56 not_ok=2 err=0 | FR-86 the run row of 9 users: ok, 9 users, 9 items, all 35 groups supp |
| M24 | error code leaks the message | KILLED | ok=43 not_ok=0 err=4 | psql:/tmp/t.sql:247: ERROR:  new row for relation "aggregate_runs" violates check constrai |
| M25 | previous cube not deleted before publish | KILLED | ok=45 not_ok=13 err=0 | complementary suppression leaves the big cell (Tops x Navy 40) visible |
| M26 | no filter grouping sets (dimension groups only) | KILLED | ok=36 not_ok=22 err=0 | FR-86 the run row of 9 users: ok, 9 users, 9 items, all 35 groups supp |
| M27 | suppressed rows not deleted from the stage | KILLED | ok=44 not_ok=14 err=0 | FR-80 suppresses segment of 9: nothing about 9 users is published |
| M28 | execute granted to authenticated | KILLED | ok=53 not_ok=5 err=0 | execute on run_aggregation is revoked from anon, authenticated and ser |
| M29 | execute left with public | KILLED | ok=52 not_ok=6 err=0 | execute on run_aggregation is revoked from public |
| M30 | security invoker | KILLED | ok=57 not_ok=1 err=0 | it is security definer |
| M31 | search_path not pinned | KILLED | ok=57 not_ok=1 err=0 | it pins search_path to the empty path |
| M32 | run row finished ok even on error (status not error) | KILLED | ok=56 not_ok=2 err=0 | LLD 13.2 a run with min_group_size 7 records status error with the fix |
| M33 | complementary pass skips the parent-unmarked condition | KILLED | ok=57 not_ok=1 err=0 | LLD 5.3 step 2 looks only at unmarked parents: Tops x Blue is hidden,  |
| M34 | one pick per pass gets a second visible child (pick all unmarked children) | KILLED | ok=53 not_ok=5 err=0 | complementary suppression leaves the big cell (Tops x Navy 40) visible |
| M35 | loop bound removed (never fails to converge) is equivalent: guard raised at 1001 | SURVIVED | ok=58 not_ok=0 err=0 | - |
| M36 | cube kept on error: delete not rolled back (cube emptied by handler) | KILLED | ok=56 not_ok=2 err=0 | the failed run leaves the previous cube unchanged |

## Named mutants of the work order
- `<=` for `<` at the threshold: M01. Rounding with floor: M02 (users) and M11 (events). Children set missing the filter dimension: M03. Loop stopping after one pass: M04. `cube_stage` not truncated: M05. Zero rows kept: M06 (survives, see below). Error block re-raising: M07.

## Survivors
- **M06 zero rows kept** (the publish `where` that drops rows rounding to 0): equivalent. `min_group_size` must be a positive multiple of 5 (the run refuses anything else), every published row has at least that many users, and `round(users / 5.0) * 5` is at least 5 for 5 users or more; `events >= users`. A row that rounds to 0 can therefore never reach the publish step, so the filter is defensive code (LLD 5.3 step 4) that no input can exercise. The `analytics.cube` check `users_rounded > 0 and events_rounded > 0` (WO-0098) is a second guard behind it.
- **M35 loop bound 1000 raised to 100000**: unreachable. Marking is monotone (a row is marked at most once, the table is finite), so the loop ends after at most as many passes as there are rows; the bound can only trip on a defect. The error path it leads to (`suppression_did_not_converge`) shares the handler that M07, M24, M32 and M36 prove.

## Notes
- The concurrency test needs a second session. The test opens one with `dblink` over TCP with the local stack's own default login (the same one the repository's other local tests use); `pg_try_advisory_lock(7099001)` in that session first proves the lock is held by someone else (it fails instead of hanging if this session had already taken it). M13 (key changed) and M14 (lock not taken) are killed by it.
- M20 and M21 mutate the WO-0098 function `build_facts` (not committed code) to prove that the FR-63 and FR-64 test of this work order notices users who are deleting, unconsented or vendors reaching the cube.
