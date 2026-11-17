# WO-0082 mutation proof (CC14)

Scratch copy OUTSIDE the repository (`scratchpad/wo82-mut`: rsync of apps/web and packages, a symlinked node_modules and only supabase/config.toml so the real-stack suite runs there); one mutant at a time, applied by exact text replacement of one file, tests run with `vitest run` on: wishlist-plan.test, components/purchases/plan-a11y.test, lib/supabase/plan.int.test (real local stack), mapping.test, purchases-repository.test, components/design.test, components/contrast.test. The original file is restored after each mutant. Harness: scratchpad/wo82_mutate.py (not in the repository).

**Result: 25 mutants, 25 killed, 0 survivors** (the stated minimum is 10).

| Mutant | What was changed | Killed by |
| --- | --- | --- |
| M01 | a month in the past accepted for a new plan | wishlist-plan.test: a month in the past is refused for a new plan |
| M02 | the entry's own past month no longer valid when editing its budget | wishlist-plan.test: a month in the past ... stays valid for the month the entry already has |
| M03 | negative budget accepted (regex allows a minus) | wishlist-plan.test: a budget must be a plain non-negative amount |
| M04 | NaN accepted as a budget | wishlist-plan.test: a budget must be a plain non-negative amount |
| M05 | a budget typed with no month is silently dropped | wishlist-plan.test: a budget with no month is refused |
| M06 | currency of a budget not checked | wishlist-plan.test: a budget needs a currency of three capital letters |
| M07 | months 13 to 19 accepted | wishlist-plan.test: a month that is not YYYY-MM ... is refused; isMonth |
| M08 | months listed latest first | wishlist-plan.test: months run earliest first |
| M09 | totals summed across currencies | wishlist-plan.test: totals are per currency within the month; whole minor units |
| M10 | an entry whose plan was cleared (null) grouped under a month | wishlist-plan.test: months run earliest first; entries with no plan are kept apart |
| M11 | planned month sent as YYYY-MM, not the first day | wishlist-plan.test: patches ...; supabase: saving a plan ... |
| M12 | negative, NaN or infinite budget reaches the request | wishlist-plan.test: patches ...; supabase: saving a plan ... |
| M13 | stored month read as a full date | wishlist-plan.test: rows ...; plan.int: saves the month, budget and currency |
| M14 | numeric-string budget not converted to a number | wishlist-plan.test: rows: the plan columns are read ... |
| M15 | budget column not selected | wishlist-plan.test: rows ...; plan.int: saves the month ... |
| M16 | lower-case currency reaches the request | wishlist-plan.test: patches ...; plan.int: a malformed plan never reaches the database |
| M18 | the update has no row filter (every row of the person changed) | wishlist-plan.test: supabase: saving a plan ... through its own row only; plan.int: saves the month ... |
| M19 | bought entries stay on the wishlist (and in the plan) | purchases-repository.test: the wishlist lists open entries only; plan.int: a planned entry marked bought leaves the plan |
| M20 | entries without a plan are not listed | plan-a11y.test: the plan groups ...; nothing planned |
| M21 | the month total has no accessible name | plan-a11y.test: the plan groups ... labelled total |
| M22 | the month field is a date field | plan-a11y.test: the plan form names every field ... type="month" |
| M23 | the month input loses the 44px target rule | plan-a11y.test: the stylesheet still passes every design rule, and the month input ... |
| M24 | 11px text in the totals | design.test: passes every rule of cssProblems; plan-a11y.test (design rules) |
| M25 | a `plan_updated` event is recorded | wishlist-plan.test: no source file records or names a plan event |
| M26 | the empty Plan section says nothing | plan-a11y.test: with nothing planned the Plan section says so |

(M17 was a placeholder that was dropped before the run; the numbering keeps the gap. The harness printed `{"killed": 25, "total": 25}`.) Another person's plans staying invisible is enforced by row-level security in the database, not by app code: it is proved by plan.int (another person: list empty, get undefined, update undefined, own plan unchanged) and by the existing pgTAP isolation tests; no app mutant can break it without also breaking the own-row update (M18).
