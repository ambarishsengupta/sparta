# R2c CC5 evidence run: transcript (WO-0061)

Date 2026-11-05/06 (UTC clock of the machine). Built app (`npm run build -w apps/web`, then `next start -H 127.0.0.1 -p 3000` under a `timeout`) against the local Supabase stack, in the built-in browser pane (1024 px wide; the screenshots are the real captures of that pane, in `screenshots/`). `apps/web/.env.local` was written from `supabase status -o json` (URL and publishable key only; never echoed, never committed) with `NEXT_PUBLIC_DATA_BACKEND=supabase`; the build was made with it present because Next inlines `NEXT_PUBLIC_*` at build time. Two builds were used: the first without `NEXT_PUBLIC_CONTACT_EMAIL` and `NEXT_PUBLIC_HOSTING_REGION` (screenshot 01), the second with test values for both (screenshot 13).

## Scripted
- The three users were made by `npx tsx workflow/evidence/R2c/evidence-users.ts create <creds file outside the repo>`: invitation insert, the real sign-up call, the confirmation read out of Mailpit, then the acceptance, pilot-notice and onboarding calls the screens make. A and B: country IN, ready, each with two items, one outfit and one wishlist entry. C: country US, held at not-available. The password is a generated value kept only in that creds file (deleted afterwards). So the browser run starts from "signed out, with an account"; sign-up, confirmation and onboarding in the browser were covered by R2b, not repeated.
- Database read-outs (`evidence-users.ts state`) after each stage: whether the account exists, how many rows remain in every `app` table (from the catalog), invitation rows, and the day's deletion count. One psql read of A's profile after Save.
- Page instrumentation by JavaScript in the page: before clicking Export my data I wrapped `URL.createObjectURL` and `HTMLAnchorElement.click` to keep the Blob handed to the download link, then read it back. The pane does not show a download, so this is how the file content, type, size and file name were checked. The click itself was a real click on the button.
- Cookie and `localStorage` read-outs by JavaScript (before and after Leave).

## Clicked or typed in the browser, in order
1. Opened `/about` signed out: contact address and hosting region both shown as "not configured in this build"; countries: India; the end-of-pilot paragraph from section 7 (01).
2. Opened `/privacy` signed out: the policy as headings, tables and lists (02). First capture showed table cells broken in the middle of words ("Gro up", "Invi tati on"): my `overflow-wrap: anywhere` rule. Changed to `overflow-wrap: break-word`, rebuilt and re-captured (02 is the fixed page).
3. Opened `/settings` signed out: redirected to `/sign-in?next=%2Fsettings`. Typed A's email and password, pressed Return: landed on Settings (03).
4. Typed the display name Anika, ticked Work, clicked Save changes: "Your changes were saved." (04). psql afterwards: `Anika|north|USD|{Work}`.
5. Clicked "Why can't I switch this off?": the FR-61 wording (05). The sharing box is ticked and disabled.
6. Clicked Export my data: "Your data was saved as sparta-export-2026-11-05.json." (06). By the instrumentation: Blob type application/json, 6,023 bytes, link download name `sparta-export-2026-11-05.json`, the document had `account.email` = A's address, items "Anika navy shirt" and "Anika black jeans", display name Anika, and one key per app table.
7. Clicked Leave the pilot: the confirmation page (07). Typed a wrong password, pressed Return: "That password is not right, so nothing was deleted. Check it and try again." and focus on the password field (08). SQL: A still existed, 10 rows.
8. (A slip: I then clicked at a stale coordinate after the page had scrolled and hit the Terms of Use link in the footer; I went back to `/leave` by address. Nothing was submitted.)
9. Typed the right password, pressed Return: redirected to `/goodbye` (09). Before: cookie `sb-127-auth-token` present. After, on the goodbye page: no `sb-` cookie, the header shows no Sign out. SQL: A gone, 0 rows in every app table, no invitation row, deletion count +1.
10. Opened `/settings` again: redirected to sign-in. Typed A's email and password: "That email and password do not match. Check them and try again." (10).
11. Signed in as C (the redirect to `/settings` ended on `/not-available`): the page offers Export my data, Leave the pilot and Sign out (11). Clicked Export my data: by the instrumentation the document held C's account, country US, 2 acceptances, 1 consent record, 0 items. Clicked Leave the pilot, typed the password, pressed Return: SQL showed C gone with 0 rows (the goodbye page was not captured for C).
12. Signed in as B: the wardrobe still showed B's two items (12). Clicked Sign out: back to sign-in.
13. Rebuilt with the contact address and region set; `/about` shows the address as a mail link and the region text (13).

## Final database state before clean-up (scripted)
A, B (before clean-up) and C: A and C gone with 0 rows and no invitation rows; B present with its 10 rows.

## Not covered by this run
- The Leave flow when the account service is down mid-way, a session that has expired on the Leave page, and a vendor or admin on the not-available page (covered in unit tests and pgTAP, not in the browser).
- The pilot-notice page has no link to Export or Leave (see NOTES, gap 1).
- Mobile widths and a keyboard-only walk-through; the layout was only seen at 1024 px. Screen reader behaviour was not checked (the a11y tests are structural).
- The console of the pane held 72 old error lines from earlier sessions and from deliberate failures (403 from the sign-out call of a deleted account, 404/503/connection refused from earlier runs); I could not tell which were from this run, so I make no claim that the console was clean.

## Clean-up (scripted)
`next start` stopped (`pkill`, then a curl to port 3000 got no answer); `apps/web/.env.local` and `apps/web/.next` deleted; `evidence-users.ts clean` removed the three users, their invitations and the three Mailpit messages (users left: 0, Mailpit total 0); the creds file deleted. The local Supabase stack was left running.
