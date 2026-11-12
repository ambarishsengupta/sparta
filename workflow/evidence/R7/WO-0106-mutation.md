# WO-0106 mutants (no maker minimum by the cull; 6 run on a scratch copy of apps/web outside the repository with symlinked node_modules, removed afterwards)
Baseline of the same harness: 56 of 56 ok (`vitest run apps/web/lib/vendor/gaps.test.ts apps/web/components/vendor`).
- M1 "no visible ownership" rows ranked before the scored ones (`rankGaps`): killed (gaps.test.ts rankGaps; loadGaps ordering).
- M2 hidden owner count shown as 0 (`GapsTable`: `?? 0`): killed (gaps-reports.test.ts "never 0").
- M3 uuid check dropped (`openReport` always calls `report`): killed (gaps.test.ts, six malformed ids make a call; gaps-reports.test.ts source test).
- M4 `vendor_report_opened` recorded for a missing report and on every load (`if (r.ok)`): killed (gaps-reports.test.ts source test on the guard).
- M5 hidden list computed even when the unfiltered answer was cut at TOP_N: killed (gaps.test.ts "does not claim a segment is hidden").
- M6 hidden list computed without `filter &&`: SURVIVES, and is equivalent: with no filter `withBase` returns the same array as base and now, so the difference is always empty.
