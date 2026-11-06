# WO-0062 mutation table

Method: as WO-0060. Database mutants (Y01-Y25, X18-X20) were applied to the running LOCAL database as postgres (a `create or replace` of the function with one edit), `supabase test db` was run (killed = non-zero exit), and the database was restored with `supabase db reset` after every mutant. Scratch-copy mutants (W01-W27) were made in a copy of the repository outside it (scratchpad), one edit each, running the web tests of that copy (W27 runs the real-stack suite). The scratch copy lacks docs/, data/ and the evidence folder, so six test files fail there even unmutated; those files are ignored when deciding a kill. Runners are throwaway scripts in the session scratchpad; nothing outside the local stack was touched.

Result: **28 of 28 database mutants killed, 27 of 27 scratch-copy mutants killed.** Runs that did not count at first: Y10 survived because my edit changed only one of the two places the check appears (a faulty mutant; the edit was fixed and Y10 is killed), Y16 had a syntax error in the mutant (fixed, killed), and X20 (has_consent reading the user from app_metadata, key assembled from pieces) SURVIVED because the behavioural scan compared only A with and without spoofing claims, and A and B are both eligible consumers; the scan was extended with a vendor caller W whose answers differ from B (plus two non-vacuity assertions) and X20 is then killed. Two more refusal cases (email/signup, token_refresh) were added to 008 after the database mutants ran; the final suite passes (see the report).

## Database mutants

| ID | Mutation | Result | Failed assertions | Test files |
| --- | --- | --- | --- | --- |
| Y01 | window ignored (any age accepted) | killed | 16 | 008 |
| Y02 | method ignored (any method with a fresh timestamp) | killed | 8 | 008 |
| Y03 | timestamp ignored (a primary method alone is enough) | killed | 19 | 008 |
| Y04 | amr trusted from user_metadata when the token has none | killed | 3 | 003,008 |
| Y05 | amr read only from user_metadata | killed | 88 | 003,008 |
| Y06 | future timestamps accepted | killed | 3 | 008 |
| Y07 | no clock skew allowed (a timestamp ahead of the database clock refused) | killed | 2 | 008 |
| Y08 | window setting ignored (constant 1 second) | killed | 6 | 008 |
| Y09 | a bad setting means a zero window instead of 300 | killed | 3 | 008 |
| Y10 | timestamp type not checked (text timestamps cast) | killed | 5 | 008 |
| Y11 | the whole re-authentication check removed | killed | 46 | 008 |
| Y12 | an empty or missing amr counts as fresh | killed | 5 | 008 |
| Y13 | the sso/saml method is not accepted | killed | 2 | 008 |
| Y14 | totp counts as a primary sign-in | killed | 3 | 008 |
| Y15 | refusal message changed to forbidden | killed | 43 | 008 |
| Y16 | audit log: no cleanup | killed | 4 | 008 |
| Y17 | audit log: user id only (the e-mail address is left) | killed | 2 | 008 |
| Y18 | audit log: e-mail only (entries naming the id alone are left) | killed | 3 | 008 |
| Y19 | audit log: e-mail matched case-sensitively | killed | 2 | 008 |
| Y20 | audit log: id matched case-sensitively | killed | 3 | 008 |
| Y21 | audit log: removes every entry (where true) | killed | 4 | 008 |
| Y22 | audit log: cleanup only when a user was deleted (retry leaves entries) | killed | 1 | 008 |
| Y23 | account without a profile row may be deleted (fail open) | killed | 2 | 008 |
| Y24 | non-consumer check removed | killed | 19 | 008 |
| Y25 | delete: user id taken from user_metadata when present (X18 in delete) | killed | 5 | 003,008 |
| X18 | export: user id taken from user_metadata.sub when present | killed | 6 | 003,008 |
| X19 | export: user id from metadata, key assembled from pieces (evades a text scan) | killed | 5 | 008 |
| X20 | has_consent: user id from app_metadata.user_id when present (assembled key) | killed | 1 | 008 |

## Scratch-copy mutants (web)

| ID | Mutation | Result | Failed tests | Test files that failed |
| --- | --- | --- | --- | --- |
| W01 | closing hashes: back to the quadratic pattern | killed | 3 | components/legal/markdown-time.test.ts |
| W02 | closing hashes: never stripped | killed | 12 | components/legal/markdown-time.test.ts |
| W03 | closing hashes: stripped even without a space before them (C# becomes C) | killed | 8 | components/legal/markdown-time.test.ts |
| W04 | closeParen does not spend the work budget | killed | 6 | components/legal/markdown-time.test.ts |
| W05 | find does not spend the work budget (informational) | killed | 6 | components/legal/markdown-time.test.ts |
| W06 | heading reader: a line separator inside is accepted (old pattern meaning lost) | killed | 6 | components/legal/markdown-time.test.ts |
| W07 | list-item reader: ten-digit numbers accepted | killed | 6 | components/legal/markdown-time.test.ts |
| W08 | cookie expiry without Path=/ | killed | 7 | components/account/browser-data.test.ts |
| W09 | cookie expiry with Max-Age=1 | killed | 7 | components/account/browser-data.test.ts |
| W10 | only the first session cookie is expired | killed | 6 | components/account/browser-data.test.ts |
| W11 | cookie filter widened (sbx also expired) | killed | 6 | components/account/browser-data.test.ts |
| W12 | Leave form no longer clears the usage log | killed | 6 | components/account/browser-data.test.ts |
| W13 | Sign-out form no longer clears the usage log | killed | 6 | components/account/browser-data.test.ts |
| W14 | Sign-out form cancels the post | killed | 6 | components/account/browser-data.test.ts |
| W15 | settings keys are not cleared | killed | 8 | components/account/browser-data.test.ts |
| W16 | keys removed while iterating (no snapshot) | killed | 8 | components/account/browser-data.test.ts |
| W17 | reauthentication_required is not mapped (falls to the generic refusal) | killed | 7 | components/account/account-actions.test.ts |
| W18 | reauthentication_required mapped to "unsure" | killed | 7 | components/account/account-actions.test.ts |
| W19 | pilot notice: no Export / Leave / Sign out section | killed | 5 | components/account/held-pages.test.ts, components/consent/a11y.test.ts |
| W20 | Terms page: no Export / Leave / Sign out section | killed | 5 | components/account/held-pages.test.ts |
| W21 | HeldOptions: Leave link removed | killed | 8 | components/account/held-pages.test.ts, components/consent/a11y.test.ts |
| W22 | HeldOptions: Export button removed | killed | 11 | components/account/held-pages.test.ts |
| W23 | gate: Leave the pilot no longer reachable while held | killed | 20 | components/account/held-pages.test.ts, lib/supabase/gate-account.test.ts, proxy-account.test.ts |
| W24 | Nav sign-out no longer clears (plain form) | killed | 6 | components/account/browser-data.test.ts |
| W25 | not-available page: raw sign-out form again | killed | 6 | components/account/browser-data.test.ts |
| W26 | Leave form: goodbye before the cleanup | killed | 8 | components/account/a11y.test.ts, components/account/browser-data.test.ts, lib/supabase/source.test.ts |
| W27 | Leave flow skips the fresh sign-in before the delete (real stack) | killed | 5 | components/account/reauth.int.test.ts |

Required by the work order: X18, X19 (uid from metadata, regex-evading), A01 (cookie Path: W08 to W11), A19 (closeParen budget: W04), A21 (closing hashes: W02, W03), F1 (Y01 to Y15), F2 (Y16 to Y22), F3 (W19 to W23), F4 (W01), item 7 (W12 to W16, W24, W25), item 8 (Y23).
