# WO-0080 notes (R6a, database): receipts, purchase links, exchange rates, wishlist bought, receipt confirmation

New migrations (nothing old edited): 20261106140000 receipts and purchase_receipts; 140100 fx_rates, latest_fx_rates, fx_role; 140200 the two builders, wishlist_bought, confirm_receipt; 140300 the receipt-job purge and its pg_cron job.
New test: supabase/tests/database/012_wo0080_receipts_fx_purchases.test.sql (173 assertions). Whole pgTAP run: 12 files, 1781 tests, all pass. Mutation: WO-0080-mutation.md (40 of 40 killed).

## Decisions the app work orders must know
- `app.confirm_receipt(p_job_id, p_lines)`: `p_lines` is a JSON ARRAY (1 to 200). Line: `{action: new|match|skip, qty (default 1), amount (a JSON number, the printed LINE total), catalog_item_id (match only, required there, refused on new), store, date, currency (optional per line), and the item keys: name, category, sub_type, colour_r, colour_g, colour_b, brand, fit, material, pattern, size_system, size_value, seasons, occasions, condition}`. Any other key is refused. Missing store, date or currency come from the job's `result` (store, date, currency), currency also from the job's `input.currency`. The receipt row gets the first confirmed line's store, date and currency (else the job result's) and total = sum of confirmed amounts. Returns `{receipt_id, items: [ids], purchases: [ids]}`. Errors (message, SQLSTATE): job_not_found, job_not_done, receipt_not_found, already_confirmed (all P0001); invalid_lines (22023). Nothing in a message echoes input.
- The purchase created from a line stores the UNIT price `round(amount / qty, 2)` and `quantity = qty`, so spend is price * quantity everywhere. This is my decision (the work order does not say); WO-0081 should use the same meaning in the purchase form.
- `app.wishlist_bought(p_entry, p_item, p_purchase)`: the item starts from the entry (name, category, sub_type, colour, brand, fit, size, seasons, catalog_item_id); `p_item` overrides with the same keys as above; `p_purchase` keys: purchase_date, store, price, currency, quantity, notes. Errors: entry_not_found (P0001, also for another user's entry), already_bought (P0001), invalid_input (22023).
- `app.insert_item_from_json` and `app.insert_purchase_from_json` are executable by `authenticated` only because invoker functions must be callable by the caller; they do what a direct insert already allows, and are listed in pgTAP 003's function list.
- `receipts.job_id` has NO foreign key to app.jobs (deviation from a "natural" design): a set-null key into app.jobs would be a non-cascading key into app.*, which pgTAP 008 forbids, and the daily purge deletes the job rows while the receipt must stay. Ownership of job_id is enforced by the update policy (own receipt job only) and by confirm_receipt. `job_id` is unique (one receipt per job). `storage_path` is also unique.
- `receipts`: authenticated inserts only user_id, storage_path, store, receipt_date, currency, total (no id, job_id, confirmed_at) and updates only store, receipt_date, currency, total, job_id, confirmed_at. No delete grant (LLD 4.6); rows go through the server route. `purchase_receipts`: select, insert, delete.
- `catalog_item_id` has no foreign key yet (R6b adds it); a `match` line with an unknown id is accepted until then, and refused (invalid_lines) after.
- `fx_role` has select as well as insert and update on ops.fx_rates (an upsert needs select); it is NOLOGIN, no password anywhere, usage on schema ops only.
- The purchases index of LLD 4.7 already existed (`purchases_user_date`); nothing added.
- Purge: `app.purge_receipt_jobs()` (definer, owner only) deletes receipt jobs with finished_at older than 7 days (done and failed); pg_cron `sparta-purge-receipt-jobs` at 03:17 daily. Receipts and purchases stay.

## Existing tests changed (extensions only, nothing weakened, skipped or deleted)
- helpers.inc: `want` rows and `tpl` templates for the two new tables, and two receipts with known ids made in `seed_user`.
- 003: the exact table list and the exact list of functions `authenticated` may execute now include the new ones.
- 004 and 005: the generic "update with no WHERE / update B's rows" statements use `set store = ...` for `receipts` (its update grant is column-limited, so `set user_id` is refused with 42501 before RLS). The assertions and expected results are unchanged.
- 008: ops table list now includes fx_rates; zero-argument function list now includes latest_fx_rates and purge_receipt_jobs; plan constant 209 to 205 (the new tables add 8 assertions each, not 11).
- 009: plan 295 to 297 (two more app tables, one "the worker cannot read" assertion each).

## Not done / not verified
- No app, worker or package code (out of scope). The two new tables are not yet used by the web app.
- Hosted-project behaviour (pg_cron present locally; the schedule is created only when the extension exists, as for the reaper).
