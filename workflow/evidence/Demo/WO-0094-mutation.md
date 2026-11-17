# WO-0094 mutation proof (Visual craft agent, MAKER)

Method: a scratch copy of apps/web (outside the repo, rsync without node_modules and .next) is mutated by one text edit, and `design.test.ts` plus `contrast.test.ts` are run against it with `DESIGN_ROOT` pointing at the copy (the same harness as WO-0093). A mutant is KILLED when at least one test fails. The "Failing source test" column names a test that checks the real files (not one of the in-memory mutant rows), so each kill is by a rule, not by a mutant row that happens to throw. Total: 17 mutants, 17 killed, 0 survived.

| Id | Mutation | Result | Failing tests | Failing source test |
|---|---|---|---|---|
| X09 | button.linklike min-height 30px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X10 | .foot a min-height 20px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X11 | tile focus outline-offset 2px (ring outside the box) | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| X12 | base :focus-visible outline-offset 40px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X13 | tile focus rule deleted | KILLED | 4 | the stylesheet follows the design direction passes every rule of cssProblems |
| X14 | .item .title min-height 20px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X15 | invalid border 1px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X16 | wordmark 14px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X17 | line length 90ch | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X18 | Sign out blue again | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X19 | auth links not uppercase | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X20 | nav row may orphan (justify flex-start) | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| X21 | icon rounded again (rx=14) | KILLED | 1 | the tab icon and the web manifest follow the design (WO-0094) icon.svg is a black square with a white S: no co |
| X22 | icon back to the old green | KILLED | 2 | the tab icon and the web manifest follow the design (WO-0094) icon.svg is a black square with a white S: no co |
| X23 | manifest theme_color old green | KILLED | 2 | the tab icon and the web manifest follow the design (WO-0094) the manifest is black on white and names the ico |
| X24 | auth link row loses its label class | KILLED | 1 | the header carries the wordmark and the DEMO label (Release 0) the sign-in link row carries the label style (t |
| X25 | tile focus ring colour is the theme blue | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |

Named by the work order: X09 (button.linklike min-height 30px) and X10 (.foot a min-height 20px) are killed by `touch-target-linklike` and `touch-target-foot`; the outline-offset mutants are X11 (tile ring moved outside the white box), X12 (offset 40px on the base focus rule) and X13 (tile focus rule deleted), killed by `focus-on-tile-inside-box` and `focus-offset-out-of-bounds`.

In-memory mutants (inside design.test.ts, no copy needed): the 20 of WO-0093 rewritten to anchor on the selector (`inRule(css, selector, from, to)` replaces text inside the one rule and throws when the rule or the text is missing, so an unrelated edit to the stylesheet can no longer produce a false kill), plus 14 new ones (X09 to X20 and two tile-ring colour mutants): 34 in all, each asserted to change the file and to raise the named problem id.

Survivors found during the run: none. One real defect was found by the browser, not by a mutant: the first `[aria-invalid='true']` rule lost to `input[type=...]` on specificity (computed border 1px); the selector is now `input[aria-invalid='true'], select[aria-invalid='true']` and the computed border is 2px.
