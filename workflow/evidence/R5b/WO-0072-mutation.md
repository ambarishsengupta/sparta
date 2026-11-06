# WO-0072 mutation proof (scratch copy of services/worker; the repo files are never edited)

Harness: copy `services/worker` to a scratch folder (symlinks to ml, packages, supabase), apply ONE textual change that must match exactly once, run the whole pytest suite (`-x`), record the first failing test. 30 mutants, 30 KILLED. In the first pass M15 (near-white skip) and M24 (`>=` to `>`) SURVIVED; the tests `test_dominant_colour_skips_near_white_and_transparent` (assert the blue patch is the answer) and `test_confidence_boundary_is_inclusive_with_a_stubbed_session` were added, and both are killed now. Table below is the final pass.

| id | mutant | result | first failing test |
| --- | --- | --- | --- |
| M01 | host rewrite never applied | KILLED | tests/test_storage_urls.py::test_local_url_is_rewritten_to_the_configured_host |
| M02 | cloud URLs rewritten too | KILLED | tests/test_storage_urls.py::test_cloud_url_is_never_rewritten - Assert... |
| M03 | plain http to any host accepted | KILLED | tests/test_storage_urls.py::test_bad_signed_urls_are_refused[http://evil.example/storage/v1/object/sign |
| M04 | URL without token accepted | KILLED | tests/test_storage_urls.py::test_bad_signed_urls_are_refused[https://abc.supabase.co/storage/v1/object/ |
| M05 | download size limit effectively removed | KILLED | tests/test_storage_urls.py::test_download_stops_at_the_size_limit - Fa... |
| M06 | rewrite allow-list removed | KILLED | tests/test_config.py::test_rewrite_allow_list_rejects[evil.example:54321] |
| M07 | guess ON by default | KILLED | tests/test_config.py::test_defaults_guess_off_and_model_v1 - Assertion... |
| M08 | model version 2 accepted | KILLED | tests/test_config.py::test_model_version_2_is_refused - Failed: DID NO... |
| M09 | 5 MB limit raised | KILLED | tests/test_images.py::test_picture_over_5_mb_is_refused_before_decoding |
| M10 | animated pictures accepted | KILLED | tests/test_images.py::test_animated_pictures_are_refused - Failed: DID... |
| M11 | EXIF rotation ignored | KILLED | tests/test_handler.py::test_exif_rotated_photo_is_processed_upright - ... |
| M12 | 6000 px side limit raised | KILLED | tests/test_images.py::test_more_than_6000_pixels_on_the_long_side_is_refused |
| M13 | WebP quality changed | KILLED | tests/test_images.py::test_webp_quality_is_80 - assert (95 == 80) |
| M14 | thumbnail size changed | KILLED | tests/test_images.py::test_outputs_sizes_format_and_transparency - ass... |
| M15 | near-white wall can be the dominant colour | KILLED | tests/test_images.py::test_dominant_colour_skips_near_white_and_transparent |
| M16 | upload paths not checked | KILLED | tests/test_handler.py::test_upload_paths_must_be_in_the_owners_folder_with_the_job_id |
| M17 | garment error fails the job | KILLED | tests/test_handler.py::test_a_failing_garment_step_neither_fails_nor_retries_the_job |
| M18 | garment step never runs | KILLED | tests/test_handler.py::test_result_follows_the_lld_7_3_schema_and_uploads_three_files |
| M19 | permanent errors are retried | KILLED | tests/test_loop_fakes.py::test_a_rejected_picture_fails_at_once_without_retry |
| M20 | exception text stored in last_error | KILLED | tests/test_db.py::test_error_text_never_reaches_last_error - Assertion... |
| M21 | done write without the attempts check | KILLED | tests/test_db.py::test_a_stale_claim_cannot_write_its_result - Asserti... |
| M22 | retry not delayed | KILLED | tests/test_db.py::test_retry_requeues_30_seconds_later_and_keeps_the_error |
| M23 | more than 3 attempts | KILLED | tests/test_db.py::test_third_failure_is_final - psycopg.errors.CheckVi... |
| M24 | threshold boundary | KILLED | tests/test_preprocess_and_garment.py::test_confidence_boundary_is_inclusive_with_a_stubbed_session |
| M25 | category set below the threshold | KILLED | tests/test_preprocess_and_garment.py::test_the_threshold_decides_exactly_at_p |
| M26 | API docs exposed | KILLED | tests/test_app_and_background.py::test_health_is_the_only_route_and_docs_are_off |
| M27 | heartbeat too often | KILLED | tests/test_loop_fakes.py::test_heartbeat_every_60_seconds_not_more_often |
| M28 | preprocess copy drifts from the original | KILLED | tests/test_preprocess_and_garment.py::test_preprocess_copy_is_byte_identical_to_the_ml_original |
| M29 | bearer token not sent | KILLED | tests/test_storage_urls.py::test_signed_urls_request_has_bearer_and_exact_body |
| M30 | HTTP client logging left at INFO | KILLED | tests/test_app_and_background.py::test_http_client_loggers_are_silenced_below_warning |
