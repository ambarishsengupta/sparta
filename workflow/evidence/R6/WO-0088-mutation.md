# WO-0088 mutation proof (R6c, Release 0)

Scratch copy of the web app OUTSIDE the repository (`<session scratchpad>/mut88`: `apps/web`, `packages`, root config copied; `node_modules` linked; a copy of `supabase/config.toml` so the real-stack suites find the local stack). Each of the 31 TypeScript mutants is one textual change to one source file of the copy; the file is restored after each run. Each run executes: `lib/admin-catalog.test.ts`, `lib/gtin.test.ts`, `lib/barcode-scan.test.ts`, `lib/barcode-lookup.test.ts`, `lib/supabase/gate.test.ts`, `proxy-admin.test.ts`, `lib/supabase/catalogue-repository.test.ts`, `components/admin/admin.test.ts`, `components/catalogue/barcode.test.ts`, `lib/server/admin-catalog.test.ts` and `lib/server/admin-catalog.int.test.ts` (real local stack). The 6 SQL mutants replace or re-grant `app.write_admin_audit` in the LOCAL database (`create or replace` / `grant`), run pgTAP 014 and 003, and restore the original definition and grants afterwards.

First run: 35 of 37 killed; mutants 2 and 5 survived.
- 2 (no session no longer gives 401): equivalent for the real client (a missing session always comes with an error), so the real-stack suite could not tell. Fixed by `lib/server/admin-catalog.test.ts` (fake clients: no user and no error, 401 service down 503, role read failing 500, every other role 403, secret-key client untouched).
- 5 (take-down goes on when the audit row cannot be written): the audit-failure test only covered create. It now drives create, update, take-down and review through a secret-key client whose audit call fails and proves each answers 500 with the database exactly as before.
Final result: **37 of 37 killed**, 0 survivors.

| # | Mutant | Result | Failing test (first) |
| --- | --- | --- | --- |
| 1 | any role passes the admin check (`role.data !== null`) | KILLED | routes against the real stack > GET sources: no session 401, consumer and vendor 403 |
| 2 | no session no longer gives 401 | KILLED (after fix) | admin-catalog.test.ts > listSources: who may call > a session with no user and no error is 401 |
| 3 | origin check dropped on mutating calls | KILLED | routes > a mutating request from another origin is refused even for the admin |
| 4 | create writes no audit row | KILLED | routes > create: allowed true is refused ... with one audit row |
| 5 | take-down goes on when the audit row fails | KILLED (after fix) | routes > when the audit row cannot be written, no mutating call does anything |
| 6 | create does not refuse `allowed` without the checks | KILLED | routes > create: allowed true is refused unless robots allow it ... |
| 7 | update checks only the sent fields, not the stored ones | KILLED | routes > update: allowed true needs the three checks |
| 8 | re-allow does not clear `takedown_at` | KILLED | routes > take-down: ... a re-allow clears takedown_at in the same update |
| 9 | unknown source on take-down is a 500 | KILLED | routes > take-down: ... |
| 10 | take-down called with the secret key instead of the session | KILLED | routes > take-down: ... |
| 11 | review decision touches rows that are not in review | KILLED | routes > review: the queue shows review rows only ... |
| 12 | review queue lists active rows | KILLED | routes > review: the queue shows review rows only ... |
| 13 | re-allow audited as a plain update | KILLED | routes > take-down: ... |
| 14 | http accepted for any host | KILLED | admin-catalog.test.ts > siteUrlOk > refuses http://shop.example.test/ |
| 15 | future check dates accepted | KILLED | admin-catalog.test.ts > checkDateOk > refuses 2026-11-14 |
| 16 | review accepts any sub-type | KILLED | admin-catalog.test.ts > parseReview > refuses a sub-type of another category |
| 17 | unknown keys accepted in a source body | KILLED | admin-catalog.test.ts > parseSource: create > refuses an unknown key |
| 18 | `mayAllow` ignores the robots value | KILLED | admin-catalog.test.ts > mayAllow > needs robots_allowed true ... |
| 19 | a 9-digit code accepted | KILLED | gtin.test.ts > accepts exactly 8, 12, 13 and 14 digits |
| 20 | padded to 13 digits | KILLED | barcode-lookup.test.ts > sends only the padded 14-digit code |
| 21 | camera answering after close is not released | KILLED | barcode-scan.test.ts > a stop() before the camera answers releases the stream |
| 22 | only the first track stopped | KILLED | barcode-scan.test.ts > stop() stops every track ... |
| 23 | polling not cancelled on stop | KILLED | barcode-scan.test.ts > stop() stops every track ... |
| 24 | the typed text is sent instead of the padded code | KILLED | barcode-lookup.test.ts > sends only the padded 14-digit code |
| 25 | barcode lookup no longer asks for active rows | KILLED | catalogue-repository.test.ts > barcode lookup request |
| 26 | any barcode text is saved to `items.barcode` | KILLED | barcode.test.ts > the barcode is saved with the item only as 14 digits |
| 27 | unmounting the scanner leaves the camera on | KILLED | barcode.test.ts > the scanner stops the scan when it unmounts |
| 28 | camera opens without a tap | KILLED | barcode.test.ts > typed entry is always there ... (camera only on a tap) |
| 29 | admin routes redirected like pages | KILLED | proxy-admin.test.ts > admin routes answer for themselves in every state |
| 30 | a consumer can open the admin page | KILLED | proxy-admin.test.ts > the admin page > ready on /admin/catalog goes to / |
| 31 | an admin is no longer in the admin state | KILLED | gate.test.ts > stateFromFacts > an admin ... is in the admin state |
| S1 | audit writer: admin check removed | KILLED | pgTAP 014: a vendor id is refused |
| S2 | audit writer: action pattern removed | KILLED | pgTAP 014: an upper-case action is refused |
| S3 | audit writer: target pattern removed | KILLED | pgTAP 014: an email as target is refused |
| S4 | audit writer: execute also granted to authenticated | KILLED | pgTAP 014: anon, authenticated, worker_role and collector_role cannot |
| S5 | audit writer: execute left to PUBLIC | KILLED | pgTAP 014: anon, authenticated, worker_role and collector_role cannot |
| S6 | audit writer: not security definer | KILLED | pgTAP 014: it is security definer |

After the SQL mutants the original function and grants were restored and pgTAP 003 and 014 passed again (`supabase db reset` runs again in the gate).
