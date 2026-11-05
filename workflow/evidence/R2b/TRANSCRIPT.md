# R2b CC5 evidence run: transcript (WO-0052)

Date 2026-11-05. Built app (`npm run build -w apps/web`, `next start -H 127.0.0.1 -p 3000`) against the local Supabase stack, in the built-in browser pane. Screenshots are the real captures of that pane, in `screenshots/`. Nothing here was run in a headless script: every browser step below is a tool call on the pane.

## Setup (scripted)
- `apps/web/.env.local` written from `supabase status -o json` (URL and publishable key only; never echoed, never committed, deleted afterwards), `NEXT_PUBLIC_DATA_BACKEND=supabase`. The build was made with that file present because Next inlines `NEXT_PUBLIC_*` at build time.
- The address `evidence-r2b@example.test` was put on the invitation list with one SQL insert (this is how an invitation is made in the pilot; there is no invitation screen). `uninvited-r2b@example.test` was deliberately not invited. The password was a generated 17-character test value that is not recorded here.
- Database checks below (`select ...` through `docker exec ... psql`) are scripted reads, not part of the app.

## What was clicked or typed in the browser, in order
1. Opened `/` signed out: redirected to the sign-in page (01). [navigate by URL; redirect is the proxy.]
2. Sign-up page, typed the uninvited address and the password, clicked Create account: the page shows "Sparta is invitation-only during the pilot." (02, the first capture shows the button on "Please wait"; 02 is the second capture). Mailpit afterwards held no message for that address.
3. Typed the invited address (replaced the first one), clicked Create account: "Check your email" (03).
4. Opened Mailpit (`http://127.0.0.1:54324`, navigated by URL): inbox with one message (04); clicked it: "Confirm your email address" (05).
5. Clicked the "Confirm email address" link in the message. The pane showed no visible change and no new tab. I then took the same link out of the Mailpit API and navigated the pane to it (scripted). That second visit landed on `/accept-terms` with `#error=access_denied&error_code=otp_expired` in the URL, i.e. the one-time link had already been used, and the app was already signed in and gated to accept-terms (06). The user's `email_confirmed_at` was set about 20 seconds after sign-up, which matches the first (clicked) visit; I did not time-stamp the two actions separately, so that attribution rests on timing and the `otp_expired` fragment.
6. First sign-in therefore happened through the confirmation callback. The explicit typed sign-in is step 16.
7. accept-terms: clicked both boxes (the first capture after a click can lag one frame, so one box looked unticked for a moment; the final state is 07), clicked Continue: pilot notice (08).
8. Clicked "I understand and join the pilot": onboarding (09). Chose India, Northern, INR with the form tool (scripted values on the selects). Screenshot 10 shows those three selects filled and all seven occasion boxes still UNTICKED (it was taken before the occasions were ticked). Casual and Work were then ticked by clicks; that state was not captured, and the evidence for it is the database, which later showed `{Casual,Work}`. Clicked Continue: empty wardrobe (11).
9. Add item x3 through the form. Category, sub-type and colour were set with the form tool (scripted values; 12 is the form after that); seasons and occasions were ticked by clicks. Navy Shirt (Tops, Shirt, #00008B): its season and occasion boxes were set with the form tool, which changed the checkboxes on screen but not the app's state: the row was stored with empty seasons and occasions (found by SQL). I opened it from the wardrobe, ticked All year, Casual and Work by clicks and saved: that is an update through the repository (SQL showed `updated_at > created_at`). Grey Chinos (Bottoms, Chinos, #808080) and White Sneakers (Footwear, Sneakers, #FFFFFF): boxes ticked by clicks. Wardrobe with three items (13). SQL: three rows in `app.items`, colour hex and family filled by the database (Navy, Grey, White), origin `manual`.
10. Outfits, Casual: one outfit; the Swap sheet for the bottom said "No other item fits here and keeps the outfit valid." (not captured). Because one outfit has nothing to swap with, I added a fourth item through the form (Bottoms, Jeans, #1B1B1B; named by the app "Black Jeans"), and later a fifth (Red T-shirt, see step 14). The WO asks for 3 items; there are 5 in the run. Outfits Casual again: two outfits (14).
11. Opened Swap on outfit 1's bottom: Black Jeans offered (15); clicked it: outfit 1 swapped, "Swapped by you, so it is not scored again" (16). Clicked Accept on outfit 1: "Outfit 1 saved." (17). SQL: one row in `app.outfits` (`occasions {Casual}`, notes `{"v":1,"score":null,"reasons":[...]}`), three rows in `app.outfit_items` (Navy Shirt top, Black Jeans bottom, White Sneakers footwear), one `app.suggestion_feedback` row `{"accepted": true, "occasion": "Casual", "rule_ids": ["R1","R2"], "engine_config": "gm1;emb0;pair0;ul:fb;w:base"}`.
12. Clicked Reject on outfit 2: "Outfit 2 removed." SQL: a second feedback row `{"accepted": false, "occasion": "Casual", "rule_ids": ["R1","R2","OCC","R3","R4"], "engine_config": "gm1;emb0;pair0;ul:fb;w:base"}`. Neither row has an item id or name (and the table has no column for them).
13. Clicked "Add to wishlist" on the Wardrobe unlock entry "Grey Blazer": "Grey Blazer added to your wishlist." (18). SQL: one `app.wishlist_entries` row, sub-type Blazer, colour family Grey, `origin = unlock`.
14. Failure case. Opened Add item, filled Tops / T-shirt / #CC0000 (form tool), then stopped the API gateway container (`docker stop supabase_kong_sparta`, scripted) and clicked Save item. The form stayed, with everything typed, and showed "Could not reach the server, so your change was not saved. Check your connection and try again." (19). SQL: still 4 items. Restarted the container (scripted), clicked Save item again on the same form: it saved and went to the wardrobe with five items (20); SQL: 5 items, the Red T-shirt among them. This was the only failure path walked in the browser.
15. Clicked Sign out: the sign-in page. Then navigated to `/outfits` signed out: redirected to `/sign-in?next=%2Foutfits` (21 is that capture).
16. Typed the email and password and pressed Return: landed on `/` (not `/outfits`; see NOTES gap 6) with "5 of 5 items": Red T-shirt, Black Jeans, White Sneakers, and the two earlier ones below (22). Nothing in the browser's local storage was involved: the data came back from the account.

## Final database counts before clean-up (scripted)
items 5, outfits 1, outfit_items 3, wishlist (unlock) 1, suggestion_feedback 2, document_acceptances 2, consent_records 1.

## Not covered by this run
- The not-available page and the unsupported-country path in the browser (covered by the integration suites against the real stack, not walked here); password reset; sign-up with a password under 10 characters; sign-out from another tab; a session that ends while a page is open; the "Delete item" refusal; Archive and Restore in the browser; accept, archive or load failures in the browser (only the item-form create was); the legal pages; mobile width, keyboard-only use and a screen reader; any browser other than the built-in pane; Windows or Linux.
- The coordinate and ref clicks in the pane were unreliable for checkboxes in two places (two refs resolved to the same screen position; a capture right after a click can show the old state), so every box state above was checked in a later capture or by SQL, not assumed.

## Clean-up (scripted)
Server stopped; `apps/web/.env.local` and `apps/web/.next` deleted; the test user (cascade removes its rows), both invitations and all Mailpit messages deleted; gateway container restarted.

---

# WO-0053 browser and header checks (fix loop 1)

Date 2026-11-05. Built app (`npm run build -w apps/web`, `next start -H 127.0.0.1 -p 3000`) against the local stack, with `apps/web/.env.local` written from `supabase status -o json` (never echoed or committed; deleted afterwards with `apps/web/.next`). A second, trivial web server on 127.0.0.1:3298 returned the text "EVIL SITE REACHED": any request reaching it would show in its log. Two throwaway users `wo53-a@example.test` and `wo53-b@example.test` were invited with one SQL insert; a generated password that is not recorded here.

## Scripted versus clicked
- Scripted: the invitation insert; reading the confirmation message from the Mailpit API and, for the callback test, rewriting its `redirect_to` so that it carries `?next=%2F.%2F%2F127.0.0.1%3A3298%2Fpwned` (GoTrue accepted it and appended the code); following that one link with curl without redirects to read the callback URL with the code; the three selects of onboarding (form tool); `docker stop`/`start` of the API gateway; the clean-up.
- Clicked or typed in the built-in browser pane: sign-up, every sign-in, sign-out, the accept-terms ticks, the pilot notice button and Continue, loading the demo wardrobe. Navigation to a URL (including the callback URL with the code) was by address.

## Results
1. Callback sink, real code. User A signed up in the browser; the confirmation callback URL carried `next=/.//127.0.0.1:3298/pwned`. The browser ended on `http://127.0.0.1:3000/accept-terms` (the gate step; the callback had redirected to `/`), signed in, never on port 3298. User B did the same with the same payload and also ended on accept-terms on port 3000.
2. Sign-in sink. Signed in as A at `/sign-in?next=%2F.%2F%2F127.0.0.1%3A3298%2Fpwned`: `location.href` after sign-in was `http://127.0.0.1:3000/` and the wardrobe was shown (screenshot 24). The 3298 server's log held no request from the browser (its only entry was my own later `curl` to prove that the server was up).
3. m1. Signed in as A at `/sign-in?next=%2Foutfits`: landed on `/outfits` (screenshot 23). Before WO-0053 the same step landed on `/` (WO-0052 gap 6).
4. m4. Signed out, opened `/outfits?anchor=item-1`: redirected to `/sign-in?next=%2Foutfits%3Fanchor%3Ditem-1`; after sign-in the browser was on `/outfits?anchor=item-1`.
5. m5. With A confirmed and signed out, signing up again with A's address in the form showed the same "Check your email" page as a new sign-up. Directly against the Auth API (curl), the same request answers `422 user_already_exists`, so the Auth API still tells a caller that the address has an account; only the screen is neutral.
6. m8. Opened an item of A's loaded demo wardrobe (`/items/<id>`): the buttons are Sign out, Save item and Cancel; "Delete item" is absent.
7. m3, with the gateway container stopped. A browser holding B's session: `/outfits` answered 503 with the fixed text "Sparta cannot check your account right now. Please try again in a moment."; `/privacy` answered 200 and rendered "Privacy Policy"; a POST to `/auth/sign-out` (fetch, manual redirect) answered a redirect and the cookie `sb-127-auth-token` was gone afterwards (it was present before). Gateway restarted afterwards.
8. No CSP message ("Refused ...") in the browser console during any of the above.

## Headers on the built app (`curl -I` against http://127.0.0.1:3000; only the relevant lines)
```
/outfits?anchor=item-1   HTTP/1.1 307 Temporary Redirect   location: /sign-in?next=%2Foutfits%3Fanchor%3Ditem-1
/privacy                 HTTP/1.1 200 OK
/icon.svg                HTTP/1.1 200 OK
/manifest.webmanifest    HTTP/1.1 200 OK
/nonexistent             HTTP/1.1 307 Temporary Redirect   location: /sign-in?next=%2Fnonexistent
/auth/callback?code=x&next=%2F.%2F%2F127.0.0.1%3A3298%2Fpwned   HTTP/1.1 303 See Other   location: /sign-in?error=link
POST /auth/sign-out      HTTP/1.1 303 See Other   location: /sign-in
```
Every one of them, redirects included, carried:
```
Content-Security-Policy: frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

## Clean-up (scripted)
Next server and the 3298 server stopped; both test users (cascade), both invitations and their Mailpit messages deleted (counts 0); `apps/web/.env.local` and `apps/web/.next` deleted.

## Not covered
Only Chrome-based built-in pane; no other browser. The tab-and-newline payloads were exercised by unit tests only (a browser cannot send a raw tab in a query string the way the test does). The 503 outage check used the one container (`supabase_kong_sparta`), not a database outage.
