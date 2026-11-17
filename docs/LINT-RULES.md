# Lint rules

Added by WO-0123 after the audit of 2026-11-15 (`workflow/work-orders/Audit.md`). Workflow rule 12 makes them binding.
WO-0149 (2026-11-16) added three rules from the run of 15 and 16 November: the untyped database client, work-order scope lines (RL13) and gate scripts that hide a tool's errors (RL14). `docs/BUILD-GUIDE.md` tells the story behind each.
WO-0129 (2026-11-17) added the linters that needed a new development dependency (audit finding A12): React hooks mistakes, slow regular expressions and, for Python, ruff. The product owner approved the four dependencies on 2026-11-16, each pinned to an exact version.

## How it works

- **Every rule is an error.** There are no warnings.
- **No escape hatch in the code.** Inline `eslint-disable` comments are ignored, `@ts-ignore` is an error, and skipped or focused tests are errors.
- **Exceptions are listed in three baseline files and nowhere else.** Each entry was a violation that existed when its rule was added, and each has a work order that removes it. A new violation fails the gate. An entry that is no longer needed also fails the gate, so the lists can only shrink.

| Baseline file | Read by | Shrink it with |
| --- | --- | --- |
| `eslint-suppressions.json` | `npm run lint` | `npx eslint . --prune-suppressions` after a fix |
| `workflow/gates/repo_lint.baseline.json` | `npm run lint:repo` | delete the entry |
| `workflow/gates/db_lint.baseline.json` | `bash workflow/gates/db_lint.sh` | delete the entry |
| `[lint.per-file-ignores]` in `workflow/gates/ruff.toml` | `bash workflow/gates/py_lint.sh` | fix the finding, delete its code from the file's line (and the line when it is empty), lower the number in `workflow/gates/py_lint.test.ts` |

## Where the rules are

| What is checked | File | Run it |
| --- | --- | --- |
| TypeScript and React | `eslint.config.js` | `npm run lint` |
| Proof that each ESLint rule fires | `workflow/gates/lint_rules.test.ts` | `npx vitest run workflow/gates/lint_rules.test.ts` |
| Tracked files, H&M rows, Python, requirements, Dockerfile, workflows, shell, SQL text, work items, notebooks, work-order scope lines, gate scripts | `workflow/gates/repo_lint.py` | `npm run lint:repo` (and `--selftest`) |
| The live database catalog | `supabase/tests/database/900_catalog_lint.test.sql` | `supabase test db` |
| plpgsql functions | `workflow/gates/db_lint.sh` | `bash workflow/gates/db_lint.sh` |
| Python (pyflakes, bugbear, bandit) | `workflow/gates/ruff.toml` | `bash workflow/gates/py_lint.sh` |
| Proof that ruff flags a bad sample, and the count of the known findings | `workflow/gates/py_lint.test.ts` | `npx vitest run workflow/gates/py_lint.test.ts` |
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

## Linters added by WO-0129 (new development dependencies)

| Plugin or tool (exact version) | Rule set | Where | What it stops |
| --- | --- | --- | --- |
| `eslint-plugin-react-hooks` 7.1.1 | the 17 rules of `recommended-latest`, all as errors (`exhaustive-deps`, `rules-of-hooks`, `set-state-in-effect`, `refs`, `purity`, `immutability` and the other React compiler rules) | web app, not tests | A stale closure, an effect that reads state missing from its dependency list, state set inside an effect, a ref read while rendering, a hook called conditionally |
| `eslint-plugin-regexp` 3.3.3 | every `regexp/` rule of `flat/recommended`, all as errors (for example `no-super-linear-backtracking`, `no-dupe-disjunctions`, `no-contradiction-with-assertion`, `no-unused-capturing-group`, `prefer-d`, `prefer-w`) | every JavaScript and TypeScript file | A slow regular expression (the class of the R2c legal-renderer finding), an ambiguous or redundant one. The core ESLint rules that the plugin's set also switches on (for example `prefer-regex-literals`) are not turned on: only the plugin's own rules are |
| `eslint-plugin-jsx-a11y` 6.10.2 | not installed | | npm refuses it next to ESLint 10.14.0: its peer range is ESLint 3 to 9 (`ERESOLVE`). It was not forced in (no `--force`, `--legacy-peer-deps` or `overrides`). The hand-written accessibility source tests stay in place; the product owner decides what to do |
| `ruff` 0.17.5 (`services/worker/requirements-dev.txt`) | pyflakes `F`, flake8-bugbear `B`, flake8-bandit `S` | `services`, `jobs`, `ml`, `workflow` (stage `py_lint` of the gate) | An unused import or name, a mutable default argument, `assert` in shipped code, `subprocess` with a shell, `eval`, hard-coded passwords, SQL built from strings, unsafe XML parsing |

How the baselines work:

- **ESLint.** The findings of the two plugins that existed on 2026-11-17 are in `eslint-suppressions.json` (ESLint's own `--suppress-all`): 177 findings in 68 files. `lint_rules.test.ts` counts them per rule with exact numbers and allows only these two plugins' rules in the file. ESLint fails on a new finding and on an entry no longer needed (`npx eslint . --prune-suppressions` removes entries after a fix). The sample for each plugin in `lint_rules.test.ts` must fire.
- **ruff.** The findings that existed on 2026-11-17 (411 in 31 files, mostly `S101` `assert` in tests) are listed per file in `[lint.per-file-ignores]` of `workflow/gates/ruff.toml`. `py_lint.test.ts` re-runs ruff without that list and compares the count per file and per rule code with exact numbers, so a new finding of an already listed code in a listed file fails the test, a fixed finding cannot be traded for a new one of another listed code, and a fixed one fails the test until its number is lowered. `# noqa` comments are ignored (`--ignore-noqa`); a test has ruff write its own noqa comments into a sample and checks that the stage still reports every finding.
- **Without the virtualenv** `py_lint.sh` prints `SKIPPED` and exits 0, so a `GATE_STRICT=1` run fails the stage, and the ruff tests in `py_lint.test.ts` fail with the reason (they never skip). A missing ruff, a crash or a new finding fails the stage.
- **No autofix.** `eslint --fix`, `ruff --fix` and `ruff format` are not used to clear a baseline inside a work order that does not own the files.

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
