# WO-0060 mutation table: do the data-rights tests catch broken versions?

Method: as WO-0041/WO-0042. Each mutant was applied to the running LOCAL database (container supabase_db_sparta, as postgres, in one transaction) on top of a database freshly rebuilt with `supabase db reset`; `supabase test db` was run; the mutant counts as killed when it exits non-zero; the database was restored with `supabase db reset` before the next one (and after the last). Function mutants re-create the two functions from the migration text with one edit; schema mutants (M27 to M30) alter keys or add tables. The runner and mutant SQL are throwaway scripts in the session scratchpad, not in the repo. Nothing outside the local stack was touched.

Result: **30 of 30 mutants killed** (12 are required). M23 survived the first run (the stable-order assertion compared two exports with the same order, so a reversed order passed); an assertion that each exported list is sorted by its row text was added to 008 and M23 was re-run: killed. The unmutated suite passes (960 assertions: 754 in files 001 to 007, unchanged in number, plus 206 in the new 008).

| ID | Mutation | Result | Failed assertions | Test files that failed |
| --- | --- | --- | --- | --- |
| M01 | delete: null-uid check removed (null falls through to already_deleted) | killed | 1 | 008 |
| M02 | delete: non-consumer check removed (vendor/admin may delete) | killed | 14 | 008 |
| M03 | delete: where clause widened (u.id = v_uid or true) | killed | 56 | 008 |
| M04 | delete: daily_counts increment removed | killed | 3 | 008 |
| M05 | delete: counts 2 per deletion | killed | 3 | 008 |
| M06 | delete: already_deleted retry is counted too | killed | 3 | 008 |
| M07 | delete: invitation entry kept | killed | 3 | 008 |
| M08 | delete: invitation matched without lower() | killed | 1 | 008 |
| M09 | delete: second call raises instead of already_deleted | killed | 2 | 008 |
| M10 | delete: stores the user id in ops.settings (personal data kept) | killed | 1 | 008 |
| M11 | delete: security invoker | killed | 57 | 008 |
| M12 | delete: search_path not pinned | killed | 3 | 003, 008 |
| M13 | grant: delete_my_account executable by anon | killed | 3 | 003, 008 |
| M14 | grant: export_my_data executable by PUBLIC | killed | 4 | 003, 008 |
| M15 | grant: both revoked from authenticated (never granted) (the file stops early (a call fails with no execute privilege), so the plan is incomplete; killed by 003 and 008) | killed | 1 | 003, 008 |
| M16 | grant: delete_my_account also granted to service_role | killed | 2 | 008 |
| M17 | export: owner filter removed (leaks every user's rows) | killed | 72 | 008 |
| M18 | export: one table (outfit_logs) skipped | killed | 4 | 008 |
| M19 | export: security invoker (gate-failing users get partial exports) (the run aborts on a permission error (invoker cannot read auth.users) before the plan completes; counted as killed because the suite exits non-zero) | killed | 0 | 008 |
| M20 | export: non-consumer check removed | killed | 4 | 008 |
| M21 | export: format_version dropped | killed | 2 | 008 |
| M22 | export: account block dropped | killed | 2 | 008 |
| M23 | export: rows not sorted (unstable order check) | survived first run; killed after adding the sort assertion | 0, then 1 | 008 |
| M24 | is_eligible: `not p.deleting` removed | killed | 3 | 008 |
| M25 | delete: only the profile row is deleted (auth user stays) | killed | 5 | 008 |
| M26 | export: leaks via account block of another user (id from first auth user) | killed | 1 | 008 |
| M27 | schema: app.outfit_logs user_id key changed to NO ACTION (missing cascade) | killed | 48 | 004, 008 |
| M28 | schema: app.profiles id key to auth.users changed to NO ACTION | killed | 58 | 004, 008 |
| M29 | schema: new app table without cascade or export owner column | killed | 13 | 003, 004, 005, 008 |
| M30 | schema: new auth-linked table in app referencing auth.users with NO ACTION | killed | 21 | 003, 004, 005, 008 |
