# R2c WO-0061 notes: pages, export download, leave-the-pilot flow

## What was built (apps/web)
- Settings (`/settings`, ready people only): display name, hemisphere, currency and occasions editable (the four columns the database grants); country shown, not editable; sharing shown locked ON with the FR-61 wording; Export my data; Leave the pilot (link); sign-out.
- About (`/about`, public): who runs the pilot, contact address from `NEXT_PUBLIC_CONTACT_EMAIL`, region from `NEXT_PUBLIC_HOSTING_REGION` (empty or invalid: the page says "not configured in this build"), countries from `app.supported_countries()`, the "When the pilot ends" paragraph pulled from section 7 of the Privacy Policy, links to Privacy, Terms and the notice. `/notice` is a new public page with the notice text.
- `/privacy` and `/terms` render `legal/*.md` through `lib/markdown.ts` (parser to a typed tree) and `components/legal/Markdown.tsx` (tree to elements). No HTML is read; every text is a React text child; links only to http(s) without credentials or to this site (`PRIVACY-POLICY.md` and `TERMS-OF-USE.md` map to `/privacy` and `/terms`); images become their alt text. Bounded work (200,000-character cap, a shared work budget, bounded scans). `components/legal/files.ts` finds `legal/` by walking up from the working directory; with the local backend the pages are prerendered at `next build` (static), with the Supabase backend they render on request and `outputFileTracingIncludes` ships the two files with the server output (checked in the `.nft.json` of /privacy, /terms and /about).
- Export (`ExportButton`): `app.export_my_data()` over the signed-in session, shown as a download built from a Blob; file name `sparta-export-YYYY-MM-DD.json`.
- Leave the pilot (`/leave`, `LeaveForm`): password typed again, a fresh `signInWithPassword` (re-authentication), then `app.delete_my_account()`, then local sign-out and removal of every `sb-` cookie, then `/goodbye` (public, no data). A wrong password never reaches the delete call.
- Not-available page: Export, Leave and Sign out (FR-4).
- Gate: `/goodbye` public; `/leave` reachable at every gate step except unconfirmed email; `/settings` for ready people only. Proxy decides `/goodbye`, `/about`, `/notice` before the session call (work during an outage).
- Shell: footer links (About, Privacy, Terms), Settings in the main nav when signed in.

## Changes to existing tests (each needed by the work order; none weakened)
1. `components/consent/a11y.test.ts`: the Privacy and Terms test asserted the old link-to-file page, including `<h2>Welcome to the Sparta pilot</h2>` (the extra notice block). The pages now show the documents, so the notice appears as the bold title inside the section 13 quote; the assertion became `<strong>Welcome to the Sparta pilot</strong>`. The one-h1 and file-name assertions are unchanged.
2. `lib/supabase/source.test.ts`: the inventory of `window.location.assign` calls gained `components/account/LeaveForm.tsx: location.assign('/goodbye')`. That test exists so a new redirect sink is listed on purpose; the new sink is a fixed path.

## Judgements
- "Escape every character first": the reader builds a tree and React escapes text on output, instead of producing an HTML string, because an existing test forbids `dangerously...` anywhere in apps/web. The effect is the same and is tested with hostile input (script tags, `javascript:` and `data:` links, event attributes, nested HTML, entities, control characters, 200,000-character inputs, a property test over random text).
- Cookies are cleared in the browser (supabase sign-out with scope local, then every `sb-` cookie expired), not by a server route, so no new route and no new redirect sink exist. If the sign-out call fails the sweep still removes the cookies.
- The `app.delete_my_account()` result `already_deleted` counts as success. A failure after the call started is reported as "could not confirm the result", never as "nothing was deleted".
- Placed in `components/account/` and `components/legal/` instead of `lib/` for the modules that import `@supabase/supabase-js` or `node:fs`, because the suggestion-path tests require every file of `lib/` to import only React, Next links and the workspace packages.

## Document gaps and notes (quote both sides)
1. FDD FR-4: "Tapping "No thanks" or closing the pop-up does not join the pilot. The user then sees only a page offering Export my data, Leave the pilot (the deletion in FR-66) and Sign out". The existing pilot-notice page (R2a) has only "No thanks, sign out", which signs out at once, and an existing test pins its links to `/privacy` and `/terms`. A person at the notice can reach `/leave` by address (the gate allows it) but nothing links there. WO-0061 CC4 names only the not-available page, so I did not touch the notice page.
2. FDD FR-66: "the confirmation says that data is deleted within 7 days and from backups within 30 days". The database deletes at once; the pages say "complete within 7 days at the latest" and "backups within 30 days", the policy's words. FR-63 also wants a deletion log (user ID and time, 30 days) and a confirmation email; neither exists (WO-0060 notes: no `ops.deletion_log`; no email service in this build).
3. FDD FR-62: "an export ... as a downloadable archive ... ready within 24 hours and delivered in the app and by email ... expire after 7 days". This release gives an immediate JSON download of the database rows only (no images or receipts, none exist yet), as the work order states.
4. LLD 6 lists `/api/account/export` and `/api/account/delete` routes with the secret key; WO-0060/0061 use database functions over the user's own session instead, so no secret key exists in apps/web. `gate.ts` still lists those API paths as held-reachable (R2a); they do not exist.
5. LLD 9.1: "`/about` shows the value of `CONTACT_EMAIL`"; this build reads `NEXT_PUBLIC_CONTACT_EMAIL` (WO-0061). `legal/CONTACT-ADDRESS.md` section 5 still says to set `CONTACT_EMAIL`. Also the Privacy Policy section 13 notice and `lib/consent-form.ts` still carry the address as text (R2a).
6. Privacy Policy section 11: "It is removed when you sign out or leave the pilot." That is about an offline copy that is not built yet. The browser-only usage log `sparta.events.v1` (occasions, seasons, rule ids; no names or ids) is not cleared on Leave or on sign-out. It was still in `localStorage` on the goodbye page.
7. The main navigation still shows Wardrobe and Outfits (and now Settings) to a person held at not-available; the gate sends them back to that page.
8. The Terms of Use link `[Privacy Policy](PRIVACY-POLICY.md)` is a file name; the renderer maps it to `/privacy`. `/maintenance` is in the gate's public list but has no page (R2a).
9. The default `next build` without accounts prerenders /privacy, /terms and /about; with accounts every page is dynamic because the root layout reads the session cookie. Not changed here.

## Mutation and tests
See `WO-0061-mutation.md` (30 mutants, all killed) and the gate output in the report.

## Evidence helpers
`evidence-users.ts` (user set-up, state read-out and clean-up for the browser run) is in this folder; it is not run by the gate.
