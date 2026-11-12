# Sparta Release 0 demo: 15-minute walk-through
Everything runs on this machine against the local stack. All data is synthetic (invented names, brands, shops and `@example.test` addresses). Two modes: **accounts** (steps 1 to 12, the full pilot) and **no-login** (steps 2 to 6 on the consumer side with a 16-item preset, no accounts, nothing stored on a server; purchases and the wishlist start empty, so steps 7 and 8 need accounts mode).

## Start order (exact) and reset
1. `supabase start` (Docker running). Check: `supabase status` answers.
2. `bash supabase/scripts/demo-data.sh` builds the demo state (about one minute) and prints the four passwords ONCE: copy them now, they are stored nowhere. Accounts: `demo-rich@example.test` (60 items, 15 purchases, 4 planned wishlist entries), `demo-thin@example.test` (12 items), `demo-new@example.test` (empty, onboarding still to do), `vendor-demo@example.test` (vendor).
3. `bash workflow/demo/start-demo.sh` builds the app and prints `ready at http://127.0.0.1:PORT/` (the port is free-picked each time). It stops by itself after 2 hours.
4. **No-login mode instead:** skip steps 1 and 2 and run `bash workflow/demo/start-demo.sh --no-login`. Use the 'Load demo wardrobe' button for a wardrobe; the 40-item demo catalogue is bundled.
5. Open the printed address in a browser (1280px wide looks best).
- **Stop:** `bash workflow/demo/start-demo.sh --stop`.
- **Reset to the starting state** (after Leave the pilot, Mark as bought or other changes): `bash workflow/demo/start-demo.sh --stop; bash supabase/scripts/demo-data.sh --remove; bash supabase/scripts/demo-data.sh`, then start again. `demo-data.sh --remove` alone leaves the local database clean.

## The walk-through (what to say, what it proves)
| Min | Step | Say | Proves |
|---|---|---|---|
| 0 | 1 Sign in as `demo-rich` (accounts) or press 'Load demo wardrobe' (no-login) | "Invitation-only pilot; consent and onboarding are done for this account." | Real sign-in, consent gate and onboarding state; the no-login mode needs none of it. |
| 1 | 2 Wardrobe | "60 items, filters by category, colour family, favourites, never worn; archive instead of delete." | Wardrobe grid, filters, tinted category illustrations. |
| 3 | 3 Add by photo (accounts, worker running) | "The photo is analysed by the worker; the garment guess is shown only as a suggestion you confirm or change." | Guess is never filled in silently. Needs the worker (`docker compose` in `services/worker`); NOT part of no-login mode. Skip if the worker is off. |
| 4 | 4 Complete the look: on an item press 'Build outfits around this' on a card, then pick **Casual** on a card, then pick **Casual** | "Pick one item, get outfits around it; each says why it works." | Anchor item stays fixed, rules explain the choice. |
| 5 | 5 Outfits, occasion Casual, 'Swap' on one piece | "Swapping replaces one piece with a compatible one, Accept or Reject teaches the rules without sending item names." | Swap and the feedback loop; only occasion and rule ids leave the browser. |
| 6 | 6 Wardrobe unlock: sign in as `demo-thin`, open Outfits, pick **Casual** and scroll to Wardrobe unlock (no-login: load 'Thin wardrobe') | "With 12 items the app suggests up to three things to add, as attributes only." | Unlock panel names gaps without photo, price or store. |
| 7 | 7 Purchases and prices: back to `demo-rich`, Purchases; then Wishlist | "15 purchases with totals per period, store, brand and category. Prices in another currency are totalled separately; with a rate row they convert with the rate date, and we never guess a rate (the demo has no rate rows)." | Purchase filters, totals and the conversion rule. |
| 8 | 8 Plan purchases: Wishlist, four entries planned for the next four months, press 'Mark as bought' on one | "Plans by month with a budget per entry; type a price when you mark one bought, and it becomes a purchase." | Wishlist planning, bought conversion. |
| 9 | 9 Catalogue picker, popular items and barcode: 'Add from catalogue' | "The demo catalogue holds 40 invented items; pick one and it becomes yours, a barcode can find it." | Catalogue picker; scan a barcode with the camera needs a camera, otherwise type the number: **2900000050013** and press 'Find by barcode'. For 'Start from popular items' sign in as `demo-new` (it lands on the onboarding form), choose country India, hemisphere and currency, then press that button. Doing this uses `demo-new` up: reset to repeat it. |
| 10 | 10 Vendor portal: sign out, sign in as `vendor-demo` | "Vendors see group figures only, after accepting an agreement." | Role routing: the vendor lands on the agreement; tick the box and press Accept. Consumers cannot open `/vendor`. |
| 12 | 11 Dashboard, Gaps, Reports | "Ownership mix, trends, condition spectrum from 150 invented consumers. Counts are rounded to 5 and a small segment (Activewear, Ethnic wear) shows 'Not enough users to display'. Pick Season 'Summer' and the figures change." | Minimum group size hiding, one-filter change, gaps, a report reviewed by an admin before a vendor can see it. |
| 14 | 12 Data rights: sign in as `demo-new` (or `demo-thin`), Settings | "'Export my data' gives the person's own rows. 'Leave the pilot' deletes the account." | Export and deletion are real; Leave asks for that account's password again, so keep the printed password to hand; press Leave only as the last step, then reset. |

## Known limits (say them before they are asked)
- Receipts, feed upload, admin insights, the penetration test and hardening arrive in Release 1.
- All data is synthetic: invented consumers, brands and shops; nothing is real and nothing is from any retailer.
- Garment guess accuracy is 0.8953 on its own test set and the guess is still off for real users; it is a suggestion only.
- Catalogue sources need the owner's approval before any real catalogue is loaded; the demo catalogue is invented and never collected.
- Add by photo needs the worker (`docker compose` in `services/worker`) and is NOT part of the no-login mode, which also has no vendor portal, no export and no Leave.
