# Lint rules

Added by WO-0123 after the audit of 2026-11-15 (`workflow/work-orders/Audit.md`). Workflow rule 12 makes them binding.
WO-0149 (2026-11-16) added three rules from the run of 15 and 16 November: the untyped database client, work-order scope lines (RL13) and gate scripts that hide a tool's errors (RL14). `docs/BUILD-GUIDE.md` tells the story behind each.

## How it works

- **Every rule is an error.** There are no warnings.
- **No escape hatch in the code.** Inline `eslint-disable` comments are ignored, `@ts-ignore` is an error, and skipped or focused tests are errors.
- **Exceptions are listed in three baseline files and nowhere else.** Each entry was a violation that existed when its rule was added, and each has a work order that removes it. A new violation fails the gate. An entry that is no longer needed also fails the gate, so the lists can only shrink.

| Baseline file | Read by | Shrink it with |
| --- | --- | --- |
| `eslint-suppressions.json` | `npm run lint` | `npx eslint . --prune-suppressions` after a fix |
| `workflow/gates/repo_lint.baseline.json` | `npm run lint:repo` | delete the entry |
| `workflow/gates/db_lint.baseline.json` | `bash workflow/gates/db_lint.sh` | delete the entry |

## Where the rules are

| What is checked | File | Run it |
| --- | --- | --- |
| TypeScript and React | `eslint.config.js` | `npm run lint` |
| Proof that each ESLint rule fires | `workflow/gates/lint_rules.test.ts` | `npx vitest run workflow/gates/lint_rules.test.ts` |
| Tracked files, H&M rows, Python, requirements, Dockerfile, workflows, shell, SQL text, work items, notebooks, work-order scope lines, gate scripts | `workflow/gates/repo_lint.py` | `npm run lint:repo` (and `--selftest`) |
| The live database catalog | `supabase/tests/database/900_catalog_lint.test.sql` | `supabase test db` |
| plpgsql functions | `workflow/gates/db_lint.sh` | `bash workflow/gates/db_lint.sh` |
| That the committed database types match the database | `workflow/gates/types_drift.sh` | `bash workflow/gates/types_drift.sh` |
| That nothing was skipped | `workflow/gates/gate.sh` | `GATE_STRICT=1 bash workflow/gates/gate.sh` |

## ESLint rules that are specific to Sparta

| Rule | Where | What it stops |
| --- | --- | --- |
| `no-restricted-syntax` (process.env) | web app | Reading the environment outside the three configuration modules, the secret-key module and the worker route; reading a non-public variable anywhere else; computed `process.env[...]` |
| `no-restricted-syntax` (HTML) | web app | `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write` |
| `no-restricted-syntax` (tests) | everywhere | `it.only`, `describe.skip`, `it.todo` |
| `no-restricted-imports` | web app | Importing `lib/server` outside route handlers; building a Supabase client outside the four factory modules |
| `no-restricted-imports`, `no-restricted-globals` | engine packages | Node modules, the app, the network, `process` (the engine runs in the browser) |
| `no-restricted-globals` | web app | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` outside the three files that may call the network |
| `no-floating-promises`, `no-misused-promises`, `return-await`, `await-thenable` | app and packages | A promise whose failure nobody handles |
| `no-unsafe-*` (five rules) | app and packages, not tests | Using a value of type `any` (a database row, parsed JSON) before narrowing it |
| `no-restricted-syntax` (untyped client) | web app, not tests | Naming `SupabaseClient` without `<Database>`: through an untyped client every row is an unchecked value and a renamed column still compiles (audit finding A6). Three modules are still excepted by a list in `eslint.config.js` that `lint_rules.test.ts` pins; WO-0150 empties it |
| `no-console`, `no-alert`, `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url` | app (first two also in packages) | Console output, native dialogs, running text as code |

## Repository lint rules added after WO-0123

| Rule | Reads | What it stops | Why it exists |
| --- | --- | --- | --- |
| RL13 scope-lines | `workflow/work-orders/*.md` | An `In scope:` item with a bracket, a space, or nothing in it | `scope_check.sh` cannot parse such a line, and the gate of that work order fails at its last stage. It happened to WO-0128, and ten more items in eight lines were waiting in work orders not yet started. Put commentary on the `Note:` line; write each bracket of a route-group folder as `?` (`apps/web/app/?auth?/**`) |
| RL14 gate-tool-errors | `workflow/gates/*.sh` | `x="$(tool ... 2>/dev/null)"` on a line that does not use the exit status (`\|\|`, `$?`, or an `if`) | A tool that crashed and a tool that found nothing both print nothing. `db_lint.sh` passed on a broken linter this way. Keep the error output in a file and fail on a non-zero status |

## Adding a rule

1. Add the rule as an error.
2. Add a bad sample that makes it fire (`lint_rules.test.ts`, or `SAMPLES` in `repo_lint.py`).
3. If existing code breaks it, fix the code. If the fix is too large for the work order, record the existing violations in the baseline and name the work order that will remove them.
4. Never widen an allowed-files list in `eslint.config.js` without the solution architect's review: those lists are the security boundary.
5. A rule that cannot be checked without false alarms is not added. The habit goes into `docs/BUILD-GUIDE.md` instead, with the incident behind it. A rule that people must work around teaches working around rules.
