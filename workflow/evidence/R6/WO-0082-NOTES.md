# WO-0082 notes (R6a, app): Plan purchases (FR-36), Release 0 slice only

Release 0 (demo) cut, per "Re-cut of 2026-11-07" in workflow/work-orders/R6.md. No secret-key use, no receipts, no dedicated security review. CC3 (Plan purchases), CC13, CC14.

## Moved to Release 1 (NOT built here)
Items (2) to (5) of the work order: (2) attach receipt images or PDFs to a purchase, (3) `DELETE /api/receipts/[id]`, (4) export with receipt and item-image files and the store-only ZIP writer `lib/zip.ts` (Release 0 keeps the existing JSON export), (5) the real-stack receipt tests (delete route, Leave the pilot with an attached receipt). Also the CC4 evidence. Nothing of these exists in the diff.

## What was built
- Database: no migration needed and none written (supabase/* untouched). `app.wishlist_entries` already has `planned_month date` (check: first day of the month), `budget numeric(12,2)` and `currency char(3)` from the core tables migration; the plan uses exactly those columns. The budget's currency is the entry's own `currency` column (there is no other use of it: the app has no target price).
- `lib/wishlist-plan.ts` (pure): `validatePlan` (month `YYYY-MM`, not in the past for a new plan, the entry's own month stays valid when only its budget is edited, at most ten years ahead; budget `^\d{1,10}(\.\d{1,2})?$` so NaN, Infinity, signs and exponents never leave the form, a currency of three capitals when a budget is given, a budget needs a month, an empty form is "no plan"), `groupByMonth` (months earliest first; total per currency per month through the existing whole-minor-unit `totalsByCurrency`, never summed across currencies; entries without a month in `unplanned`), `monthLabel` ("November 2026"), `monthOf`.
- `WishlistEntry` gains optional `plannedMonth`, `budget`, `currency` (absent for older entries). Both repositories: the local one stores them in its document through the ordinary `update`; the Supabase one maps them in `lib/supabase/mapping.ts` (`planned_month` is the first day of the month, read back as `YYYY-MM`; the budget is read from a number or numeric string; a malformed stored value or a negative, NaN or infinite budget, a malformed month or currency in a patch is refused, never sent). `WISHLIST_SELECT` reads the three columns. A mapping error in a patch now comes back as a rejected promise (it threw synchronously before) in `lib/supabase/repository.ts`.
- Screens: `/wishlist` (decision: the plan lives on the wishlist page, not on /purchases, because the plan belongs to the wishlist entries and the page already lists them). A "Plan" section with one group per planned month (earliest first) and a labelled total per currency, then a "Not planned" group for entries without a plan. Each entry has Plan / Edit plan (month input, budget, currency, Save plan, Remove plan, Cancel) next to Mark as bought; one form open at a time. `components/purchases/PlanForm.tsx`, `PlanGroups.tsx`, `WishlistView.tsx`.
- `plan_updated` is NOT an event: no event type, no `record` call; a source test proves it.
- CSS: one selector extended (`input[type='month']` joins the date input rule); every other class is reused (`.totals`, `.card.line`, `.list`, `.row`, `.form`, `.muted`). Tokens only, nothing raw.

## Decisions
- A plan needs a month; a budget without a month is refused ("Choose the month you plan to buy this."), so there is no half-plan. A month without a budget is a valid plan and adds nothing to the month's total ("No budget set for this month.").
- Totals are budgets as entered, per currency; no conversion (FR-33 conversion applies to purchase prices, and the work order asks for per-currency totals).
- "Remove plan" clears all three columns (the currency too, since it only exists for the budget).
- A bought entry leaves the wishlist (existing behaviour, status filter) and so leaves the plan.

## Tests (new; nothing existing changed or weakened)
- `lib/wishlist-plan.test.ts` (20): validation, grouping and totals (incl. a fast-check property: every per-currency total equals the sum of that currency's budgets), repositories (local reload and clear; rows and patches; Supabase request shape), no plan event source scan.
- `components/purchases/plan-a11y.test.ts` (7): structure and accessible names of the form and groups, never summed across currencies in the markup, month input 44px rule, no inline style, every class defined, design rules still green.
- `lib/supabase/plan.int.test.ts` (5, real local stack): save and read back (checked with SQL: `2026-12-01|149.50|EUR`), clear, malformed patches never reach the database, totals per month per currency through the database, another person's plans are never visible or changeable (list empty, get undefined, update undefined, own plan unchanged), a bought entry leaves the plan.
- Existing `design.test.ts` and `contrast.test.ts` stay green. Whole-run counts are in the gate log in the report.
- Mutation: `WO-0082-mutation.md` (25 of 25 killed).

## Real-browser evidence (local stack, `next build --webpack`, `next start` on port 3187, keys read at run time from `supabase status -o json` into process env only)
Throwaway user `wo82-*@example.test` (password generated at run time, kept in a scratch file outside the repo, deleted), seeded with 7 wishlist entries through the repository. User, invitation and mail deleted afterwards (0 `@example.test` users, 0 wishlist rows, 0 fx rows left), server stopped (no listener on 3187), `apps/web/.next`, `.vitest` and `.env.local` removed, viewport reset to desktop.
Screenshots in `screenshots/`: desktop 1 plan by month (EUR 80.00 in November; December EUR 184.50 and USD 220.00 side by side), 2 plan form, 3 errors (a past month and a negative budget), 4 "Not planned" group, 5 after saving a plan (December EUR 244.50 = 149.50 + 35 + 60, USD 220.00 unchanged); mobile (375px) 1 plan by month, 2 plan form under "Not planned", 3 edit plan prefilled (Save, Remove, Cancel). Also checked in the browser: no horizontal scroll at 375px (scrollWidth 375), "Remove plan" moved the entry back to "Not planned" and the database row had the three columns null, the database after the flow held `2026-12-01|60.00|EUR` for the entry planned in the browser.
Observed, not fixed: at 375px the Cancel button wraps to a third row under Save plan and Remove plan (still usable, 44px targets).

## Not done / not verified
- No design critic score here (the critic scores from the screenshots). No axe tool in the repo; the repo's regex a11y checks cover the new screens.
- A browser without a month input (some desktop Safari versions) shows a text field with the placeholder `YYYY-MM`; validation is the same. Not tried in such a browser.
- No catalogue, receipt or export work (other work orders and Release 1).
