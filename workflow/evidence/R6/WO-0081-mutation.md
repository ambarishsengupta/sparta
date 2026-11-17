# WO-0081 mutation proof (CC14)

Scratch copy OUTSIDE the repository (`scratchpad/wo81-mut`, rsync of apps/web and packages with a symlinked node_modules); one mutant at a time, applied by exact text replacement, tests run with `vitest run` on: money.test, purchases.test, purchases-repository.test, components/purchases/a11y.test, components/design.test, components/contrast.test (the real-stack suite purchases.int.test.ts is skipped in the copy, which has no supabase folder). The original file is restored after each mutant. Harness: scratchpad/wo81_mutate.py.

**Result: 36 mutants, 36 killed, 0 survivors.** Two mutants (M08, M32) survived the first test set; each led to a new assertion (marked below) and was killed on re-run. The first M36 (a malformed tag) died only of a syntax error, so it was replaced by M36 as listed.

| Mutant | What was changed | Killed by |
| --- | --- | --- |
| M01 | money.convert inverted (amount * from / to) | money.test: convert: ... converts with both rows and rounds to two places |
| M02 | money.convert not rounded | money.test: convert: ... converts with both rows and rounds |
| M03 | money.convert treats a missing currency as USD | money.test: is null when either currency has no row |
| M04 | secondaryPrice shows a line for the same currency | money.test: secondaryPrice adds nothing for the same currency or a missing rate |
| M05 | money.convert shows the newer rate date instead of the older | money.test: shows the older rate date as it is |
| M06 | totals summed across currencies | purchases-repository.test: pages of 40 ... totals per currency (and purchases.test totals) |
| M07 | totals ignore the quantity | purchases.test: totals adds per currency ... unit price times quantity |
| M08 | totals add floats instead of whole minor units (19.99 x 3) | purchases.test: totals ... whole minor units (survived the first test set; test added for 19.99 x 3 and re-run: killed) |
| M09 | newest first reversed | purchases-repository.test: pages of 40 newest first with a keyset |
| M10 | keyset repeats the cursor row (<= 0) | purchases-repository.test: pages of 40 ... (45 distinct ids) |
| M11 | range start exclusive | purchases-repository.test: pages of 40 ... totals from 2026-10-28 |
| M12 | store filter exact instead of contains | purchases.test: store and brand are case-insensitive contains |
| M13 | future dates accepted | purchases.test: purchase form refuses a bad date |
| M14 | price may be negative | purchases.test: purchase form refuses a bad price |
| M15 | quantity up to 9999 | purchases.test: purchase form refuses a bad quantity |
| M16 | price regex accepts NaN and Infinity text | purchases.test: purchase form refuses a bad price (NaN, Infinity) |
| M17 | purchase_recorded event also carries a price | purchases.test: source: every place that records it passes an origin only |
| M18 | local page returns 41 rows | purchases-repository.test: pages of 40 ... |
| M19 | local wishlist bought keeps the entry on the wishlist | purchases-repository.test: wishlist bought: one step ... |
| M20 | local item delete keeps its purchases | purchases-repository.test: deleting an item removes its purchases |
| M21 | supabase wishlist lists bought entries too (no status filter) | purchases-repository.test: the wishlist lists open entries only |
| M22 | supabase cursor not validated (filter text injection) | purchases-repository.test: a date or cursor that is not well formed never reaches a request |
| M23 | supabase page limit 40 (no next page) | purchases-repository.test: a page asks for 41 newest first |
| M24 | store filter not escaped for % and _ | purchases-repository.test: a page asks for 41 ... (escaped pattern) |
| M25 | row price multiplied by quantity (unit price lost) | purchases-repository.test: a row is read as numbers |
| M26 | filter dates not cleaned | purchases-repository.test: a date or cursor that is not well formed ... |
| M27 | bought sends no colour | purchases-repository.test: the wishlist lists open entries only, and bought calls app.wishlist_bought with ... the colour |
| M28 | raw colour in the new styles | design.test: the stylesheet follows the design direction (cssProblems colour-outside-tokens) |
| M29 | radius in the new panel | design.test: cssProblems radius |
| M30 | 11px text in the totals | design.test: cssProblems font-size-below-12 |
| M31 | date input loses the 44px target selector | purchases a11y.test: stylesheet with the new rules passes ... date inputs |
| M32 | totals rule renamed (class used but undefined) | purchases a11y.test: every class the purchase components use is defined (survived the first test set; rule-itself check added, re-run: killed) |
| M33 | inline style (radius) in the purchase form | design.test: no component draws a radius, shadow, font or raw background of its own |
| M34 | colour field shown when not needed | purchases a11y.test: the purchase form ... asks for a colour only when told to |
| M35 | profile currency not offered first | purchases a11y.test: ... offers the profile currency first |
| M36 | quantity field label has no text | purchases a11y.test: the purchase form names every field |

Not mutated here: the database side (RLS, `app.wishlist_bought`, the price check). Those are WO-0080 and WO-0092 and proved there; `purchases.int.test.ts` shows their behaviour through the app on the real stack (other person sees, changes and deletes nothing; wishlist_bought all-or-nothing, once, owner only).
