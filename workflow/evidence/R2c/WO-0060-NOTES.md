# WO-0060 notes: export and delete functions (database)

## Cascade audit (008_data_rights.test.sql, from the catalog; also checked by hand on 2026-11-05)
Every table of the `app` schema reaches `auth.users` through foreign keys that are all ON DELETE CASCADE. No migration for missing cascades was needed.

| Table | Chain to auth.users |
| --- | --- |
| app.profiles | id -> auth.users (cascade) |
| app.consent_records, document_acceptances, items, collections, tags, purchases, wishlist_entries, outfits, outfit_plans, outfit_logs, suggestion_feedback | user_id -> app.profiles (cascade) -> auth.users |
| app.item_features | user_id -> app.profiles (cascade); also item_id -> app.items (cascade) |
| app.item_collections, app.item_tags | user_id -> app.profiles (cascade); also composite keys to items and collections / tags (cascade) |
| app.outfit_items | user_id -> app.profiles (cascade); also composite keys to outfits and items (cascade) |
| Auth's own tables: identities, sessions (and refresh_tokens through sessions), mfa_factors, one_time_tokens, oauth_authorizations, oauth_consents, webauthn_credentials, webauthn_challenges, mfa_recovery_code_sets | user_id -> auth.users (cascade): the caller's sessions end with the delete |
| auth.scim_users | user_id -> auth.users is ON DELETE SET NULL (the only non-cascading key; SCIM is not used; a test pins it so a change is noticed) |

## Judgements
- Both functions are security definer, not invoker (the WO prefers invoker for export): a participant who fails the consent gate (new notice version, maintenance mode, unsupported country, deletion in progress) sees no rows of the gated tables through RLS, but FR-4, FR-9 and LLD 4.9 require that they can still export everything. Tests show the gate closed and the export complete.
- `not p.deleting` was added to `ops.is_eligible` (and so to `app.has_consent()`): no existing test sets `deleting` and then checks access, all 754 earlier assertions pass, and 008 tests it.
- The export document has the header keys `format_version` (1), `generated_at`, `account` (id, email, created_at from auth.users) and one top-level key per app table. A test fails if a table is named like a header key.
- delete_my_account also removes the caller's `ops.invitations` entry (FR-63 names it; it holds the email); returns `deleted` or `already_deleted`.
- `ops.deletion_log` (LLD 13.3) does not exist in the schema (skipped in R2a); this WO writes only the day count, as instructed. The 30-day restore log is not built here.
- Existing test edited: the exact list of functions `authenticated` can execute in 003 gained `app.delete_my_account` and `app.export_my_data` (a longer documented list; nothing weakened).
