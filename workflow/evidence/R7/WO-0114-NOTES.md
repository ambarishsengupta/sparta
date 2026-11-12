# WO-0114 notes: vendor portal polish (four visible defects)

## What changed
1. Row headers: `.trend tbody th { border-bottom-color: var(--hairline); }` in `vendor-charts.module.css` (globals.css untouched). Rule `vendorTableProblems` in `design-rules.ts` + test and 2 CSS mutants in `design.test.ts`.
2. Ownership mix: `BarList max={cov.users_rounded || undefined}` in `Dashboard.tsx`, so a bar is count / cohort (the share shown), 3% minimum kept; falls back to the largest segment only when the cohort is hidden. Test: unfiltered 60 = 40%, filtered 35 = 23%, 30 = 20%, 5 of 150 = 3% minimum.
3. Price bands: `ordered()` in `FilterBar.tsx` sorts the price_band options by `PRICE_BANDS` (same order as `packages/taxonomy` priceBands and `lk_price_band.sort`). Test compares the rendered order with `taxonomy.json` read from the package, so the two cannot drift.
4. Heading: the `<h1>` moved from `app/vendor/reports/[id]/page.tsx` into `ReportView`: "Report: November 2026" from the report period (no locale, no time zone), plain "Report" while loading, on error or when not found. Test for 2 months and 3 states; the page no longer has an h1.

## Deviations
- `PRICE_BANDS` is a constant in FilterBar, not an import: `@sparta/taxonomy` exports only `index.ts` and does not export `priceBands` (package is outside the In scope), `filter_options` returns text order. Size options are still text-sorted (not one of the four items).

## Mutants (scratch copy outside the repo, removed): th override removed, bar back to largest-segment scale, text sort of price bands, heading without month: each caught by exactly the new tests (3, 1, 1, 1 failures); restored copy green.

## Evidence (1280px, light scheme, built app on port 3114, throwaway vendor of the demo vendor, seed removed with `--remove`, user rows deleted, server stopped, .next/.vitest removed)
`screenshots/WO-0114-1280-dashboard-table.jpg` (hairline under row headers; Outerwear 35 users / 23% is a 23% bar), `screenshots/WO-0114-1280-report-heading.jpg` ("Report: November 2026"). Also read in the browser: price band options `25-50 | 50-100 | 100-200 | Unknown`; computed row-header and cell border colour both rgb(212, 212, 212).
