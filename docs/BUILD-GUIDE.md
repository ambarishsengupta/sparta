# Build guide: how one work order is built

| Field | Value |
| --- | --- |
| Document | How a maker builds a work order and how a checker checks it (internal; for the agents and the team) |
| Version | 1.0, 2026-11-16 |
| Owner | Ambarish Sengupta (product owner) |
| Written by | The session model (Fable 5.2) on the product owner's instruction of 2026-11-16, as work order WO-0149 |
| Basis | The run of 15 and 16 November 2026: WO-0128, WO-0125 and WO-0126 were built by Sonnet makers and checked by Opus; WO-0127, WO-0149 and two parts of WO-0130 were built directly by the session model |
| Companions | `docs/MVP-AGENT-WORKFLOW.md` (who does what, gates, standing rules), `docs/LINT-RULES.md` (what the lint stops) |

## 1. What this is

The workflow document says who does what and which gates a work order passes. This guide says how to do the building itself, step by step, and lists the mistakes this project has already made once, each with the habit that avoids it and the check that now catches it.

Where this guide and the workflow document disagree, the workflow document wins. Where a work order and this guide disagree, the work order wins and the difference goes into the report.

Every habit in section 3 comes from a real finding. If a habit has no incident behind it, it does not belong here.

## 2. The loop for one work order

### 2.1 Read the work order as a contract

1. Open the work order's section in `workflow/work-orders/`. Read the instructions, the note and the completion conditions in full. The text there is the specification; a brief from the orchestrator only adds rules.
2. Write down the completion conditions as a list of commands and the result each must give. A condition that is not a command is a question for the orchestrator before the build, not after.
3. Read the documents the work order traces to, and the conventions in `workflow/work-orders/R0.md`.

### 2.2 Check the work order before the code

A fault in the work order costs most when a gate finds it after the build. Four checks, each under a minute:

1. **The scope line can be read.** `WO_ID=WO-nnnn bash workflow/gates/scope_check.sh --parse-only workflow/work-orders/<file>.md` must print the list and exit 0. An item with a bracket or a space in it is a parse error. Commentary belongs on the `Note:` line. A route-group folder such as `app/(auth)/` is written with `?` for each bracket: `apps/web/app/?auth?/**`.
2. **Every file the instructions name is inside the scope line.** If an instruction says "export one helper from lib/vendor/insights.ts", that path must match an item.
3. **The condition can be met from inside the scope.** A condition such as "this grep prints nothing" fails if a file outside the scope, or the work order file itself, holds the searched text.
4. **The base is where the state file says it is.** `git log --oneline -1 release/<branch>` against `workflow/STATE.md`. Other sessions of the owner can merge into the same branch; build on what is there and record it.

If a check fails, the maker does not repair the work order. The maker reports it, and the orchestrator changes the line in its own commit, with the reason on the `Note:` line.

### 2.3 Read before writing

1. Read every file you will change, and its tests.
2. Find the nearest existing pattern and follow it: how the neighbouring module names things, handles errors, and is tested. A second way of doing the same thing is a finding in review.
3. Read the rules that guard the area: `docs/LINT-RULES.md`, the source scans (`apps/web/test-support/network-scan.ts`, the import scan in `apps/web/components/outfits/outfits.test.ts`), and the gate tests that pin a script's shape (`workflow/gates/*.test.ts`).
4. For anything that must run on another machine (CI, a fresh clone, a container): list what this machine has that the other will not. Git-ignored files, `workflow/local.env`, the dataset folders, a tool's installed version.

### 2.4 Build the smallest change that meets the specification

1. Change what the work order asks, in the files it names. A better idea goes into the report.
2. Prefer the change that leaves run-time behaviour alone. `alter function ... set search_path` instead of re-creating five functions kept their bodies, owners and grants byte for byte (WO-0128).
3. When a fix needs a file outside the scope, stop that part, finish the rest, and say exactly which file and why. Do not edit it.
4. Never get to green by adding a baseline entry, an inline suppression, a cast, or a skipped test (workflow rule 12).

### 2.5 Prove each change, then try to break the proof

1. Every new guard gets a test: a type check, a rejection handler, an exit-status check, a refusal.
2. **Break-check every new test.** Remove the guard, run the test, see it fail, restore the guard. A test that still passes proves nothing. Record the result in the report as one line per check.
3. Compare with the real system, not with a summary of it. A parser for a stored report is read against the SQL that writes the report and run against a report built in a rolled-back transaction.
4. For a change that must not alter behaviour, show it: compile the old and the new file and compare the output, or compare the catalog rows before and after.

