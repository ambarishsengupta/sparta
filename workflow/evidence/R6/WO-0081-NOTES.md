# WO-0081 notes (R6a, app): purchases, prices with conversion, wishlist bought

Release 0 (demo) cut: no receipts, no dedicated security review, no secret-key use. Spec QC, the gate and the mutation proof apply. CC3 except "Plan purchases" (WO-0082), CC13, CC14.

## What was built
- `lib/money.ts`: `formatPrice` (Intl.NumberFormat in the stored currency), `convert` (amount / per_usd[from] * per_usd[to], 2 places, null unless both currencies have a row, the older of the two rate dates), `secondaryPrice` (the "about ... at the rate of <date>" line, nothing for the same currency or a missing rate).
- `lib/purchases.ts`: types, filters (store and brand contains, category, date range), keyset order and cursor, per-currency totals in whole minor units, period presets, `logPurchase` (event with `origin` only).
- `lib/purchase-form.ts`: form values and validation (one piece's price `^\d{1,10}(\.\d{1,2})?$` so NaN, Infinity, negatives and exponents never leave the form; quantity 1 to 999; date a real day, not in the future; store and notes length).
- Both repositories: `purchases` (page 40 by keyset, totals over the whole filtered set, forItem, create, update, remove), `wishlist.bought(id, {purchase, colourHex?})` and `prices` (profile currency, newest rates). Supabase: PostgREST over `app.purchases` with the item joined (`items!inner`) for brand and category; `bought` calls `app.wishlist_bought(p_entry, p_item, p_purchase)`; rates from `app.latest_fx_rates()`; the wishlist list now asks for `status = 'open'` so a bought entry leaves it. Local: purchases live in the same browser document (old documents without them still read), deleting an item removes its purchases, `bought` makes the item and purchase and removes the entry.
- Screens: item page "Purchases" panel (add, edit, delete, also for archived items; nothing for an unknown item); `/purchases` (period picker, from/to, store, brand, category, totals per currency, newest first, "Show 40 more"); `/wishlist` with "Mark as bought" (the purchase form opens for the entry; a colour field appears only when the entry has none); Nav gains Wishlist and Purchases.
- Event: `purchase_recorded` with `origin` ('manual' from the item page, 'wishlist' from Mark as bought). A source test proves the only call site passes `{ origin }`.
- CSS (globals.css only, tokens only): `.totals`, `.amount`, `.panel`, `.card.line`, `.filters.six`, date input in the input rule, nav wrap and 6px link padding under 40rem. No new colour, radius, shadow or font.

## Decisions
- Price meaning follows WO-0080/0092: the stored price is the UNIT price, `quantity` separate, spend = price x quantity everywhere (list amounts, totals, secondary amount). The form label says "Price of one piece".
- Totals are per currency and never converted or summed across currencies; only a row's own amount gets the converted line.
- The wishlist did not exist as a screen (only the Wardrobe unlock panel wrote to it), so `/wishlist` was added as the place for "Mark as bought" (FR-35).
- The purchase list shows dated, priced purchases only (`purchase_date is not null`, price and currency present). The form always sets all three; older rows without them are not listed and have no edit control.
- Brand filter is a contains search (the item form has no brand field yet; brands arrive with the catalogue).
- `app.wishlist_bought` needs an item colour; when the entry has none the form asks for one. All or nothing is proved on the real stack (an entry without a colour and no colour sent: nothing changes).

## Tests (new; nothing existing changed or weakened)
- `lib/money.test.ts`, `lib/purchases.test.ts`, `lib/purchases-repository.test.ts` (local repository and fake-client requests), `components/purchases/a11y.test.ts` (structure and names, every new class defined, design rules on the stylesheet), `lib/supabase/purchases.int.test.ts` (real stack: unit price and quantity, another person sees/changes/deletes nothing, 45-row keyset paging and filters, wishlist bought once and owner only and all-or-nothing, rates). Existing `design.test.ts` and `contrast.test.ts` stay green and now run over the new CSS. Totals for the whole run are in the gate log (see the report).
- Mutation: `WO-0081-mutation.md` (36 of 36 killed).

## Real-browser evidence (local stack, built app on a free port, keys read at run time from `supabase status -o json` into process env only)
Throwaway user `@example.test` (password generated at run time, never written to a tracked file), two exchange-rate rows inserted for the run; user, rates and `.next` removed afterwards (0 users and 0 rate rows left), server stopped.
Screenshots in `screenshots/`: desktop 1 purchases, 2 item purchase form, 3 price error, 4 purchase saved on the item page, 5 wishlist, 6 Mark as bought form (with the colour field), 7 after bought; mobile 1 purchases, 2 item purchases list, 3 item purchase form, 4 wishlist, 5 Mark as bought form, 6 after bought, 7 purchases after bought. Database check after the wishlist flow: the item exists (origin manual), its purchase is unit price 62.00 quantity 1, the entry is `bought`.
Defects found in the browser and fixed before the final build: (1) horizontal overflow at 375px (scrollWidth 432): the filter grid's date input forced columns wider, fixed with minmax(0,1fr) and width 100%; (2) purchase rows at 375px squeezed the text column to one letter per line, fixed with `.card.line` (wrap, text column at least 10rem); (3) five nav links wrapped to three rows, padding under 40rem reduced (still two rows at 375px with Settings on its own line). Only the desktop purchases screenshot was retaken after the fixes; the other desktop shots predate the row-wrap fix, which does not change the desktop layout.
Checked in the screenshots: EUR 144.80, GBP 240.00, USD 128.50 totals match 49.90 x 2 + 15 x 3, 240 and 39 + 89.50; EUR rows carry "about $108.48 at the rate of 2026-11-05"; GBP (no rate row) and USD (the profile currency) carry nothing extra.

## Not done / not verified
- No design critic score here (the critic scores from the screenshots). No axe tool in the repo; the repo's regex a11y checks cover the new screens.
- Receipt attach, Plan purchases, catalogue origin: other work orders.
- The Nav still needs two rows at 375px with the Settings link; shorter labels or a menu is a design decision.
- Counted lines are far above 650 (see the report); the work order needed a split (repositories, screens and tests are each about a third).
