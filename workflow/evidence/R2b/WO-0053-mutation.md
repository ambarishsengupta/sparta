# WO-0053 mutation proof (scratch copies outside the repository)

Method: two scratch copies outside the repository: OLD is `git archive HEAD` (the committed state, old tests and old code), NEW is the working tree with the WO-0053 changes. One edit at a time is applied to a copy of the code, the unit suites of apps/web (`npx vitest run apps/web`, integration files excluded) are run, and the edit is undone. The three rows that need the real stack run the named integration file instead. Control rows: no mutation gives 0 failures in OLD (474 tests) and in NEW (725 tests). OLD "n/a" means the mutated code did not exist before WO-0053 (a new function, test or file), so there is nothing to compare; OLD "SURVIVES" means the old tests passed with the mutant in place (a reviewer survivor); NEW "killed" means at least one new test fails.

The reviewer's Q-numbers (Q27 to Q30, Q35 to Q37) are not written in any file I was pointed to, so the rows are named by work-order item (R = redirect B1/m1, N = no-network M1, P = proxy M2/m3, Q = query m4, S = sign-up m5, D = delete and sign-out m8, H = headers M3, V = versions m2, E = evidence item 11) and not by Q-number.

| id | mutant | OLD tests | NEW tests | first failing NEW test file |
|---|---|---|---|---|
| R01 | B1: safeNextPath as it was (reviewer's reproduced open redirect) | SURVIVES (0 of 474 fail) | killed (31 of 725 fail) | auth-form.test.ts |
| R02 | B1: safeNextPath without the "//" check | n/a | killed (17 of 725 fail) | auth-form.test.ts |
| R03 | B1: safeNextPath without the backslash/control-character check | n/a | killed (11 of 725 fail) | auth-form.test.ts |
| R04 | B1/M2: callback route follows next unvalidated (Q-callback) | SURVIVES (0 of 474 fail) | killed (25 of 725 fail) | routes.test.ts |
| R05 | B1/M2: sign-in form follows next unvalidated (in AuthForm) | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | auth-form.test.ts |
| R06 | B1: finishSignIn does not check (assigns next as given) | n/a | killed (1 of 725 fail) | auth-form.test.ts |
| R07 | m1: sign-in goes back to router.replace + router.refresh (the race) | n/a | killed (3 of 713 fail) | auth-form.test.ts |
| R08 | B1: a new redirect sink that reads a request value (callback: seeOther(searchParams.get("to"))) | SURVIVES (0 of 474 fail) | killed (1 of 725 fail) | source.test.ts |
| N01 | M1: fetch to another host in lib/supabase/backend.ts | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | outfits.test.ts |
| N02 | M1: fetch to another host in lib/supabase/gate-state.ts | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | outfits.test.ts |
| N03 | M1: fetch to another host in lib/supabase/browser.ts | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | outfits.test.ts |
| N04 | M1: fetch to another host in lib/supabase/repository.ts | killed (1 of 474 fail) | killed (3 of 725 fail) | outfits.test.ts |
| N05 | M1: fetch to another host in lib/supabase/mapping.ts | killed (1 of 474 fail) | killed (3 of 725 fail) | outfits.test.ts |
| N06 | M1: fetch to another host in lib/auth-form.ts | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | engine-config.test.ts |
| N07 | M1: fetch to another host in lib/supabase/gate.ts | SURVIVES (0 of 474 fail) | killed (1 of 725 fail) | outfits.test.ts |
| N08 | M1: fetch to another host in components/auth/AuthForm.tsx | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | engine-config.test.ts |
| N09 | M1: fetch to another host in lib/supabase/consent-actions.ts | killed (1 of 474 fail) | killed (2 of 725 fail) | outfits.test.ts |
| N10 | M1: a third fetch in lib/engine-config.ts | killed (1 of 474 fail) | killed (4 of 725 fail) | engine-config.test.ts |
| N11 | M1: placeholder host in auth-form.ts replaced by a real host | n/a | killed (3 of 725 fail) | auth-form.test.ts |
| P01 | M2: proxy fails open (catch returns NextResponse.next()) | SURVIVES (0 of 474 fail) | killed (16 of 725 fail) | proxy.test.ts |
| P02 | M2: proxy 503 body carries the error message | SURVIVES (0 of 474 fail) | killed (7 of 725 fail) | proxy.test.ts |
| P03 | M2: proxy answers 500 instead of 503 | SURVIVES (0 of 474 fail) | killed (15 of 725 fail) | proxy.test.ts |
| P04 | M2: matcher excludes /outfits (consumer route unprotected) | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | proxy.test.ts |
| P05 | M2: matcher back to the loose prefix form (icon.svgx, /_next/staticx skip the check) | n/a | killed (6 of 725 fail) | proxy.test.ts |
| P06 | M2: matcher drops an excluded static file (manifest.webmanifest now checked) | SURVIVES (0 of 474 fail) | killed (2 of 725 fail) | proxy.test.ts |
| P07 | M2: matcher matches nothing | SURVIVES (0 of 474 fail) | killed (27 of 725 fail) | proxy.test.ts |
| P08 | m3: public/sign-out decision moved after the session updater | n/a | killed (5 of 725 fail) | proxy.test.ts |
| P09 | m3: /outfits counted as needing no session | n/a | killed (23 of 725 fail) | proxy.test.ts |
| P10 | m3: GET /auth/sign-out also bypasses the session | n/a | killed (3 of 725 fail) | proxy.test.ts |
| Q01 | m4: proxy passes only the pathname to decideRoute (query lost) | n/a | killed (1 of 725 fail) | proxy.test.ts |
| Q02 | m4: gate drops the query string from next | n/a | killed (6 of 725 fail) | proxy.test.ts |
| Q03 | m4: gate builds next without encoding | n/a | killed (16 of 725 fail) | proxy.test.ts |
| S01 | m5: user_already_exists not mapped to the neutral answer | n/a | killed (1 of 725 fail) | auth-actions.test.ts |
| D01 | m8: Delete item always shown (button not hidden for supabase) | n/a | killed (1 of 725 fail) | delete-button.test.ts |
| D02 | m8: canDeleteItems always true | n/a | killed (1 of 725 fail) | delete-button.test.ts |
| D03 | m8: sign-out route does not use signOut (dead action again) | n/a | killed (1 of 725 fail) | routes.test.ts |
| D04 | m8/m3: sign-out route does not clear cookies when the service is down | n/a | killed (1 of 725 fail) | routes.test.ts |
| D05 | sign-out signs out every device (scope global) | killed (1 of 474 fail) | killed (2 of 725 fail) | routes.test.ts |
| H01 | M3: no headers at all | n/a | killed (2 of 725 fail) | next-config.test.ts |
| H02 | M3: X-Frame-Options removed | n/a | killed (1 of 725 fail) | next-config.test.ts |
| H03 | M3: CSP loses object-src 'none' | n/a | killed (2 of 725 fail) | next-config.test.ts |
| H04 | M3: CSP frame-ancestors weakened to 'self' | n/a | killed (1 of 725 fail) | next-config.test.ts |
| H05 | M3: headers apply to one path only | n/a | killed (1 of 725 fail) | next-config.test.ts |
| H06 | M3: Referrer-Policy weakened to unsafe-url | n/a | killed (1 of 725 fail) | next-config.test.ts |
| V01 | m2: gate ignores the notice version | killed (2 of 10 fail) | killed (3 of 13 fail) | consent.int.test.ts |
| V02 | m2: gate ignores the terms version | SURVIVES (0 of 10 fail) | killed (1 of 13 fail) | consent.int.test.ts |
| V03 | m2: gate ignores the privacy version | SURVIVES (0 of 10 fail) | killed (1 of 13 fail) | consent.int.test.ts |
| V04 | m5 (real stack): signUp error user_already_exists passed through | n/a | killed (1 of 10 fail) | auth.int.test.ts |
| E01 | item 11: NOTES says again that no commits were made | n/a | killed (1 of 725 fail) | evidence.test.ts |
| E02 | item 11: transcript again says screenshot 10 shows the occasion ticks | n/a | killed (1 of 725 fail) | evidence.test.ts |
| E03 | M3: notes no longer say the CSP is partial | n/a | killed (1 of 725 fail) | evidence.test.ts |

51 mutants; 51 killed by the NEW tests; 18 of them survived the OLD tests (so they are the cases the old suite could not catch); 0 survive the NEW tests.
