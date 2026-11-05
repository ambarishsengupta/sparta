# R2a WO-0041 notes: what was built, what was skipped, gaps, and the hook

## Built (migrations 4 to 7, tests 003 to 007)
- ops: `settings` (seeded keys of LLD 4.9), `invitations`, `daily_counts`; the Before User Created hook function `ops.check_invitation(jsonb)`.
- app: `profiles`, `consent_records`, `document_acceptances`, `items`, `item_features`, `purchases`, `wishlist_entries`, `collections`,
  `item_collections`, `tags`, `item_tags`, `outfits`, `outfit_items`, `outfit_plans`, `outfit_logs`, `suggestion_feedback`.
- Functions: `app.current_role`, `ops.is_eligible`, `app.has_consent`, `app.supported_countries`, `app.public_setting`,
  `app.accept_documents`, `app.complete_onboarding`, `app.handle_new_user` (+ trigger on `auth.users`), and the row triggers
  (colour on items and wishlist_entries, taxonomy arrays, updated_at, protected profile columns, archive flag, active-item rule,
  item_features ownership).

## Skipped (belongs to R3 and later, or outside WO-0041)
- `app.jobs`, `app.receipts`, `app.purchase_receipts` (job queue, storage, receipt scan: R5/R6); `app.analytics_events` (analytics: R7).
- Storage buckets and storage policies, `app.storage_used()`; vendor tables and agreement policies; `catalog.catalog_items`,
  `catalog.sources`, `catalog.feed_uploads`; limited roles (`worker_role`, `collector_role`, `fx_role`, `backup_role`).
- `ops.fx_rates` and `app.latest_fx_rates()` (FX is out of the R2 fence); `ops.deletion_log`, `ops.admin_audit_log`, `ops.worker_heartbeat`.
- `app.custom_access_token_hook` (LLD section 10) and the `supabase_auth_admin` select on `app.profiles` it needs: not listed in
  WO-0041; R2b needs it only if the interface reads the role from the JWT.
- The foreign key from `items.catalog_item_id` and `wishlist_entries.catalog_item_id` to `catalog.catalog_items`: that table is created in R6;
  the columns exist without the constraint, and the R6 migration adds it (`on delete set null`).
- Skip aggregation, `pg_cron` jobs (the extension is installed by WO-0040; no job is scheduled).

## The Before User Created hook: wired in supabase/config.toml
Supported in Supabase CLI 3.0.0. The hook function is a plain Postgres function and the CLI accepts a `pg-functions://` URI. The committed
`supabase/config.toml` carries the block (commit d056801, together with `minimum_password_length = 10` and `enable_confirmations = true`,
LLD section 10):

    [auth.hook.before_user_created]
    enabled = true
    uri = "pg-functions://postgres/ops/check_invitation"

Applying it to a running local stack needs `supabase stop && supabase start` (an Auth config change is not reloaded by `supabase db reset`);
hosted projects need `supabase config push` (LLD 4.9). The earlier `hook-config.patch` is gone (WO-0042 F6): the change is committed.

End-to-end evidence from WO-0041 (local stack, hook enabled, Auth API called with the publishable key read at run time; no key is stored or printed):

    sign-up stranger.e2e@example.test      -> HTTP 403 {"code":403,"error_code":"unknown","msg":"Sparta is invitation-only during the pilot."}
    sign-up Invited.E2E@example.test       -> HTTP 200 (invited as invited.e2e@example.test; the match is case-insensitive)
    afterwards: auth.users 1 row, app.profiles 1 row (created by app.handle_new_user running under supabase_auth_admin),
                ops.invitations.accepted_at set

So the grants chosen for the hook (usage on `ops`, execute on `ops.check_invitation`, select on `ops.invitations`, select policy) are
sufficient, and the sign-up trigger runs correctly when Auth inserts the user. The pgTAP suite cannot `SET ROLE supabase_auth_admin`
(the session role is not a member of it), so 006 asserts that role's access from the catalog; the run above is the runtime proof.
Recommend a vitest integration test for it in R2b.

## LATER (found in WO-0042, not done)
- `ops.invitations.accepted_at` is still set when the account row is created, not when the email is confirmed (WO-0042 F10, second half).
  With `enable_confirmations = true` the right moment is the update of `auth.users.email_confirmed_at`. That needs a second trigger on
  `auth.users` (after update of email_confirmed_at) and `handle_new_user` to stop setting the field, which contradicts the existing 006
  assertion "sign-up marks the invitation accepted" (inserted without a confirmation time). Changing the meaning of an existing test
  is not allowed in a fix loop, so it is left for the release that adds the sign-in screens (R2b), where the test can be rewritten with the flow.
