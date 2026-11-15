# Audit of 2026-11-15: findings, lint rules and fix work orders
Date: 2026-11-15
Requested by: product owner, 2026-11-15 ("thoroughly go through what's been done, find any leaks or gaps or issues and update the work items to fix them and use lint rules to make sure these things don't ever happen again"). Conventions in R0.md. Every work order uses GATE_WO=workflow/work-orders/Audit.md with its WO_ID. Base branch: release/hm-demo (tip e5dd0cf).
Scope of the audit: everything on release/hm-demo: repository contents and Git history, the web app (pages, components, route handlers, proxy), the engine packages, the database (read from the live catalog of the local stack after `supabase db reset`), the worker, the collector, the model scripts, the gate scripts, the CI workflow and the work-item list. Not covered: a penetration test (X-PEN stays open), the H&M-trained parts (not built) and anything hosted (nothing is hosted).

## What was checked and found clean
- **Secrets.** No key, token or password in the tree or in any commit on any branch (pattern search over the whole history; only the local stack's public default `postgres:postgres@127.0.0.1` appears). `npm audit --omit=dev`: 0 vulnerabilities.
- **Database.** All 52 tables in app, catalog, ops, analytics and analytics_private have row-level security enabled and forced. All 31 security definer functions pin an empty search_path. `anon` can run one function and read no table. No policy applies to anon or public. The three storage buckets are private with size and type limits.
- **Secret-key boundary.** `SUPABASE_SECRET_KEY` is read in one module, imported by five route handlers and nothing else; no component reads `process.env`; no `dangerouslySetInnerHTML`, `eval` or console output in app code; no lint or type suppression comment; no focused or skipped test.

## Findings
| # | Kind | Severity | Finding | Fixed by |
| --- | --- | --- | --- | --- |
| A1 | Leak | High | The GitHub repository is **public** and `submissions/D3/ANCP_TM_D3_eda.ipynb` and `.html` show five H&M purchase rows (dates, article ids, prices) in a rendered table, plus 22 more table outputs. Known as legal finding 20 and listed in legal/HM-DEMO-DECISION.md as "should be removed"; still in the tree and in the pushed history. | WO-0124, X-HIST |
| A2 | Gap | High | The gate reports PASS when the local database or the Python virtualenv is missing: db_tests, worker_tests, collector_tests and 20 integration suites (`describe.skipIf(!stack)`) are skipped and count as green. The GitHub workflow runs exactly this reduced gate, so CI has never run a database, worker or collector test. | WO-0123 (strict mode), WO-0127 (CI) |
| A3 | Gap | Medium | The gate's typecheck read 170 of about 320 TypeScript files: `apps/web/app/**`, `components/**` and the route handlers were type-checked only as a side effect of the build in web_containment. | WO-0123 |
| A4 | Gap | Medium | ESLint ran the two recommended presets only. The project's own boundaries (who reads a secret, who reaches the network, who imports lib/server) were held by regex scans over source text, and code was written around them (`'fet' + 'ch'` in lib/server/purge.ts so the word does not trip the scan). | WO-0123 (rules), WO-0125 (clean-up) |
| A5 | Issue | Medium | 17 promise mistakes: 8 floating promises in the vendor portal (Dashboard, Gaps, Reports: a rejected load leaves "Loading." for ever), 8 async form handlers whose rejection nobody catches, and one `return` without `await` inside `try` in the take-down route (a rejected call skips the route's own error answer). | WO-0125 |
| A6 | Gap | Medium | Rows read from the database are `any` in the app: there are no generated database types. 13 unchecked uses, among them `lib/supabase/gate-state.ts` (the access gate) and `lib/vendor/reports.ts`. A renamed column would compile and fail at run time. | WO-0126 |
| A7 | Gap | Low | `.gitignore` ignored `.env.local` only. `.env`, `.env.production` and `jobs/collector/.env` could be committed by accident. | WO-0123 (done) |
| A8 | Gap | Low | Supply chain: `pandas>=2.0` was the one floating Python pin; the worker image names its base by tag; the workflow names its actions by tag and set no `permissions:` (default token rights). | WO-0123 (pin, permissions), WO-0127 (digests) |
| A9 | Issue | Low | `torch.load` in export_onnx.py did not pass `weights_only=True`. | WO-0123 (done) |
| A10 | Issue | Low | Five colour helper functions in the catalog schema leave search_path open; the plpgsql linter reports two unsafe text-to-uuid[] casts in `app.confirm_receipt` and cannot see the temporary table of `analytics.run_aggregation`. | WO-0128 |
| A11 | Drift | Low | Work items and documents out of step with the code: WO-0100, 0102, 0103, 0104, 0105 were built and merged but listed Todo; README said "Implementation has not started"; the head of workflow/STATE.md still described 4 November. | WO-0123 (done) |
| A12 | Gap | Low | No linter reads the 7,000 lines of Python or the React components for hooks and accessibility mistakes, and nothing checks regular expressions for slow cases (one quadratic regex was found by a human in R2c). These need new development dependencies. | WO-0129 |
| A13 | Gap | Medium (before hosting) | Confirmed and not on the item list as their own lines: the Content-Security-Policy has no script-src; the rate limiters count per process (no brake on a host that runs several instances); a build without `NEXT_PUBLIC_DATA_BACKEND=supabase` silently runs with no sign-in at all. | WO-0130 |

## How the lint keeps each finding from coming back
| Finding | Rule that now fails the gate |
| --- | --- |
| A1 | repo_lint RL03 (H&M article ids in any tracked text), RL12 (notebook committed with table outputs), RL01 (data tables, model files), RL02 (files over 1 MB) |
| A2 | `GATE_STRICT=1` fails any stage that printed SKIPPED; the last line says PASS (FULL) or PASS (PARTIAL); workflow rule 12 requires FULL before a merge |
| A3 | `npm run typecheck` now also runs `tsc -p apps/web/tsconfig.json` |
| A4 | ESLint: `no-restricted-syntax` (process.env, HTML injection), `no-restricted-globals` (fetch and friends), `no-restricted-imports` (lib/server, client factories, Node modules in the engine), `noInlineConfig`; workflow/gates/lint_rules.test.ts proves each one fires |
| A5 | ESLint type-aware: no-floating-promises, no-misused-promises, return-await, await-thenable |
| A6 | ESLint type-aware: the five no-unsafe-* rules outside tests |
| A7 | repo_lint RL04 (paths that must be ignored), RL01 (env files) |
| A8 | repo_lint RL06 (pins), RL07 (Dockerfile), RL08 (workflows) |
| A9 | repo_lint RL05 (Python syntax-tree checks) |
| A10 | supabase/tests/database/900_catalog_lint.test.sql (catalog-wide, covers future schemas) and the db_lint stage (plpgsql linter against a baseline) |
| A11 | repo_lint RL11 (a work order with a commit is not Todo; every work order has an item row) |

Existing violations are held in three baseline files that can only shrink: `eslint-suppressions.json` (40 entries), `workflow/gates/repo_lint.baseline.json` (7 entries) and `workflow/gates/db_lint.baseline.json` (2 entries). The work orders below empty them.

---
# Work Order WO-0123: lint rules, repository lint, database lint and the strict gate
Action: execute (done in the audit session of 2026-11-15). Owner: Gate engineer. Checker: Spec QC.
In scope: eslint.config.js, eslint-suppressions.json, package.json, .gitignore, .github/workflows/ci.yml, workflow/gates/**, supabase/tests/database/900_catalog_lint.test.sql, docs/LINT-RULES.md, docs/MVP-AGENT-WORKFLOW.md, README.md, workflow/STATE.md, workflow/github/work-items.csv, workflow/work-orders/Audit.md, workflow/work-orders/Womenswear.md, docs/CR-001-womenswear.md, ml/recommendation-engine/requirements.txt, ml/recommendation-engine/garment/export_onnx.py
Note: no new dependency. No application behaviour changes: the only edits outside tooling are the pandas pin (to the version the tests ran with) and `weights_only=True`.
Instructions: as built. ESLint rules in four groups (everywhere; the web app; the engine packages; type-aware), all errors, inline disabling off, the baseline in eslint-suppressions.json. `workflow/gates/repo_lint.py` with rules RL01 to RL12 and its exceptions file. `900_catalog_lint.test.sql` with 13 catalog-wide assertions. `workflow/gates/db_lint.sh`. `gate.sh`: stages repo_lint and db_lint, the list of skipped stages, `GATE_STRICT=1`. Workflow rule 12.
Completion conditions: `GATE_STRICT=1 bash workflow/gates/gate.sh` ends with `GATE: PASS (FULL: no stage skipped a check)`; `npx vitest run workflow/gates/lint_rules.test.ts workflow/gates/repo_lint.test.ts` passes; `python3 workflow/gates/repo_lint.py --selftest` reports 0 failures.

---
# Work Order WO-0124: take the H&M rows out of the D3 submission
Action: execute. Owner: ML maker (course submissions). Checker: Privacy and licence check (G4).
In scope: submissions/D3/**, workflow/gates/repo_lint.baseline.json, workflow/gates/repo_lint.test.ts, legal/LEGAL-REVIEW.md, legal/HM-DEMO-DECISION.md
Note: finding A1. The repository is public. This work order cleans the current tree; rewriting the pushed history is the owner's decision (item X-HIST) because it needs a forced push. Do not push.
Instructions: in `ANCP_TM_D3_eda.ipynb` clear every cell output that renders a table of rows (23 outputs; `.head()`, `.sample()` and similar), keeping charts and aggregate tables that hold no article id, customer id or single purchase; where a table is needed for the reading, replace it with an aggregate (counts by group). Regenerate `ANCP_TM_D3_eda.html` from the cleaned notebook with the local H&M folder (never commit that folder), or, if the notebook cannot be re-run, remove the same tables from the HTML by hand. Keep both files under 1 MB if the charts allow it (drop embedded plot data that repeats); otherwise move the HTML out of the repository and link the course copy. Delete the five D3 entries from `workflow/gates/repo_lint.baseline.json`. Update legal finding 20 and the "Known earlier finding" line of HM-DEMO-DECISION.md to say the tree is clean and the history question is X-HIST.
Decision of 2026-11-15 (orchestrator, on the recommendation of the Opus Spec QC of this work order): the 12 charts are about 1.6 MB of the notebook and of the HTML, so neither file can go under 1 MB without degrading a submitted course deliverable. The two RL02 entries move from `baseline` to the permanent `allow` list with that reason; the counts in `workflow/gates/repo_lint.test.ts` change to allow at most 13 and baseline at most 2. Every kept aggregate table must still be readable as plain text in both files (the insight log of cell 54 included).
Completion conditions: `python3 workflow/gates/repo_lint.py` passes with no RL03 or RL12 entry for submissions/D3 and no D3 entry in `baseline`; no article id of the old table is left in either file; the two-page summary PDF still matches the notebook's figures; gate green (WO_ID=WO-0124).

---
# Work Order WO-0125: handle every promise, and remove the code written around the old scans
Action: execute. Owner: Frontend maker. Checker: Spec QC + code review.
In scope: apps/web/components/**, apps/web/app/api/admin/sources/[id]/takedown/route.ts, apps/web/lib/supabase/mapping.ts, apps/web/lib/server/purge.ts, apps/web/test-support/network-scan.ts, apps/web/components/outfits/outfits.test.ts, eslint-suppressions.json, workflow/gates/lint_rules.test.ts
Note: findings A4 and A5. Behaviour the user sees changes in one way only: a failed load shows the fixed error sentence instead of "Loading." for ever.
Instructions: (1) vendor/Dashboard.tsx, Gaps.tsx, Reports.tsx: every load in an effect ends in a handler that sets the slot to the `unexpected` insight (export one helper from lib/vendor/insights.ts); add a test per component with a loader that rejects. (2) The eight form components flagged by no-misused-promises (ExportButton, LeaveForm, SettingsForm, AuthForm, AcceptTermsForm, OnboardingForm, PilotNoticeForm, AgreementForm): the submit handler is a plain function that starts the async work and catches its rejection into the form's error state. Replace the deprecated `FormEvent` type. (3) takedown/route.ts: `return await` inside the try. (4) mapping.ts lines 191 and 192: check `typeof` before `String(...)`. (5) ItemPurchases.tsx and ItemForm.tsx: replace `confirm()` with the in-page confirmation pattern LeaveForm already uses. (6) purge.ts: write the header name as the plain string `'sec-fetch-site'` and change the regex scan in network-scan.ts and outfits.test.ts so it reads call expressions, or delete the scan where the ESLint rule `no-restricted-globals` now covers the same files (keep one test that the three allowed files are the only ones). (7) After each step run `npx eslint . --prune-suppressions` and lower the number in lint_rules.test.ts.
Completion conditions: eslint-suppressions.json holds no entry for no-floating-promises, no-misused-promises, return-await, no-deprecated, no-alert or no-base-to-string; the new rejecting-loader tests pass; no string in apps/web is assembled to avoid a scan (`git grep -n "'fet' + 'ch'"` prints nothing); gate green with GATE_STRICT=1.

---
# Work Order WO-0126: generated database types, and no unchecked value from the database
Action: execute. Owner: Backend maker. Checker: Spec QC + code review.
In scope: apps/web/lib/supabase/**, apps/web/lib/vendor/**, apps/web/lib/server/**, apps/web/app/(auth)/sign-up/page.tsx, apps/web/components/account/account-actions.ts, supabase/scripts/**, workflow/gates/**, package.json, eslint-suppressions.json
Note: finding A6. No new dependency: `supabase gen types typescript --local` is part of the CLI already in use.
Instructions: add `supabase/scripts/gen-types.sh` that writes `apps/web/lib/supabase/database.types.ts` from the LOCAL stack for the schemas app, catalog, ops and analytics; commit the file. Give the three client factories and `createAdminSupabase` the `Database` type parameter. Fix the 13 no-unsafe-* findings by using the generated row types (gate-state.ts first: it decides access) and keep the existing run-time narrowing in mapping.ts. Add a gate check (in db_tests.sh after the reset, or a small stage of its own) that regenerates the types to a temporary file and fails when they differ from the committed file, so a migration cannot land without its types. Prune the suppressions.
Completion conditions: eslint-suppressions.json holds no no-unsafe-* entry; the type-drift check fails when a column is added without regenerating (shown by a test with a fixture or a recorded manual run); all integration suites pass against the stack; gate green with GATE_STRICT=1.

---
# Work Order WO-0127: CI runs the full gate; pin actions and the base image
Action: execute. Owner: Gate engineer. Checker: Spec QC + security review.
In scope: .github/workflows/ci.yml, services/worker/Dockerfile, workflow/gates/**, workflow/gates/repo_lint.baseline.json, services/worker/README.md
Note: findings A2 and A8. No secret is added to GitHub: the local stack's keys are generated inside the job. The owner must agree to the first push that changes the workflow (rule 3).
Instructions: in ci.yml install the Supabase CLI and start the local stack in the job (`supabase start`), set up Python 3.13 with a virtualenv from the three requirements files and export `SPARTA_VENV_PYTHON`, then run `GATE_STRICT=1 bash workflow/gates/gate.sh`. Tests that need the datasets or the demo seed stay skipped by their own flags and must not print SKIPPED at stage level (check that strict mode passes in CI). Pin `actions/checkout`, `actions/setup-node` and every new action to a 40-character commit id with the version in a comment. Pin `python:3.13-slim` by digest in the Dockerfile and note in the worker README how to refresh it. Delete the RL07 and RL08 entries from the repo_lint baseline. Add a job time limit of 30 minutes.
Completion conditions: a CI run on the work-order branch ends with `GATE: PASS (FULL: no stage skipped a check)` (owner pushes the branch; link the run in the notes); repo_lint baseline has no RL07 or RL08 entry; gate green locally with GATE_STRICT=1.

---
# Work Order WO-0128: empty the database lint baseline
Action: execute. Owner: Database maker. Checker: Spec QC.
In scope: supabase/migrations/** (one new migration), supabase/tests/database/**, workflow/gates/db_lint.baseline.json
Note: finding A10. Never edit an applied migration; add a new one.
Instructions: new migration: `alter function ... set search_path = ''` for catalog.colour_family, rgb_hex, rgb_to_lab, set_colour_fields and srgb_lin, after schema-qualifying every name they use (they call each other; 002_colour.test.sql must stay green, and the item insert path through the trigger must be exercised). In `app.confirm_receipt` initialise the two uuid[] variables with explicit casts. For `analytics.run_aggregation` either keep the temporary table and record in the baseline that the finding is a limit of the static check (with the test that proves the function runs), or replace the temporary table with a CTE or an array so the linter can read it; prefer the second if it is under 30 changed lines. Empty the five-name list in 900_catalog_lint.test.sql and delete the fixed entries from db_lint.baseline.json.
Completion conditions: 900_catalog_lint's fifth assertion compares with an empty array; db_lint.baseline.json holds at most the run_aggregation entry, with its reason; pgTAP and the aggregation tests pass; gate green with GATE_STRICT=1.

---
# Work Order WO-0129: linters that need a new development dependency
Action: execute after the product owner approves the dependencies listed here (development only; nothing ships to users). Owner: Gate engineer. Checker: Spec QC.
In scope: package.json, package-lock.json, eslint.config.js, eslint-suppressions.json, services/worker/requirements-dev.txt, workflow/gates/**, docs/LINT-RULES.md
Note: finding A12. Proposed, each pinned to an exact version: `eslint-plugin-react-hooks` (stale closures and effect dependencies; the vendor effects read state that is not in their dependency lists), `eslint-plugin-jsx-a11y` (replaces part of the hand-written a11y source tests), `eslint-plugin-regexp` (slow and ambiguous regular expressions, the class of the R2c legal-renderer finding), and `ruff` in the Python virtualenv (pyflakes, bugbear and bandit rule sets over services, jobs, ml and workflow).
Instructions: add each with its recommended rule set as errors, baseline what exists with `--suppress-all` (ESLint) or a per-file ignore list with a count (ruff), add a gate stage `py_lint` that prints SKIPPED without the virtualenv, add one firing sample per plugin to lint_rules.test.ts, and document the rules in docs/LINT-RULES.md. Do not fix baseline entries in this work order beyond what a rule's autofix does safely.
Completion conditions: lint and py_lint pass; each new plugin has a sample that fires; the baselines are counted in a test and can only shrink; gate green with GATE_STRICT=1.

---
# Work Order WO-0130: hosting hardening the audit confirmed (Release 1, R8)
Action: execute in R8, before anything is hosted. Owner: Backend maker. Checker: security review (Opus) + X-PEN.
In scope: apps/web/next.config.ts, apps/web/proxy.ts, apps/web/lib/supabase/config.ts, apps/web/lib/server/limits.ts, apps/web/app/api/**, supabase/migrations/** (one new migration), their tests
Note: finding A13. These were mentioned in notes and reviews but had no item of their own.
Instructions: (1) a full Content-Security-Policy with a per-request script nonce set in the proxy (default-src 'self'; connect-src the Supabase origin; img-src 'self' blob: and the storage origin; no unsafe-inline for scripts), with the header test extended. (2) Rate limits that hold across instances for the worker, purge and admin routes: count in the database (a small table and one security definer function, like ops.vendor_query_log) or at the host's edge; keep the per-process limiter as the first brake. (3) Fail closed on configuration: a production build (`NODE_ENV=production` and not the local demo script) refuses to start unless `NEXT_PUBLIC_DATA_BACKEND=supabase` and the Supabase variables are set; the demo's no-login mode sets an explicit `SPARTA_DEMO_NO_LOGIN=1` at build time, which the build output test forbids in a hosted build.
Completion conditions: the header test asserts script-src with a nonce and no unsafe-inline; a test shows the limit holding across two handler instances; a build without the backend variable fails with a clear message, and the demo script still starts both modes; gate green with GATE_STRICT=1.

---
## Owner item X-HIST (not a work order)
Decide whether to rewrite the public Git history so the five H&M purchase rows of the D3 notebook leave GitHub, after WO-0124 has cleaned the tree. It needs a forced push of `main` (rule 3: the owner's explicit yes) and everyone with a clone must fetch again. The alternative is to accept the old commits as they are and record that in legal finding 20. Ask the professor whether H&M minds five public rows of the public Kaggle file.
