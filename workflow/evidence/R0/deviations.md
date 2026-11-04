# R0 deviations (logged by the orchestrator, 2026-11-04)
1. Diff limit: WO-0001 changed 549 counted lines and WO-0002 756 (348 of them tests); the limit is 500. Accepted: splitting would have separated tests from the code they test. Later work orders are sized smaller.
2. WO-0002 changed `package-lock.json` (+8 lines, the workspace link). `npm ci` fails without it, so the work order's In scope list was incomplete. Fixed in R0.md: WO-0002 In scope now includes `package-lock.json` (workspace link entries only).
3. Environment: no Docker or Supabase CLI here, so the R0 items "local Supabase, first migrations, pgTAP in CI" are NOT built or verified in R0. They move to R2 and are marked blocked-by-environment in STATE.md.
4. The CI secret scan (BR-43) is added in the R0 fix loop as `workflow/gates/secret_scan.sh`.
5. Spec-level ownership conflicts found by Spec QC (R0 work orders edit paths that section 3.1 gives to other makers): accepted for R0 because the build runs with one maker per work order and the owner delegated approvals; section 3.1 will be updated in the R0 retro.
6. CI runs gate.sh without GATE_BASE, so the scope check runs only when invoked by hand or by the orchestrator at each work order; R1 retro to decide whether to enforce it in CI
7. secret_scan checks the working tree, not git history
8. R3 WO-0020 changed about 1,108 counted lines (about 550 production, 550 tests) against the 500 limit; accepted (scaffold plus tests), logged here by the orchestrator. Also: Next.js builds with webpack (`--webpack`) because Turbopack failed on the workspace packages' `.js`-suffixed TypeScript imports.
9. R3 WO-0021 changed about 872 counted lines (466 production, 406 tests) against the 500 limit; accepted and logged by the orchestrator.
10. R4 WO-0011 changed about 713 counted lines (about 418 tests, 290 implementation) against the 500 limit; accepted, logged by the orchestrator.
