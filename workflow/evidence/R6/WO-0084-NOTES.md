# WO-0084 notes: category illustrations (Release 0, R6b)

## What was built (apps/web/components/ui/illustrations/)
- Nine original inline-SVG components, one per taxonomy category, each its own file under 400 bytes: `Tops` (boxed T-shirt, V neck), `Bottoms` (trousers, waistband and fly), `Outerwear` (hooded zip jacket), `Footwear` (low shoe, side view), `Accessories` (tote bag with a handle), `Underwear` (briefs, for "Underwear and socks"), `Activewear` (sleeveless training top), `EthnicWear` (kurta with collar, placket and slits), `OccasionWear` (suit jacket with lapels). Drawn by hand as straight-line polygons on a 100 x 100 grid: flat single-colour silhouette plus one detail path. No curves, circles, arcs, round joins, gradients, filters, strokes with caps, stripes or text. No icon set, nothing traced or copied.
- `CategoryIllustration({ category, hex, label, tile? })`: draws the garment filled with the stored colour, an outline and a detail line; `role="img"`, `aria-label` = the given label (the category name when the label is empty), `focusable="false"`, `data-category`. Width and height 100% so the tile decides the size.
- `colour.ts` (hex normalisation, WCAG relative luminance, contrast), `paint.ts` (the choice of outline and detail colour), `index.ts` (barrel). Nothing outside the directory is changed: no stylesheet, no page, no dependency.

## How the outline colour is chosen (interpretation to confirm with the checker)
- The tile background is the `--paper` token. In `globals.css` the dark theme does not override `--paper`, so it is `#ffffff` in the light AND the dark theme (the test reads both themes from the stylesheet and pins `TILE_PAPER` to them).
- `pickOutline(tint, tile)`: candidates are black and white; only those that reach 3:1 against the tile qualify (the better of the two always reaches 4.58:1, so one always qualifies); if both qualify (a mid-grey tile) the one that stands out more from the tint wins. On the real tile that gives a black outline for every tint, at least 21:1 against the tile. A white garment on a white tile is therefore always outlined, a black garment keeps a black edge.
- The detail line inside the garment is black or white by the tint's luminance (`pickDetail`), at least 4.58:1 against any tint (tested at 3:1 or better for 256 greys, 200 seeded random colours and the named ones).
- The optional `tile` prop exists so a future dark tile still gets a white outline at 3:1 (tested on black, white, #777777, #808080, both accent blues and 100 random tiles). This is why the screenshot sheet `WO-0084-hypothetical-dark-tiles.png` exists: it shows what happens if a tile were black. It is not what the app shows today.
- An invalid or missing stored colour (not #rgb or #rrggbb) draws the neutral `#d4d4d4`; nothing but a validated lower-case hex ever reaches the markup.

## Tests (apps/web/components/ui/illustrations/illustrations.test.ts, 53 tests)
Every category renders and is distinct; tint applied for every category; hex normalisation and hostile input; outline at least 3:1 against the paper token in the light and dark theme for black, white, mid-grey (#808080 and #777777), navy, yellow, 200 seeded random colours (mulberry32 seed 0x5eed0084) and all 256 greys, with the contrast maths written a second time inside the test; tile variants; detail contrast; no external reference (source scan for `<image`, `<use`, href, xlink, `url(`, http, src, style, data:, and imports limited to react, the taxonomy types and the directory; markup scan for every category); straight-segments-only scan; each file under 2,048 bytes; brand and inline-style scans (the app-wide design.test.ts scan also covers the new files and stays green).
Mutation: WO-0084-mutation.md, 26 of 26 killed.

## Screenshots (real browser: headless Google Chrome on this Mac, one static HTML sheet per theme written to the scratchpad outside the repo; the sheet loads the repo's own globals.css with the dark block forced on or off, so the real tokens and font are used)
- `screenshots/WO-0084-light-theme-paper-tiles.png`: all nine categories, rows navy, yellow, white, black, mid-grey, red, on the paper tile in the light theme.
- `screenshots/WO-0084-dark-theme-paper-tiles.png`: the same in the dark theme (black page, the tile stays white).
- `screenshots/WO-0084-hypothetical-dark-tiles.png`: same on a black tile (tile = #000000), white outline.
Not captured: the illustrations inside the wardrobe pages (WO-0085 puts them in tiles; globals.css is out of scope here). Not checked at phone width or with a screen reader; the drawings use only width and height 100%.

## Counted lines
372 lines in total, of which 172 are the nine components, wrapper, helpers and barrel and 200 are the test file. Under the 650 flag.

## Deviations and open points
- The outline is chosen from the tile first and the tint second (see above), not from the tint alone: from the tint alone a dark garment would get a white outline that has 1:1 against the white tile, which breaks the 3:1 rule of CC7.
- `Category` and `CATEGORIES` come from `@sparta/taxonomy` (already a dependency of the web app).
- `Underwear.tsx` is named after the first half of the category "Underwear and socks"; the registry key is the full name.

## Gate history
- First full gate run: `test` failed on design.test.ts (the app-wide brand scan found the trademark symbol, written literally, in my own scanner self-check in illustrations.test.ts) and `check_goals` failed on the R3 goal (its predicate runs the web tests, so it followed the same failure). Fixed by building the symbol with `String.fromCharCode(0x2122)` in the test; no assertion was weakened. Second run (HEAD 30d56e1): clean_dupes, typecheck, db_tests, worker_tests, test, lint, web_containment, manifest_check, secret_scan, release_map and scope_check PASS; check_goals FAIL on the R5a goal only (`GATE: FAIL, work is NOT done.`). Cause, reproduced by hand: the worker virtualenv named in workflow/local.env (SPARTA_VENV_PYTHON, a scratchpad venv) no longer has `torch` (`ModuleNotFoundError: No module named 'torch'` in ml/recommendation-engine/garment/tests/test_model_pipeline.py; 20 of 21 tests pass). It is an environment fault unrelated to this work order (nothing outside apps/web/components/ui and workflow/evidence is touched). Not repaired here: reinstalling torch is a new download and outside the work order. model_card.test.ts passes. check_goals also rewrites the `Last pass` date in every goal file; those side-effect edits were reverted with git checkout.