### 2.6 Run the checks for what you touched

Cheapest first. Stop and fix at the first failure.

| You changed | Run |
| --- | --- |
| Any TypeScript | `npx eslint .`, `npm run typecheck`, then `npx vitest run apps/web` **in full**, not a sub-folder |
| A migration or a database test | `supabase db reset`, `supabase test db`, `bash workflow/gates/db_lint.sh`, `bash workflow/gates/types_drift.sh` (regenerate with `bash supabase/scripts/gen-types.sh` if the schema changed) |
| A gate script or a lint rule | `npx vitest run workflow/gates`, `python3 workflow/gates/repo_lint.py --selftest`, `python3 workflow/gates/repo_lint.py` |
| A work order file | `python3 workflow/gates/repo_lint.py` (RL13 reads every scope line) |
| Anything | `WO_ID=WO-nnnn bash workflow/gates/scope_check.sh HEAD workflow/work-orders/<file>.md`, `bash workflow/gates/secret_scan.sh` |

The two vendor suites and the live seed checks need the demo insights. Run them the way `workflow/gates/strict_tests.sh` does (seed, run, remove), and say so in the report.

These checks are the maker's quick loop. They are not the gate. Before a merge the orchestrator runs `GATE_STRICT=1 bash workflow/gates/gate.sh`, and its last line must be `GATE: PASS (FULL: no stage skipped a check)`.

### 2.7 Report

Findings first, in plain words:

1. What is done, and what is not.
2. Files changed, with line counts. Say so when the diff passes the size flag.
3. Each command with its real result: counts of passed, failed and skipped, and which suites skipped and why.
4. Each break-check and what it showed.
5. **What was not verified.** "Nothing was checked in a browser" is a normal and useful sentence.
6. Anything surprising, and follow-ups for another work order.

Leave nothing running. Leave the work uncommitted for the orchestrator unless the brief says otherwise.

### 2.8 What the orchestrator does with it

One independent check, one fix loop if needed (at most two), a re-check of the fixes, the strict gate, then: restore `workflow/goals`, commit the named paths, fast-forward the integration branch in the primary checkout, mark the item on the board, sweep, update `workflow/STATE.md`. The exact commands are in `workflow/STATE.md` under "HOW TO RUN ONE WORK ORDER".

## 3. Habits, each with the incident behind it

