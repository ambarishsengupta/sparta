# Lint rules

Added by WO-0123 after the audit of 2026-11-15 (`workflow/work-orders/Audit.md`). Workflow rule 12 makes them binding.

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
| Tracked files, H&M rows, Python, requirements, Dockerfile, workflows, shell, SQL text, work items, notebooks | `workflow/gates/repo_lint.py` | `npm run lint:repo` (and `--selftest`) |
| The live database catalog | `supabase/tests/database/900_catalog_lint.test.sql` | `supabase test db` |
| plpgsql functions | `workflow/gates/db_lint.sh` | `bash workflow/gates/db_lint.sh` |
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
| `no-console`, `no-alert`, `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url` | app (first two also in packages) | Console output, native dialogs, running text as code |

## Adding a rule

1. Add the rule as an error.
2. Add a bad sample that makes it fire (`lint_rules.test.ts`, or `SAMPLES` in `repo_lint.py`).
3. If existing code breaks it, fix the code. If the fix is too large for the work order, record the existing violations in the baseline and name the work order that will remove them.
4. Never widen an allowed-files list in `eslint.config.js` without the solution architect's review: those lists are the security boundary.
