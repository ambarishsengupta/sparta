# WO-0086 mutation proof (R6c, collector fetch, robots, rate limit, extraction, mapping)

Method: scratch copy OUTSIDE the repository at `~/.sparta-scratch/wo0086` (jobs/collector plus the taxonomy, seed, gate.sh and collector_tests.sh files its tests read). Each mutant changes one fact in the copy, the whole pytest suite runs (`-x`), the file is restored. Driver: `~/.sparta-scratch/mutate.py` (outside the repo, not committed). Baseline in the copy: all tests pass.

Result: **48 of 48 mutants killed** (the work order asks for at least 15). First run killed 44 of 48; the four survivors were weak tests, fixed by adding or tightening tests (never by loosening one), then all 48 were re-run and killed.

| # | Mutant | Result | First failing test |
|---|---|---|---|
| M01 | guard returns for every host | killed | `test_guard_refuses_every_non_loopback_host_before_a_socket_opens[http://example.com/]` |
| M02 | live switch accepts any non-empty value | killed | `test_live_switch_is_exactly_one` |
| M03 | ::1 dropped from the loopback set | killed | `test_guard_allows_loopback[https://[::1]:8443/x]` |
| M04 | redirect hops use urlsplit instead of the guard | killed | `test_guard_refuses_every_non_loopback_host_before_a_socket_opens[http://example.com/]` |
| M05 | ProxyHandler({}) removed, env proxies honoured | killed | `test_proxy_settings_are_ignored` |
| M06 | urllib's own redirect handler restored | killed | `test_redirects_inside_the_site_are_followed_through_robots_and_the_limit` |
| M07 | only 404 counts as unavailable robots | killed | `test_4xx_robots_means_allow_all[400]` |
| M08 | robots 3xx without Location treated as allow-all instead of stop | killed | `test_robots_redirect_without_a_location_stops_the_source` |
| M09 | Crawl-delay ignored | killed | `test_crawl_delay_above_two_seconds_is_honoured_and_never_below_two[5-5.0]` |
| M10 | interval 1 s | killed | `test_at_most_one_request_per_two_seconds_including_robots` |
| M11 | one shared limiter for all sites | killed | `test_each_site_has_its_own_limit` |
| M12 | Retry-After ignored | killed | `test_retry_after_seconds_is_honoured` |
| M13 | Retry-After HTTP-date gives 0 | killed | `test_retry_after_http_date_is_honoured` |
| M14 | size cap off by one | killed | `test_response_over_five_megabytes_is_refused_and_exactly_five_is_kept` |
| M15 | declared Content-Length not checked | killed | `test_declared_length_over_the_cap_is_refused_before_reading` |
| M16 | 4 errors before stopping | killed | `test_three_consecutive_errors_stop_the_source_and_count_no_missed_run` |
| M17 | success does not reset the error count | killed | `test_a_success_resets_the_error_count` |
| M18 | Retry-After over 300 s never stops | killed | `test_retry_after_longer_than_five_minutes_stops_the_source` |
| M19 | stops count a missed run | killed | `test_5xx_robots_stops_the_source_without_counting_a_missed_run[500]` |
| M20 | robots errors retried | killed | `test_5xx_robots_stops_the_source_without_counting_a_missed_run[500]` |
| M21 | user agent name changed | killed | `test_user_agent_is_exact_and_sent_on_every_request` |
| M22 | backoff does not double | killed | `test_backoff_doubles_on_errors` |
| M23 | 10 redirect hops | killed | `test_redirect_loop_is_cut_after_three_hops` |
| M24 | user agent not sanitised | killed | `test_user_agent_cannot_carry_a_header_injection` |
| M25 | robots disallow never enforced | killed | `test_disallowed_path_is_refused_without_a_request_and_allowed_path_is_fetched` |
| M26 | robots refetched for every page | killed | `test_disallowed_path_is_refused_without_a_request_and_allowed_path_is_fetched` |
| M27 | gtin padded to 13 | killed | `test_single_product_page_gives_exactly_the_whitelisted_fields` |
| M28 | 10-digit gtin accepted | killed | `test_other_gtin_lengths_and_junk_are_dropped[1234567890]` |
| M29 | no sku fallback | killed | `test_graph_page_yields_only_the_product` |
| M30 | DOCTYPE/ENTITY check removed | killed | `test_doctype_or_entity_is_refused_before_the_parser_runs[xml0]` |
| M31 | ENTITY alone not refused | killed | `test_doctype_or_entity_is_refused_before_the_parser_runs[<urlset><!ENTITY` |
| M32 | DOCTYPE check case-sensitive | killed | `test_doctype_or_entity_is_refused_before_the_parser_runs[xml0]` |
| M33 | description added to the record | killed | `test_single_product_page_gives_exactly_the_whitelisted_fields` |
| M34 | sitemap hosts not filtered | killed | `test_a_sitemap_cannot_send_the_collector_to_another_host` |
| M35 | ItemList not walked | killed | `test_item_list_page_yields_listed_and_bare_products_and_skips_broken_json` |
| M36 | @graph not walked | killed | `test_graph_page_yields_only_the_product` |
| M37 | comma decimal read as thousands | killed | `test_graph_page_yields_only_the_product` |
| M38 | negative price accepted | killed | `test_price_parsing[-1-None]` |
| M39 | non-http product URL accepted | killed | `test_products_without_a_name_or_with_a_non_http_url_are_skipped[node3]` |
| M40 | hex without # accepted | killed | `test_unknown_colours_and_hex_lookalike_words_are_unmapped[facade]` |
| M41 | shortest colour key wins | killed | `test_family_names_and_retail_synonyms_map_to_the_family_reference_rgb[Stone` |
| M42 | CSS names before family names | killed | `test_family_names_and_retail_synonyms_map_to_the_family_reference_rgb[coral-Red]` |
| M43 | every row active | killed | `test_unmapped_rows_come_out_as_review_with_nulls[change0-nulls0]` |
| M44 | category hint before name | killed | `test_category_mapping[Denim` |
| M45 | Navy RGB differs from the swatch table (mapping JSON) | killed | `test_every_mapped_colour_family_exists_and_every_family_rgb_equals_the_swatch_table` |
| M46 | sub-type not in taxonomy (mapping JSON) | killed | `test_every_mapped_category_and_sub_type_exists_in_the_taxonomy[Hoodies]` |
| M47 | gate stage order swapped | killed | `test_gate_runs_collector_tests_after_worker_tests_with_a_hard_timeout` |
| M48 | gate hard timeout 3000 s | killed | `test_gate_runs_collector_tests_after_worker_tests_with_a_hard_timeout` |

## Survivors of the first run and what was done
- M08 (robots 3xx without Location): the 5xx path never reaches the `else` branch (it stops earlier), so no test covered that branch. Added `test_robots_redirect_without_a_location_stops_the_source`.
- M41 (shortest colour key wins): the mutant as first written changed only half of the comparison and was equivalent; rewritten to change both sides and the test `Stone Grey` (a longer key beating a shorter key at the same position) kills it.
- M44 (hint before name): the test hint was a plural that matches no keyword, so order did not matter; the hint is now the singular `Jacket`.
- M48 (timeout 3000 contains the text `timeout 300`): the gate-script test now looks for `timeout 300 ` with the trailing space.

No survivors remain. Equivalent mutants noted and not counted: removing the NUL-byte check in `parse_sitemap` still refuses UTF-16 input (expat reports not well-formed), so that line is defence in depth rather than a distinct behaviour.
