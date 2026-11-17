# WO-0087 mutation proof (R6c, Release 0)

Scratch copy of `jobs/collector` (plus the git-ignored password script and `config.toml`) in a temporary folder OUTSIDE the repository and OUTSIDE ~/.sparta-scratch (the session scratchpad), deleted afterwards. One mutant at a time, each a single text replacement in the scratch copy; the suite run for each was `tests/test_run_db.py` and `tests/test_store.py` (the WO-0087 tests; real local database as collector_role, local test server) with `-x`, so the first failing test is the one named. The repository files were never mutated.

Result: **37 of 37 killed** (the work order asks for at least 15). Two mutants (M36, M37) first SURVIVED because the Fetcher also reads COLLECTOR_REPO_URL from the real environment (the subprocess test could not tell); the in-process CLI test now passes the variable only through the CLI's env mapping and the mutants are killed (table shows the final run, repeated after the last test edits).

| # | File | Mutant | Result | Failing test |
|---|---|---|---|---|
| M01 | store.py | skip days 6 -> 7 | killed | `test_run_db.py::test_the_six_day_skip` |
| M02 | store.py | skip days 6 -> 5 | killed | `test_run_db.py::test_the_six_day_skip` |
| M03 | store.py | never-collected sources no longer selected | killed | `test_run_db.py::test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched` |
| M04 | store.py | selection ignores allowed | killed | `test_run_db.py::test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched` |
| M05 | store.py | --source id ignored by the selection | killed | `test_run_db.py::test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched` |
| M06 | store.py | upsert no longer checks allowed | killed | `test_run_db.py::test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched` |
| M07 | store.py | update keeps missed_runs | killed | `test_run_db.py::test_second_run_updates_in_place_and_resets_the_counters` |
| M08 | store.py | update keeps collected_at | killed | `test_run_db.py::test_second_run_updates_in_place_and_resets_the_counters` |
| M09 | store.py | status always overwritten (admin review lost) | killed | `test_run_db.py::test_review_work_by_an_admin_survives_the_next_run` |
| M10 | store.py | category/sub_type overwritten by null | killed | `test_run_db.py::test_review_work_by_an_admin_survives_the_next_run` |
| M11 | store.py | withdrawn row stays withdrawn when it reappears unmapped | killed | `test_run_db.py::test_a_withdrawn_row_that_reappears_unmapped_goes_back_to_review` |
| M12 | store.py | withdrawn rows keep counting | killed | `test_run_db.py::test_a_removed_page_withdraws_after_two_completed_runs_and_comes_back` |
| M13 | store.py | withdraw at 3 | killed | `test_run_db.py::test_a_removed_page_withdraws_after_two_completed_runs_and_comes_back` |
| M14 | store.py | withdraw at 1 | killed | `test_run_db.py::test_a_removed_page_withdraws_after_two_completed_runs_and_comes_back` |
| M15 | store.py | counts the SEEN rows instead of the unseen | killed | `test_run_db.py::test_first_run_inserts_with_review_rows_unmapped` |
| M16 | store.py | last_collected_at never set | killed | `test_run_db.py::test_first_run_inserts_with_review_rows_unmapped` |
| M17 | store.py | session role not checked | killed | `test_run_db.py::test_cli_refuses_a_session_that_is_not_collector_role` |
| M18 | store.py | hostaddr not checked | killed | `test_store.py::test_other_databases_are_refused_before_any_connection[postgresql://u:p@127.0.0.1/db?hostaddr=203.0.113.9]` |
| M19 | store.py | a URL without host accepted | killed | `test_store.py::test_other_databases_are_refused_before_any_connection[postgresql://u:p@/db]` |
| M20 | store.py | database guard always open | killed | `test_store.py::test_other_databases_are_refused_before_any_connection[postgresql://u:p@db.example.com:5432/postgres]` |
| M21 | run.py | early stop treated as completed | killed | `test_run_db.py::test_an_early_stop_counts_nothing_and_does_not_set_last_collected_at[robots]` |
| M22 | run.py | no per-source time budget | killed | `test_run_db.py::test_an_early_stop_counts_nothing_and_does_not_set_last_collected_at[budget]` |
| M23 | run.py | empty sitemap completes the run | killed | `test_run_db.py::test_an_unreadable_sitemap_stops_the_source_instead_of_withdrawing_the_catalogue[empty-empty_sitemap]` |
| M24 | run.py | sitemap status not checked | killed | `test_run_db.py::test_an_unreadable_sitemap_stops_the_source_instead_of_withdrawing_the_catalogue[gone-sitemap_unavailable]` |
| M25 | run.py | robots disallow stops the whole source | killed | `test_run_db.py::test_robots_disallow_mid_site_skips_the_page_and_the_run_completes` |
| M26 | run.py | records linking to another host kept | killed | `test_run_db.py::test_a_row_the_database_refuses_is_counted_and_the_run_goes_on` |
| M27 | run.py | a refused row aborts the run | killed | `test_run_db.py::test_a_row_the_database_refuses_is_counted_and_the_run_goes_on` |
| M28 | run.py | taken-down source keeps being fetched | killed | `test_run_db.py::test_allowed_false_and_taken_down_sources_are_never_selected_or_fetched` |
| M29 | run.py | seen rows not remembered | killed | `test_run_db.py::test_first_run_inserts_with_review_rows_unmapped` |
| M30 | run.py | inserted and updated swapped | killed | `test_run_db.py::test_first_run_inserts_with_review_rows_unmapped` |
| M31 | run.py | sitemap index not followed | killed | `test_run_db.py::test_a_sitemap_index_is_followed_one_level` |
| M32 | run.py | sitemap addresses on other hosts not filtered | killed | `test_run_db.py::test_first_run_inserts_with_review_rows_unmapped` |
| M33 | run.py | missed runs counted after a stop | killed | `test_run_db.py::test_an_early_stop_counts_nothing_and_does_not_set_last_collected_at[robots]` |
| M34 | __main__.py | CLI ignores --source | killed | `test_run_db.py::test_cli_prints_counts_only` |
| M35 | __main__.py | missing URL exits 0 | killed | `test_store.py::test_cli_without_a_database_url_or_with_a_remote_one_runs_nothing` |
| M36 | run.py | run loop drops the repository URL (user agent) | killed | `test_run_db.py::test_cli_prints_counts_only` |
| M37 | __main__.py | CLI ignores COLLECTOR_REPO_URL | killed | `test_run_db.py::test_cli_prints_counts_only` |

## Equivalent mutants (not counted, not killed, explained)
- Removing `and takedown_at is null` from the source selection or from the upsert guard: the database check `sources_allowed_ck` (WO-0083) already forbids `allowed = true` together with `takedown_at`, so no row can distinguish the two. The checks stay as defence in depth; the `allowed` half of each IS killed (M04, M06).
- Removing `vendor_id is null` from the missed-run update: row-level security for collector_role already hides every vendor row (policy `source_id is not null`), so the update cannot reach one. The vendor test (`test_vendor_rows_are_never_touched_or_visible`) proves the outcome, not the clause; the clause is defence in depth.
- Changing the budget comparison `>` to `>=`: the fake clock never lands exactly on the deadline with the 2 s spacing; the boundary has no observable meaning.
