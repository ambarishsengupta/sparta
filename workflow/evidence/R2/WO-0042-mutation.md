# WO-0042 mutation table: do the new assertions kill the reviewer's survivors?

Method: as WO-0041. Each mutant's SQL was applied to the running LOCAL database (container supabase_db_sparta, as postgres), `supabase test db` was run,
the result recorded, and the database restored with `supabase db reset` before the next one. Nothing outside the local stack was touched. The runner and the
mutant SQL are throwaway scripts in the session scratchpad (mutants.py is the independent reviewer's; wo42_run.py adds X01 to X13 and runs both sets).
A mutant is "killed" when `supabase test db` exits non-zero. "Before" is the reviewer's run against the WO-0041 suite (723 assertions, mutants.out);
"After" is the run against the WO-0042 suite (754 assertions: 003 +3, 004 +3, 005 +7, 006 +9, 007 +9).

Result: **all 30 reviewer mutants are killed (the 7 that survived, Q01, Q11, Q12, Q13, Q18, Q19 and Q29, now fail); 12 of the 13 extra mutants are killed.**
The one extra that does not fail, X04, is a control, not a weakness: a view created WITH security_invoker = true and no grant to anon is allowed by the new rule (F3), the
isolation loop in 004 then runs its three assertions on it (the suite plan grows with the number of views) and they pass, because such a view cannot show another user's rows.
Unmutated baseline after the changes: all 754 assertions pass (exit 0).

| ID | Mutation | Before (WO-0041 suite) | After (WO-0042 suite) | Failed assertions | Test files that failed |
| --- | --- | --- | --- | --- | --- |
| Q01 | view app.items_all (security definer view) granted to authenticated | survived | killed | 3 | 003,004 |
| Q02 | new security definer RPC app.export_all() returns every item, granted to authenticated | killed | killed | 1 | 003 |
| Q03 | analytics usage + definer function leaking items | killed | killed | 1 | 001 |
| Q04 | items_select: full gate OR category = Tops (text still has uid/role/consent) | killed | killed | 29 | 004,005,007 |
| Q05 | suggestion_feedback_select: full gate OR accepted | killed | killed | 4 | 004,005 |
| Q06 | tags_select: auth.uid() is not null instead of user_id = auth.uid() | killed | killed | 2 | 004 |
| Q07 | grant update (role) on app.profiles to authenticated (trigger still in place) | killed | killed | 1 | 003 |
| Q08 | outfit_plans: has_consent removed from all four policies | killed | killed | 5 | 003,005 |
| Q09 | app.accept_documents (definer) loses its search_path pin | killed | killed | 2 | 003 |
| Q10 | item_tags (tag_id, user_id) composite FK -> plain FK on tag_id | killed | killed | 1 | 004 |
| Q11 | item_collections (collection_id, user_id) composite FK -> plain FK | survived | killed | 1 | 004 |
| Q12 | outfit_items (outfit_id, user_id) composite FK -> plain FK | survived | killed | 1 | 004 |
| Q13 | item_tags (item_id, user_id) composite FK -> plain FK | survived | killed | 1 | 004 |
| Q14 | protect_profile_columns lets authenticated through | killed | killed | 3 | 005 |
| Q15 | accept_documents accepts a stale Privacy version | killed | killed | 3 | 006 |
| Q16 | ops.is_eligible ignores the Privacy Policy acceptance | killed | killed | 2 | 005 |
| Q17 | ops.is_eligible accepts any non-null country (supported list ignored) | killed | killed | 2 | 005 |
| Q18 | app.current_role trusts the JWT user_metadata.role (user-editable) | survived | killed | 5 | 003,005 |
| Q19 | handle_new_user takes the role from raw_user_meta_data (user-supplied at sign-up) | survived | killed | 4 | 003,006 |
| Q20 | check_item_features_owner checks only that the item exists | killed | killed | 4 | 004,007 |
| Q21 | archive trigger fires on archived_at instead of status | killed | killed | 1 | 007 |
| Q22 | colour trigger on items fires on insert only (not update) | killed | killed | 4 | 007 |
| Q23 | embedding check: 32 or 64 for any model version | killed | killed | 4 | 007 |
| Q24 | FORCE RLS dropped on app.profiles | killed | killed | 2 | 003 |
| Q25 | check_invitation matches by domain as well | killed | killed | 2 | 006 |
| Q26 | check_invitation becomes security definer | killed | killed | 1 | 003 |
| Q27 | outfit_items_active trigger on insert only (swap to archived item allowed) | killed | killed | 1 | 007 |
| Q28 | has_consent made security invoker with ops readable (grant usage+select on ops.settings to authenticated) | killed | killed | 5 | 001,003,004,006 |
| Q29 | consent_records_insert accepts any notice version >= current (string compare) | survived | killed | 1 | 005 |
| Q30 | app.public_setting whitelist removed (any ops key readable) | killed | killed | 1 | 004 |
| X01 | F2 current_role reads app_metadata.role from the JWT | n/a (new) | killed | 1 | 005 |
| X02 | F1 handle_new_user takes the role from raw_app_meta_data | n/a (new) | killed | 2 | 006 |
| X03 | F3 plain view of app.items in analytics schema granted to anon | n/a (new) | killed | 1 | 003 |
| X04 | F3 security_invoker view of app.items granted to authenticated (must be allowed, then isolation loop must hold) | n/a (new) | survived (control, see below) | 0 |  |
| X05 | F3 materialized view of app.items | n/a (new) | killed | 3 | 003,004 |
| X06 | F4 is_eligible accepts a notice version >= current | n/a (new) | killed | 1 | 005 |
| X07 | F4 is_eligible accepts a Terms version >= current | n/a (new) | killed | 1 | 005 |
| X08 | F4 accept_documents accepts any Terms version >= current | n/a (new) | killed | 2 | 006 |
| X09 | F9 rule_ids constraint dropped | n/a (new) | killed | 8 | 007 |
| X10 | F9 rule_ids constraint loosened to letters, digits, underscore and dash of any case (item ids pass) | n/a (new) | killed | 6 | 007 |
| X11 | F9 rule_ids constraint allows a NULL element | n/a (new) | killed | 1 | 007 |
| X12 | F10 invitations ASCII constraint dropped | n/a (new) | killed | 3 | 006 |
| X13 | F10 invitations ASCII constraint allows spaces and empty | n/a (new) | killed | 2 | 006 |

## Which assertion kills which survivor
- Q01 (plain view of app.items granted to authenticated): 003 "no view, materialized view or foreign table exists unless it is security_invoker with no grant to anon" (F3); 004 view loop (A reads B's rows through the view, twice).
- Q11, Q12, Q13 (plain keys instead of composite ones): the three new throws_ok cases in 004 (an item of A cannot join a collection of B; an item of A cannot be put in an outfit of B; a tag of A cannot be put on an item of B). Each fails with "no exception" under its mutant.
- Q18 (current_role trusts user_metadata): 005 "a vendor whose JWT claims user_metadata.role = consumer is still a vendor" and "reads zero rows from app.items" (F2), and 003 "no function in app, ops or catalog reads user_metadata or raw_user_meta_data".
- Q19 (handle_new_user takes the role from raw_user_meta_data): 006 "sign-up with role admin in the metadata gives a consumer" and its vendor twin (F1), and the same 003 catalog scan.
- Q29 (consent insert accepts notice_version >= current): 005 "a FUTURE notice version is refused (the check is equality, not >=)" (F4). The committed policy was already an equality test, so no policy change was needed.
