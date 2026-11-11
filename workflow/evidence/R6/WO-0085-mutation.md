# WO-0085 mutation proof (R6b, Release 0)

Scratch copy of the web app OUTSIDE the repository (`<session scratchpad>/mut85`, node_modules linked read-only). Each mutant is one textual change to one source file of the copy, run against `apps/web/lib/catalogue.test.ts`, `apps/web/components/catalogue/`, `apps/web/lib/supabase/catalogue-repository.test.ts` and `apps/web/lib/supabase/gate-pages.test.ts`; the file is restored after each run. The real-stack suite `catalogue.int.test.ts` is not part of the mutation runs (it proves the same rules against the database).

First run: 29 of 31 killed; mutants 28 and 29 survived. Two source-level tests were added (`paging and retry` in components/catalogue/a11y.test.ts) and both were then killed. Final result: **31 of 31 killed**, 0 survivors.

| # | Mutant | Result | Failing test (first) |
| --- | --- | --- | --- |
| 1 | sourceLink allows http | KILLED | View at source (FR-24) > anything else gives no link at all |
| 2 | sourceLink allows a login in the address | KILLED | sourceLink: https only (FR-24) > gives the address for https and nothing for anything else |
| 3 | link loses nofollow | KILLED | View at source (FR-24) > an https address gives a link that opens in a new tab with noopener, noreferrer and n |
| 4 | link loses noopener and noreferrer | KILLED | View at source (FR-24) > an https address gives a link that opens in a new tab with noopener, noreferrer and n |
| 5 | page no longer asks for status active | KILLED | catalogue page request > drops a filter value the taxonomy does not know instead of sending it |
| 6 | brands no longer ask for status active | KILLED | catalogue page request > brands: the distinct names of active rows, sorted by the database, empty names left o |
| 7 | no look-ahead row, so no next page | KILLED | catalogue page request > reads catalog.catalog_items for active rows only, name then id, 41 rows to see whethe |
| 8 | keyset compares id the wrong way | KILLED | catalogue page request > continues after a cursor with a quoted keyset condition; a cursor whose id is not a u |
| 9 | quoted() no longer escapes | KILLED | catalogue page request > continues after a cursor with a quoted keyset condition; a cursor whose id is not a u |
| 10 | search wildcards not escaped | KILLED | catalogue page request > searches name or brand with the text quoted and the wildcards escaped, so a comma or  |
| 11 | brand filter on the wrong column | KILLED | catalogue page request > sends each filter once, as the right column |
| 12 | colour family filter on the wrong column | KILLED | catalogue page request > sends each filter once, as the right column |
| 13 | occasion style sent as fit | KILLED | catalogue page request > sends each filter once, as the right column |
| 14 | unknown category passed through | KILLED | filter checks > drops values the taxonomy does not know, trims and caps the text |
| 15 | catalogue item saved as manual | KILLED | from the picker to the item (FR-21, FDD 13) > the item row has origin catalogue, the link, the brand and the s |
| 16 | link to the catalogue not saved | KILLED | from the picker to the item (FR-21, FDD 13) > the item row has origin catalogue, the link, the brand and the s |
| 17 | purchase event origin manual | KILLED | the item form from the catalogue (FR-21) > the save path records the purchase with origin catalogue, only when |
| 18 | item event origin manual | KILLED | the item form from the catalogue (FR-21) > the save path records the purchase with origin catalogue, only when |
| 19 | a date alone no longer makes a purchase | KILLED | from the picker to the item (FR-21, FDD 13) > a price paid or a date makes a purchase, and both are then neede |
| 20 | negative or infinite price accepted | KILLED | catalogueFromRow (FR-21) > refuses a negative, infinite or non-numeric price and a currency that is not three  |
| 21 | missing colour no longer neutral grey | KILLED | catalogueFromRow (FR-21) > keeps a row without a colour (neutral grey), without a price, brand or sizes |
| 22 | Start from popular items goes nowhere | KILLED | onboarding choice (FR-7) > the country is still checked before any of the three goes anywhere, and each button |
| 23 | popular choice goes to the wrong page | KILLED | from the picker to the item (FR-21, FDD 13) > onboarding sends each choice to its page |
| 24 | thin-wardrobe link not to the catalogue | KILLED | the thin-wardrobe message links to the catalogue (FR-54) > the missing-items notice has a link to /catalogue a |
| 25 | wardrobe tile not tinted in the stored colour | KILLED | illustrated tiles in the wardrobe and on the item page (FR-24) > every wardrobe tile draws the category illust |
| 26 | in-memory keyset repeats the cursor row | KILLED | filterCatalogue: the same search in memory > lists 40 at a time by name then id and gives the cursor of the la |
| 27 | demo catalogue loses a brand | KILLED | the bundled SYNTHETIC demo catalogue (browser-only prototype) > is 40 invented items, flagged synthetic, with  |
| 28 | no Show 40 more | KILLED (after the added test) | paging and retry (source checks: no DOM runs in these tests) > "Show 40 more" appears only when the page gave  |
| 29 | a retry adds the item twice | KILLED (after the added test) | paging and retry (source checks: no DOM runs in these tests) > a save whose purchase failed is retried on the  |
| 30 | no illustration on the item page | KILLED | illustrated tiles in the wardrobe and on the item page (FR-24) > the old flat colour square is gone and the it |
| 31 | empty state without Add my own | KILLED | the empty catalogue (CC6) > says so in plain words and offers Add my own, inside the branch that runs only whe |

