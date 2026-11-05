# WO-0041 mutation table: does the pgTAP suite have teeth?

Method: for each mutant, the mutation SQL was applied to the running LOCAL database (container supabase_db_sparta, as postgres), `supabase test db`
was run (7 files, 723 assertions when unmutated), the result recorded, and the database restored with `supabase db reset` before the next one.
Nothing outside the local stack was touched. The runner was a throwaway script in the scratchpad; the "Mutation" column describes each change (for the
function mutants it is the committed function body with the one change named). A mutant is "killed" when `supabase test db` exits non-zero.

Result: **44 of 44 mutants killed, 0 survived.** Unmutated baseline: all 723 assertions pass (exit 0).

First round: 40 mutants; one survived (M05, outfits_update WITH CHECK widened) and two more (M08, M42) were caught only by catalog checks. Cause: an UPDATE or
DELETE with a WHERE clause also needs the SELECT policy, which hid the rows, so an attack written with a WHERE clause could not see a weakened update or delete
policy. Fix: the suite now also attacks with statements that have NO WHERE clause, as a user who owns nothing (004) and as a user who fails the gate (005), so
each update and delete policy is tested on its own. The table is the second, final round: 44 mutants, including four added for those cases (M41 to M44).
M42 was re-run alone after the last test fix (005 uses a constant SET, not a column read) and is now killed by behaviour as well.