| Habit | What happened | What catches it now |
| --- | --- | --- |
| **Do not weaken a check to remove a workaround.** When code was written around a scan, fix the code and make the scan more exact, never narrower. List what the old check caught and show the new one still catches each. | WO-0125 replaced a whole-word network scan with one that read call expressions only. It no longer saw `const f = globalThis.fetch`, and in the three files allowed to use the network nothing else did either. The check failed the work order. | The scan test lists each alias case, in an ordinary file and in an allowed one |
| **Check the exit status of every tool you wrap.** A script that captures a tool's output must fail when the tool fails. | `gen-types.sh` wrote a truncated types file and reported success when the generator died part-way (WO-0126). `db_lint.sh` threw the linter's errors away and read "no output" as "no finding", so a crashed linter passed (found by the WO-0128 check). | `repo_lint` RL14; `workflow/gates/db_lint.test.ts`; the truncation cases in `types_drift.test.ts` |
| **Break-check every new test.** | Three guards shipped with tests that did not test them: the `typeof` checks in `mapping.ts` and the after-unmount guard of the vendor pages (WO-0125), and one field check of the report parser (WO-0126). The checker removed each guard and the suite still passed. | The checker's mutation table; section 2.5 |
| **Narrow, do not cast.** A value from the database is typed by the generated types or checked at run time. `as unknown as` and an untyped client both switch the checking off. | WO-0126 left one `as unknown as Rpc` that discarded the function-name typing, and three modules on an untyped client where a renamed column still compiles. | ESLint `no-restricted-syntax` (untyped `SupabaseClient`), `no-unsafe-*`; the exception list in `eslint.config.js` that may only shrink |
| **Do not trust a generated type further than you checked it.** | `supabase gen types` types the columns of a table-returning function as non-null, and nullable function arguments as required, where the SQL returns and accepts null (`analytics.gaps`, `take_down_source`). | Keep the hand-written row types and the run-time narrowing for function results |
| **Make the scope line a list a script can read.** | Three work orders had a scope line `scope_check.sh` cannot parse ("(one new migration)", "app/(auth)/..."). WO-0128 passed its check and every other gate stage, then failed at the last stage for this. Eight more such lines sat in work orders not yet started. | `repo_lint` RL13 |
| **Make sure the scope holds every file the instructions name.** | WO-0125 told the maker to export a helper from a file that was not in scope. WO-0126's typed client broke the typecheck in a file outside its scope. | Section 2.2; the maker reports, the orchestrator amends the line with a note |
| **Look values up; never write them from memory.** Commit ids, digests, versions and action inputs are read from the source at the time of writing. | WO-0127 pinned four actions and one base image. The ids came from the GitHub and Docker Hub APIs, and the image digest is the one the worker tests ran with. | `repo_lint` RL07 and RL08 check the shape; only looking up makes the value right |
| **Ask what a fresh machine lacks.** | The strict gate cannot pass on a clean checkout as it stood: the two role password helpers are git-ignored, one goal check reads `workflow/local.env`, and one live check printed SKIPPED without the H&M folder (WO-0127). | `workflow/gates/ci_role_password_scripts.sh` and its test; the CI workflow test |
| **A comment says what the code does.** | A new test's header claimed a "hostile search_path" where the test used an empty one (WO-0128). A script's comment said a status "is lost" where it was simply not checked (WO-0126). | Review |
| **Test support lives in `apps/web/test-support/`.** | A hook stand-in used only by tests was put in `components/` because that was the folder in scope (WO-0125). | Moved by WO-0149; say in the report when the scope forces a wrong home |
| **Check the branch tip before cutting and before merging.** | Another session of the owner merged a course deliverable into the integration branch while this run was between work orders. | Section 2.2, check 4; the note in `workflow/STATE.md` |
| **When a tool reports an error, look at the state before running it again.** | `gh issue close` returned an error twice after the issue had in fact closed; the board script stopped before writing the item list. The script is safe to run twice, and the second run finished the job. | Read the state (`gh issue view`), then re-run an idempotent script |
| **Run the real thing once.** A unit test of your own function proves the function, not that the tool calls it the way you think. | WO-0130 made `next.config.ts` refuse a production build without accounts. Its nine unit tests passed, and then every real build was refused: Next calls the config function with its own second argument, which the first version took for the environment. One real build showed it in a minute. | A test for exactly that call; the `web_containment` stage builds for real |
| **Keep a second copy from drifting.** When the same text must exist in two places, one place generates or tests the other. | The CI job needs the git-ignored password helpers, so their text now also lives in a committed generator. | The test compares the generator's output with the developer's copies byte for byte |

## 4. For the checker

1. Judge against the work order as committed on the base branch, and against the live system. Treat every sentence of the maker's report as a claim to test.
2. Never edit. For a mutation, work in a copy outside the repository, or change one file, restore it at once and compare it byte for byte.
3. Check scope and rule 12 first: every path in scope, suppressions only removed, no skipped or focused test, no assertion weakened.
4. For "no behaviour change", compare what is emitted or stored, not the diff.
5. Try 4 to 6 small mutations and report each as caught or survived. A survivor is a finding.
6. First line of the report: `VERDICT: PASS` or `VERDICT: FAIL`. Then findings, most serious first, each marked BLOCKER, MINOR or NOTE, each with a command result or a quoted line. Then real totals, and what was not verified.
7. Fail only on evidence: a command result or a quoted line of the specification.

## 5. When a day's rules differ

On 2026-11-16 the product owner set the Sonnet and Opus rule and the gate run aside for one day. Work built that way is committed on its own branch and is not merged. Before it merges, one strict gate run on the top branch must end with the FULL line, and the state file says which work orders had no independent check. A one-day instruction is written into `workflow/STATE.md` with its date and its end; it never changes this guide or the workflow document.

## 6. Changing this guide

A new habit needs an incident: the work order, what happened, and the check that now catches it. The retro agent proposes, the workflow editor applies, and the workflow approver approves (gate G8), as for the workflow document. Where a script can check the habit, add the rule in the same work order (`docs/LINT-RULES.md`, "Adding a rule").