- `ops.check_invitation` still lower-cases the incoming address with `lower()`; with the stored side now ASCII-only (F10) a non-ASCII
  sign-up address can only match through characters that lower-case to ASCII (for example the Kelvin sign). Refusing non-ASCII input in the hook is a one-line change for R2b.

## Deviations from the LLD / WO text (all additive hardening, none weakens a rule)
1. Composite foreign keys `(parent_id, user_id)` on every link table and on `purchases` (parents get `unique (id, user_id)`), because
   foreign-key checks bypass RLS: with plain keys user A could attach A's rows to B's items, or have B's deletions cascade into A's rows.
2. `app.protect_profile_columns()` trigger as a second layer under the column grants of LLD 4.5 (role, age_confirmed, deleting,
   deletion_requested_at, id, created_at change only for postgres, supabase_admin and service_role).
3. Format checks on `profiles.country` (`^[A-Z]{2}$`), `profiles.currency`, and `suggestion_feedback.engine_config`
   (`^[A-Za-z0-9:;._-]{1,64}$`, so no free text can reach the table that is meant to hold no personal data).
4. One policy per operation, generated by a loop in migration 7, instead of the single `for all` policy of LLD 4.5; grants match the
   policies one to one (no delete on `items`, LLD 4.6; append-only `outfit_logs` links, `suggestion_feedback`, `consent_records`).
5. `accept_documents` and `complete_onboarding` require `role = 'consumer'` (vendors have their own agreement flow, LLD 4.9).
6. `garment_class` is limited per version (0 to 9 for `garment-cnn-v1`, 0 to 19 for `garment-cnn-v2`, LLD 4.4); the WO text says "0..19".
7. `item_features.embedding` is `not null` and must be one-dimensional.
8. `planned_month` is a `date` that must be the first of a month (LLD names the column without a type).

## Document gaps and conflicts
- LLD 4.4 describes `wishlist_entries.origin` as added later "by the migration that adds Wardrobe unlock", with existing rows becoming
  `user`; WO-0041 asks for the column now. It is created with the table (`not null default 'user'`, check in `('user','unlock')`), so no later migration is needed.
- LLD 4.4 lists `model_version` as "version 1 / version 2" in the `item_features` row, but LLD 7.3 and 7.8 store the strings
  `garment-cnn-v1` / `garment-cnn-v2`. The strings are used (they are also what WO-0041 names).
- LLD section 10 wants a minimum password length of 10 and verified email (FR-1). Resolved in commit d056801: `supabase/config.toml` has
  `minimum_password_length = 10` and `enable_confirmations = true` (hosted projects must carry the same settings via `supabase config push`).
- LLD 4.5 shows `set search_path = app` / `app, ops` on the definer helpers; the stricter empty path with qualified names is used throughout (WO-0041).
- LLD does not say what a user in the middle of deletion (`deleting = true`) may do. The policies do not special-case it
  (the delete route removes the auth user, which cascades). If the owner wants such a user locked out earlier, add `not deleting` to `ops.is_eligible`.
- WO-0041's In scope omitted `supabase/config.toml` although its Instructions asked to wire the hook; the hook was wired afterwards (d056801).

## Counted lines and commit split
Migrations 4 to 7: 545 lines (60 + 225 + 192 + 68). pgTAP: 003 to 007 about 660 lines plus `helpers.inc` 144. Over the 500-line limit, so the work
is two commits' worth: (1) the four migrations; (2) the tests, `helpers.inc` and `workflow/evidence/R2/**`. Assertions: 630 new (003: 76, 004: 276, 005: 131, 006: 56, 007: 91); the whole
suite is 723 with WO-0040's 93 (`supabase test db`: Files=7, Tests=723).

## Test design notes
- The isolation loop (004) is derived from `pg_class`; each table needs an insert template in `helpers.inc` (`pg_temp.tpl`) or the "every app table has an
  insert template" assertion fails. A table without RLS enabled and forced, without a policy, or with an unexpected grant fails 003.
- Attacks are written both with and without a WHERE clause: an UPDATE or DELETE with a WHERE clause also needs the SELECT policy, which can mask a weakened
  update or delete policy (found by mutant M05, see WO-0041-mutation.md).
- BEFORE triggers run before the row-level-security check on INSERT, so some refused inserts report the trigger's error (23503 for item_features, 23514 for
  outfit_items) instead of 42501. The suite asserts the exact code per table.
- The committed config enables the hook, so a stack started from it (`supabase stop && supabase start`) refuses sign-ups from addresses that are not invited.