Weakest kills, said plainly: mutants 17, 18, 22, 24, 25, 28, 29, 30, 31 are killed by source-text assertions (the repo has no DOM test runner, so a click or a state change cannot be run here); the behaviour itself was exercised in the real browser (see WO-0085-NOTES.md).


## Second, independent run (a second maker session, same work order)

A second maker found the first one's tree and evidence while it was working, so it re-ran its own set of 39 mutants rather than trust the table above. Method: scratch copy of apps/web, supabase/scripts and packages OUTSIDE the repository (`<session scratchpad>/mut`, root node_modules symlinked), one textual change to one source file of the copy at a time, the file restored from the real tree after each run, the real tree never edited by the runner. Tests run for each mutant: `lib/catalogue.test.ts`, `components/catalogue/`, `lib/supabase/catalogue-repository.test.ts`, `source.test.ts`, `gate-pages.test.ts`, `mapping.test.ts` and `catalogue.int.test.ts` (real local stack). **39 of 39 killed, 0 survivors, 0 mutants failed to apply.** It adds the lines the first table does not name: the https-only check removed outright, the status filter, the keyset (`gte`, missing id order, id compare), the or() quoting, the no-double-item retry guard, origin `catalogue` on the saved item and both events, the event carrying the item id, `startPage` for all three choices, the empty state, page size 50, an exact-40 page, an `<img>` in a tile, the demo flag.

