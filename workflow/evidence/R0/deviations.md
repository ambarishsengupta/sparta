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
11. R4 WO-0012 changed about 683 counted lines (about 402 tests) against the 500 limit; accepted, logged by the orchestrator.
12. R5a WO-0031 changed about 582 counted lines including 176 of new python tests against the 500 limit; accepted, logged by the orchestrator.
13. R2 WO-0040 changed about 494 counted lines (limit 500): within limit.
14. R2 WO-0041 changed about 1,350 counted lines (545 migrations, 659 pgTAP tests, 144 helper) against the 500 limit; accepted as security tests, logged by the orchestrator.
15. R2b WO-0050 changed about 958 counted lines (532 tests, 426 code) against the 500 limit; accepted, logged by the orchestrator.
16. R2b WO-0052 changed about 1,083 counted lines (446 code, 636 tests and support) against the 500 limit; accepted, logged by the orchestrator.
17. R2b WO-0053 changed about 639 counted lines (80 code, 559 tests and support) against the 500 limit; accepted (tests), logged by the orchestrator.
18. R2c WO-0061 changed about 2,220 counted lines (about 1,230 tests and test support, 814 source) against the 500 limit; accepted (security-critical tests), logged by the orchestrator.
19. R2c WO-0062 changed about 1,200 counted lines (about 800 tests) against the 500 limit; accepted (security tests), logged by the orchestrator.
20. R5b WO-0070 changed about 1,000 counted lines (migrations 363, tests 560+) against the 500 limit; accepted (security tests), logged by the orchestrator.
21. R5b WO-0071 changed about 1,300 counted lines (393 source, 910 tests) against the 500 limit; accepted (security tests), logged by the orchestrator.
