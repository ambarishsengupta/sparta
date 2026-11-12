# WO-0112 mutants (no maker minimum; 12 run on a scratch copy outside the repository, removed afterwards; all killed)
Web (vitest on a scratch copy of apps/web with symlinked node_modules):
- M1 filter added instead of replaced (`filterReducer` keeps the old filter): killed by dashboard.test.ts "FR-77 ... a size filter, then a season filter".
- M2 null shown as 0 (`Bar`): killed by vendor-ui.test.ts (BarList null row, BandShareBar, TrendTable).
- M3 share over the raw sum of the rows (Dashboard.tsx): killed by dashboard.test.ts "share over the coverage" markup test (`60 users / 40%`) and the "only the share division" source test.
- M4 event recorded every render (effect without the key guard): killed by the once-per-view source test.
- M5 bar without its text value: killed by vendor-ui.test.ts (three tests).
- M6 bar without the minimum width: killed by vendor-ui.test.ts (barWidth and BarList scaling).
- M7 radius on the bar track (the CSS module): killed by design.test.ts `cssProblems` on the module (and its permanent mutants, which also cover raw colour, shadow, 11px text, gradient) and the token test in vendor-ui.test.ts. (Run before the styles moved from globals.css into the module; the same assertions now run on the module.)
- M8 hidden segment dropped instead of null (`withHidden`): killed by dashboard.test.ts (withHidden and loadMix tests).
Database (pgTAP 021 in a rolled-back transaction on the local stack, pgtap created inside it):
- MIG1 policy `using (true)` (open to every vendor): killed (tests 5, 6, 7).
- MIG2 `created_at` readable: killed (tests 2, 10, 11).
- MIG3 policy ignores the vendor (any membership at all): killed (tests 5, 6, 7).
- MIG4 write grant on `name`: killed (tests 3, 12).
Baseline of the same harness: 12 of 12 ok. Survivors: none.
