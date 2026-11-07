# WO-0093 notes: restyle the whole app (Visual craft agent, MAKER)

Branch release/R6. No commits, no new dependency. Style only: white ground, black text, IBM Plex Mono, uppercase 12px labels, tight uppercase headings, hairline rules, square corners, one electric-blue accent (#1b2bff light, #8c96ff on a dark preference), boxed white buttons over flat tinted tiles. No brand name, logo, trademark symbol, stripes, quotation-mark styling, photographs, copy or proprietary font.

## What changed
- `apps/web/app/globals.css`: rewritten as the design system. Tokens in the two `:root` blocks (colour, type scale, 4px spacing scale, hairline, focus ring, 44px target, radius 0), `@font-face` for IBM Plex Mono 400 and 500, header (wordmark, DEMO tag, nav, sign-out), buttons (secondary base, black primary, boxed overlay variant over a tile), inputs, selects, square checkboxes, fieldsets, details, notices and errors (text plus a boxed "!" mark, never colour alone), hairline rows and tables, item tiles, outfit cards, photo previews, reduced-motion block. All token names the existing tests read are kept (bg, surface, text, muted, border, accent, on-accent, link, error, focus).
- `apps/web/components/outfits/outfits.module.css`: same system (outfit cards boxed in a hairline, square colour dots, accent-filled pressed occasion button, blue meter).
- `apps/web/components/Nav.tsx`: one added element, the visible DEMO tag after the wordmark. `apps/web/app/layout.tsx`: theme colours per scheme (#ffffff and #000000) instead of the old green.
- `WardrobeList.tsx` and `OutfitsView.tsx`: class names only (`card item`, `list tiles`, `list cards`, outfit card no longer also `card`). No behaviour, copy, route or data change.
- `apps/web/components/fonts/`: the two latin woff2 files, `OFL.txt` (SIL OFL 1.1, copied unchanged) and `README.md` (name, version 5.3.0 of @fontsource/ibm-plex-mono, licence, source, hashes, how obtained, fallback stack).
- Tests added: `components/design-rules.ts` (pure checks), `components/design.test.ts` (31 source tests: every stylesheet rule, module styles, inline styles, font files and licence, brand/trademark/proprietary-font scan of every text file in apps/web, DEMO label, 20 in-memory mutants). `components/contrast.test.ts` extended, never loosened: new pairs (accent, on-ink on ink, black on paper, disabled, muted/text/link on hairline, focus), rule and focus-ring 3:1, accent is blue, light theme is #ffffff/#000000.

## Deviations (reported, each needs a decision or is a known limit)
1. Fonts are NOT in `apps/web/public/fonts/`. A folder in `public/` fails the existing `proxy.test.ts` ("/fonts is served without a check" and the exact list of public files); `proxy.ts` and `proxy.test.ts` are outside this work order's scope, and the proxy would also redirect signed-out visitors' font requests to sign-in. The files live in `apps/web/components/fonts/` (in scope) and `globals.css` references them by relative URL, so Next bundles them as `/_next/static/media/*.woff2` (self-hosted, excluded from the proxy). If the owner wants `public/fonts/`, the scope must be widened to proxy.ts and proxy.test.ts first.
2. A dark preference (prefers-color-scheme: dark) is kept, as black ground with white text and a lighter blue, because the existing contrast tests and users on a dark setting expect it. The light theme is exactly the brief. Screenshots are light except one dark one.
3. Errors are black text with a boxed "!" and weight 500 (the brief allows one accent only, so no red); the `--error` token is therefore black/white.
4. `public/icon.svg` and `public/manifest.webmanifest` (old green icon and theme colours) are outside the scope list and were not touched; the tab icon is still the old green rounded square. Needs a follow-up work order.
5. "Icon links right" in the header: the links are uppercase text links (no icons were drawn, to avoid inventing marks). On a 375px screen the nav wraps to a second row under the wordmark.
6. Tiles use the item colour as a flat tinted square (R6b category illustrations do not exist yet), as the brief allows.
7. The page `main` is full width with a 16px/24px gutter (header and content share the same left edge); text pages are limited to 46rem for readability.
8. Counted lines: see the report (the stylesheet is a full rewrite, so the total is near the 500-line limit).

## Real-browser evidence (workflow/evidence/Demo/screenshots/)
Built with `next build --webpack` and run with `next start -p 3417`, keys read from `supabase status -o json` into process env only (never written, never printed). Throwaway users created through test-support (`provisionUser`, `makeReady`) with `@example.test` addresses and random passwords; all deleted afterwards (0 left in auth.users and ops.invitations), server stopped, apps/web/.next deleted, no .env.local created.
- Desktop 1280: 02 not-available, 03 sign-in with errors (focus ring and error marks), 04 wardrobe tiles with boxed overlay buttons, 05 add item form, 06 settings, 07 outfits, 08 wardrobe unlock, 09 about, 10 privacy table, 11 wardrobe on a dark preference.
- Mobile 375: 01 wardrobe, 02 outfits, 03 sign-in, 04 accept terms, 05 pilot notice, 06 onboarding, 07 wardrobe tiles with overlays (tall viewport).
- Browser checks at 375px: document scrollWidth 375 of 375 (no horizontal scroll), no element past the right edge, smallest rendered text 12px, no rendered border radius on buttons, inputs, selects or links, IBM Plex Mono loaded (document.fonts.check true).
- Defects found in the browser and fixed before the final build: tile grid placing the overlay button in a second column; overlay button hanging below the tile; tile rows stretching so overlays sat at different heights; wardrobe heading buttons touching the filter rule; sign-out spacing on the not-available page.
- Screens not shot: item edit page, leave page, goodbye, check-your-email, reset, photo flow (they use the same components and classes as the screens above; shell and a11y source tests cover their markup).

## Tests and proofs
- Contrast and design tests: see the report numbers. Mutation proof: `WO-0093-mutation.md` (30 scratch-copy mutants, all killed, plus 20 in-memory mutants inside design.test.ts).
- Axe-style check: the repo's existing regex a11y checks (components/*/a11y.test.ts via test-support/a11y.ts) all pass unchanged; there is no axe dependency and none was added.
- Not done by this agent: the Design critic's scoring, and any change outside In scope.

## Gate
`WO_ID=WO-0093 GATE_BASE=$(git rev-parse HEAD) GATE_WO=workflow/work-orders/Demo.md bash workflow/gates/gate.sh`: GATE: PASS (clean_dupes, typecheck, db_tests, worker_tests, test, lint, web_containment, manifest_check, secret_scan, release_map, check_goals, scope_check all PASS). Vitest: 89 files, 2090 passed, 3 skipped. design.test.ts and contrast.test.ts together: 82 tests. A first gate run failed scope_check only because my mutation harness left an untracked `.vitest/json/output.json`; it was deleted and the gate re-run.
Counted lines (adds plus deletes, tracked): 186 + 73 = 259; new source files: design-rules.ts 161, design.test.ts 120, fonts/README.md 16 (OFL.txt 93 lines is licence text, woff2 binary); total about 556, above the 500-line limit because globals.css is a full rewrite.