| ID | Class | Mutation | Result | Failed assertions | Test files that failed | First failing assertion |
| --- | --- | --- | --- | --- | --- | --- |
| M01 | policy | items_select USING widened to true | killed | 29 | 003, 004, 005, 007 | every app policy is tied to auth.uid() |
| M02 | policy | FORCE RLS dropped on app.items | killed | 2 | 003 | RLS is enabled and forced on app.items (owner postgres has BYPASSRLS, so FORCE has no runtime effect for it; only the catalog check can see it) |
| M03 | policy | RLS disabled on app.outfits | killed | 30 | 003, 004, 005 | RLS is enabled and forced on app.outfits |
| M04 | policy | wishlist_entries_insert policy dropped | killed | 9 | 003, 004, 007 | every granted operation has a policy and every policy has its grant |
| M05 | policy | outfits_update WITH CHECK widened to true (a row can be handed to another user) | killed | 1 | 004 | A cannot hand A's own rows in app.outfits to B |
| M06 | policy | consent gate removed from items_select | killed | 15 | 003, 005 | every gated app policy calls has_consent |
| M07 | policy | consumer-role check removed from outfits_select (a vendor reads consumer rows) | killed | 2 | 003, 005 | every gated app policy checks the consumer role |
| M08 | policy | tags_delete USING widened to any row with consent (cross-user delete) | killed | 10 | 003, 004 | every app policy is tied to auth.uid() |
| M09 | policy | consent_records_insert loses the current-version check | killed | 1 | 005 | a stale notice version is refused |
| M10 | policy | profiles_select widened to every profile | killed | 3 | 003, 004 | every app policy is tied to auth.uid() |
| M11 | policy | profiles_update policy dropped | killed | 8 | 003, 004, 005, 007 | every granted operation has a policy and every policy has its grant |
| M12 | policy | document_acceptances insert policy added (a client could forge an acceptance) | killed | 4 | 003, 004, 005 | authenticated holds exactly the documented privilege on each app table |
| M13 | grant | table-level UPDATE on profiles granted to authenticated | killed | 7 | 003 | no table-level insert or update on profiles (the protect_profile_columns trigger still refuses role/age_confirmed/deleting; the catalog (grant) check is what fails) |
| M14 | grant | SELECT on app.items granted to anon | killed | 2 | 003, 004 | anon has no privilege on any app or ops table |
| M15 | grant | DELETE on app.items granted to authenticated (LLD 4.6 says no) | killed | 5 | 003, 004, 005, 007 | authenticated holds exactly the documented privilege on each app table |
| M16 | grant | TRUNCATE on app.items granted to authenticated | killed | 1 | 003 | authenticated cannot truncate, reference or trigger any app table (TRUNCATE is not exercised as a statement; the catalog privilege check fails) |
| M17 | grant | EXECUTE on ops.is_eligible granted to authenticated | killed | 2 | 003 | authenticated can execute exactly the documented functions (authenticated still has no usage on schema ops, so a call fails anyway; the catalog check fails) |
| M18 | grant | EXECUTE on app.has_consent granted to anon | killed | 2 | 003, 004 | anon can execute nothing but app.supported_countries |
| M19 | grant | accepted_at insert granted on consent_records (forged acceptance time) | killed | 3 | 003, 005 | consent records accept only user_id and notice_version from clients |
| M20 | trigger | profiles_protect trigger dropped AND role column granted (grant layer and trigger layer both gone) | killed | 7 | 003, 005 | authenticated cannot update profiles.role |
| M21 | trigger | profiles_protect trigger dropped (grants still hold) | killed | 4 | 003, 005 | profiles has the protected-column trigger |
| M22 | trigger | item_features_owner trigger dropped | killed | 10 | 003, 004, 005, 007 | item_features has the ownership trigger |
| M23 | trigger | items_archive_flag trigger dropped | killed | 3 | 003, 007 | items has the archive trigger |
| M24 | trigger | outfit_items_active trigger dropped | killed | 6 | 003, 004, 005, 007 | outfit_items has the active-item trigger |
| M25 | trigger | items_colour trigger dropped | killed | 6 | 003, 007 | items has the colour trigger |
| M26 | trigger | wishlist_entries_colour trigger dropped | killed | 4 | 003, 007 | wishlist_entries has the colour trigger |
| M27 | trigger | items_taxonomy trigger dropped | killed | 5 | 003, 007 | the taxonomy array check is on every table with seasons or occasions |
| M28 | trigger | sign-up trigger dropped from auth.users | killed | 530 | 003, 004, 005, 006, 007 | auth.users has the sign-up trigger |
| M29 | constraint | item_features embedding-length check dropped | killed | 6 | 007 | a 64-number embedding is refused for model version 1 |
| M30 | constraint | composite foreign key outfit_items(item_id,user_id) replaced by a plain foreign key | killed | 1 | 004 | an item of B cannot be put in an outfit of A |
| M31 | function | ops.is_eligible ignores age_confirmed | killed | 1 | 005 | gate: age not confirmed blocks data, and restoring it reopens the gate |
| M32 | function | app.has_consent ignores maintenance mode | killed | 1 | 005 | gate: maintenance mode blocks data, and restoring it reopens the gate |
| M33 | function | app.current_role always answers consumer | killed | 31 | 005 | gate: a vendor account blocks data, and restoring it reopens the gate |
| M34 | function | ops.check_invitation allows every address | killed | 6 | 006 | an email that is not invited gets the FR-8 error |
| M35 | function | app.complete_onboarding never reports unsupported_country | killed | 2 | 006 | a country that is not on the list gives unsupported_country |
| M36 | function | app.has_consent loses search_path pin | killed | 2 | 003 | every security definer function pins search_path to the empty path (search_path is not observable from behaviour; the catalog hygiene check fails) |
| M37 | schema | a new app table without RLS (app.zz_new) | killed | 21 | 003, 004, 005 | the app schema holds exactly the R2 tables |
| M38 | function | ops.check_invitation compares case-sensitively | killed | 1 | 006 | the match ignores case |
| M39 | function | ops.check_invitation returns a different refusal message | killed | 2 | 006 | an email that is not invited gets the FR-8 error |
| M40 | function | app.accept_documents no longer requires the age tick | killed | 3 | 006 | without the age tick it raises age_not_confirmed |
| M41 | policy | consent gate removed from outfits_delete | killed | 2 | 003, 005 | every gated app policy calls has_consent |
| M42 | policy | consent gate removed from items_update (USING and WITH CHECK) | killed | 2 | 003, 005 | every gated app policy calls has_consent |
| M43 | policy | collections_delete USING widened to true | killed | 12 | 003, 004, 005 | every app policy is tied to auth.uid() |
| M44 | policy | item_collections_insert WITH CHECK widened to true | killed | 7 | 003, 004, 005 | every app policy is tied to auth.uid() |

Reading the structure-only kills (M02, M13, M16, M17, M36): they fail only the catalog assertions of 003, because a second layer (the table owner's BYPASSRLS, the
profile trigger, the missing schema usage) makes the mutation invisible to behaviour. That is the intended defence in depth; the catalog assertions are what keep
each layer honest. All other mutants are killed by behaviour (004 to 007) as well.

Equivalent-mutant note: dropping FORCE ROW LEVEL SECURITY (M02) cannot change runtime behaviour on this stack, because `postgres` (the table owner) has BYPASSRLS
and the client roles are not owners. FORCE is asserted from the catalog as LLD 4.5 and WO-0041 require.
