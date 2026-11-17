# WO-0093 mutation proof (design system)

Method: scratch harness OUTSIDE the repository (session scratchpad, not committed). For each mutant a fresh copy of apps/web/app and apps/web/components is made in a scratch directory, ONE substitution is applied to one file in that copy, and the real source tests run against the copy with DESIGN_ROOT pointing at it: `apps/web/components/design.test.ts` and `apps/web/components/contrast.test.ts` (both read their files from DESIGN_ROOT when it is set, otherwise from the app). A mutant is KILLED when vitest exits non-zero. The repository files were never changed by a mutant.

Baseline (no mutation): exit 0, 0 failing tests.

Result: 30 mutants, 30 killed, 0 survived.

| Mutant | Change | Result | Failing tests | First failing test |
| --- | --- | --- | --- | --- |
| M01 | accent too light (#1b2bff to #9fa8ff) | KILLED | 4 | colour contrast, light theme on-accent on accent is at least 4.5:1 |
| M02 | muted grey too light (#595959 to #aaaaaa) | KILLED | 3 | colour contrast, light theme muted on bg is at least 4.5:1 |
| M03 | dark theme accent too dark on black | KILLED | 3 | colour contrast, dark theme on-accent on accent is at least 4.5:1 |
| M04 | button fill and text the same (on-ink = ink) | KILLED | 1 | colour contrast, light theme on-ink on ink is at least 4.5:1 |
| M05 | focus ring removed (outline: none) | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M06 | focus ring 1px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M07 | label text 11px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M08 | text below 12px in a rule (0.7rem) | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M09 | radius token 6px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M10 | radius 8px set on the card component | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| M11 | radius 4px in the outfit module (meter) | KILLED | 1 | the stylesheet follows the design direction the outfit styles follow the same rules (no radius, shadow, gradient, small text or raw colour) |
| M12 | forbidden font family in the font token | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| M13 | forbidden family in a font shorthand | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M14 | diagonal stripe gradient | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M15 | box shadow on cards | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| M16 | raw hex colour written into a rule | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| M17 | justified text | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M18 | touch target 40px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M19 | body text 16px | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M20 | headings not uppercase | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M21 | reduced-motion rule deleted | KILLED | 2 | the stylesheet follows the design direction passes every rule of cssProblems |
| M22 | quotation-mark word styling | KILLED | 1 | the stylesheet follows the design direction passes every rule of cssProblems |
| M23 | brand name in a component comment | KILLED | 1 | no brand, trademark symbol or proprietary font of the reference appears anywhere in apps/web scans every source, style, markup and note file |
| M24 | trademark symbol in page copy | KILLED | 1 | no brand, trademark symbol or proprietary font of the reference appears anywhere in apps/web scans every source, style, markup and note file |
| M25 | proprietary font name in a stylesheet comment | KILLED | 1 | no brand, trademark symbol or proprietary font of the reference appears anywhere in apps/web scans every source, style, markup and note file |
| M26 | inline radius in a component | KILLED | 1 | the stylesheet follows the design direction no component draws a radius, shadow, font or raw background of its own |
| M27 | DEMO label removed from the header | KILLED | 1 | the header carries the wordmark and the DEMO label (Release 0) the Nav source in this tree carries the label (the scratch-copy harness reads it from D |
| M28 | font licence text removed | KILLED | 1 | the stylesheet follows the design direction the font files named by the stylesheet exist and the licence and provenance notes sit with them |
| M29 | remote font file | KILLED | 3 | the stylesheet follows the design direction passes every rule of cssProblems |
| M30 | module style uses a token that does not exist | KILLED | 1 | the stylesheet follows the design direction the module styles use only tokens that the stylesheet defines |

One survivor was found and fixed during the run: the first version of the DEMO-label test rendered the real Nav component, so removing the label from the scratch copy (M27) survived; the test now also reads components/Nav.tsx from DESIGN_ROOT and M27 is killed.

The same source tests also hold 20 further in-memory mutants of globals.css (design.test.ts, "each mutant of the design rules is caught"), so the rules are checked by the normal `npm test` and not only by this harness.