| # | Mutant | Result | First failing test |
| --- | --- | --- | --- |
| 1 | sourceLink accepts http as well (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: sourceLink: https only (FR-24) gives the address for https and nothing for anything else |
| 2 | sourceLink drops the protocol check altogether (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: sourceLink: https only (FR-24) gives the address for https and nothing for anything else |
| 3 | sourceLink accepts an address with a login in it (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: sourceLink: https only (FR-24) gives the address for https and nothing for anything else |
| 4 | View at source loses nofollow (`components/catalogue/SourceLink.tsx`) | KILLED | components/catalogue/a11y.test.ts: View at source (FR-24) an https address gives a link that opens in a new tab with noopener, nor |
| 5 | View at source loses noopener (`components/catalogue/SourceLink.tsx`) | KILLED | components/catalogue/a11y.test.ts: View at source (FR-24) an https address gives a link that opens in a new tab with noopener, nor |
| 6 | catalogue read no longer asks for status = active (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request reads catalog.catalog_items for active rows only, name then id, 41 rows  |
| 7 | brand list no longer asks for status = active (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request brands: the distinct names of active rows, sorted by the database, empty |
| 8 | keyset uses name.gte (repeats the last row) (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request continues after a cursor with a quoted keyset condition; a cursor whose  |
| 9 | keyset drops the id tie-break order (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request reads catalog.catalog_items for active rows only, name then id, 41 rows  |
| 10 | keyset id comparison id.gte (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request continues after a cursor with a quoted keyset condition; a cursor whose  |
| 11 | or() value quoting loses the escape of quote and backslash (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request searches name or brand with the text quoted and the wildcards escaped, s |
| 12 | search text is not quoted inside or() (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request searches name or brand with the text quoted and the wildcards escaped, s |
| 13 | search text wildcards not escaped (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request searches name or brand with the text quoted and the wildcards escaped, s |
| 14 | search only by name, not brand (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request searches name or brand with the text quoted and the wildcards escaped, s |
| 15 | saved item origin is manual (`lib/supabase/mapping.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) the item row has origin catalogue, the link, the br |
| 16 | catalog_item_id not saved (`lib/supabase/mapping.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) the item row has origin catalogue, the link, the br |
| 17 | size not saved (`lib/supabase/mapping.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) the item row has origin catalogue, the link, the br |
| 18 | retry guard removed (a retry makes the item again) (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: paging and retry (source checks: no DOM runs in these tests) a save whose purchase failed is re |
| 19 | retry guard never remembers the item (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: paging and retry (source checks: no DOM runs in these tests) a save whose purchase failed is re |
| 20 | purchase event origin is manual (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: the item form from the catalogue (FR-21) the save path records the purchase with origin catalog |
| 21 | item_added event origin is manual (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: the item form from the catalogue (FR-21) the save path records the purchase with origin catalog |
| 22 | purchase event also carries the item id (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: the item form from the catalogue (FR-21) the save path records the purchase with origin catalog |
| 23 | purchase recorded even when nothing was typed (`components/wardrobe/ItemForm.tsx`) | KILLED | components/catalogue/a11y.test.ts: the item form from the catalogue (FR-21) the save path records the purchase with origin catalog |
| 24 | startPage: popular goes to the wardrobe (`lib/onboarding.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) onboarding sends each choice to its page |
| 25 | startPage: own goes to the catalogue (`lib/onboarding.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) onboarding sends each choice to its page |
| 26 | startPage: skip goes to the picker (`lib/onboarding.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) onboarding sends each choice to its page |
| 27 | empty state loses Add my own (`components/catalogue/CatalogueView.tsx`) | KILLED | components/catalogue/a11y.test.ts: the empty catalogue (CC6) says so in plain words and offers Add my own, inside the branch that  |
| 28 | empty state shown also while a failure is on screen (`components/catalogue/CatalogueView.tsx`) | KILLED | components/catalogue/a11y.test.ts: the empty catalogue (CC6) says so in plain words and offers Add my own, inside the branch that  |
| 29 | page size 50 (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: filterCatalogue: the same search in memory lists 40 at a time by name then id and gives the cur |
| 30 | in-memory next cursor given on an exact full page (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: filterCatalogue: the same search in memory lists 40 at a time by name then id and gives the cur |
| 31 | in-memory keyset repeats the cursor row (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: filterCatalogue: the same search in memory lists 40 at a time by name then id and gives the cur |
| 32 | supabase next cursor on an exact full page (`lib/supabase/repository.ts`) | KILLED | lib/supabase/catalogue-repository.test.ts: catalogue page request gives 40 rows and the cursor of the 40th when a 41st exists, and none wh |
| 33 | a price alone no longer makes a purchase (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: from the picker to the item (FR-21, FDD 13) a price paid or a date makes a purchase, and both a |
| 34 | filter category not checked against the taxonomy (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: filter checks drops values the taxonomy does not know, trims and caps the text |
| 35 | wardrobe tile back to a flat swatch (`components/wardrobe/WardrobeList.tsx`) | KILLED | components/catalogue/a11y.test.ts: illustrated tiles in the wardrobe and on the item page (FR-24) every wardrobe tile draws the ca |
| 36 | thin-wardrobe message loses the catalogue link (`components/outfits/OutfitsView.tsx`) | KILLED | components/catalogue/a11y.test.ts: the thin-wardrobe message links to the catalogue (FR-54) the missing-items notice has a link to |
| 37 | demo flag removed from the picker (`components/catalogue/CatalogueView.tsx`) | KILLED | components/catalogue/a11y.test.ts: the flagged demo catalogue (re-cut of 2026-11-07) the browser-only (local) backend says in the  |
| 38 | tile shows an img for the source picture (`components/catalogue/CatalogueView.tsx`) | KILLED | components/catalogue/a11y.test.ts: the picker (FR-21, CC6) the demo tiles never contain an img, an external address or an inline c |
| 39 | catalogue row with an unknown sub-type is shown (`lib/catalogue.ts`) | KILLED | lib/catalogue.test.ts: catalogueFromRow (FR-21) skips a row it cannot show: no id, name or link, an unknown category,  |

Same caveat as above: mutants 18 to 23, 27, 28, 35 to 38 are killed by source-text assertions (no DOM runner in the repo); the request-level mutants (6 to 14, 32) are killed by tests that read the exact PostgREST calls a fake client receives, and the real-stack suite `catalogue.int.test.ts` covers the same behaviour against the database (it did not need to be the killer).
