# WO-0084 mutation proof (R6b, category illustrations)

Method: scratch copy OUTSIDE the repository (session scratchpad, not committed): apps/web/components/ui/illustrations, app/globals.css, components/design-rules.ts, the root vitest config and tsconfig, with the repo's node_modules linked. For each mutant ONE source edit (one text substitution), then `npx vitest run` on the copy, then the edit is reverted. Baseline on the copy (no mutation): 53 of 53 tests pass in illustrations.test.ts. design.test.ts scans the whole app and is not part of the copy; the brand and inline-style scans are repeated in the copy's own test through design-rules.ts (M23, M24).

## 26 mutants run, 26 killed, 0 survived

| Mutant | Result | First failing test (describe, then test) |
| --- | --- | --- |
| M01 luminance weights swapped (red 0.0722, blue 0.2126) | KILLED (4 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) the contrast maths matches known values |
| M02 gamma exponent 2.4 -> 2.0 | KILLED (3 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) the contrast maths matches known values |
| M03 contrast ratio without the 0.05 on the lighter colour | KILLED (2 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) the contrast maths matches known values |
| M04 stark() inverted (picks the colour closer to the base) | KILLED (2 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) where both colours qualify (a mid-grey tile) the tint decides: the outline stands out from the garment |
| M05 minimum contrast 3 -> 0.9 (white qualifies on a white tile) | KILLED (9 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) light theme, tile #ffffff black tint: the drawn outline is black or white and at least 3:1 |
| M06 outline ignores the tile (always stark(tint)) | KILLED (9 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) light theme, tile #ffffff black tint: the drawn outline is black or white and at least 3:1 |
| M07 outline always black | KILLED (2 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) a different tile still gets 3:1: the choice follows the tile, then the tint (hypothetical dark and mid-grey tiles) |
| M08 tile token set to black | KILLED (17 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) the tile is the paper token, white in the light and the dark theme |
| M09 detail line always black | KILLED (1 failing) | the outline keeps 3:1 against the tile background (WCAG 1.4.11) the detail line inside the garment is black or white by the tint and at least 3:1 against it |
| M10 tint not applied (fill uses the fallback) | KILLED (12 failing) | every category has its own illustration an empty label falls back to the category name, an unknown category still draws a labelled placeholder |
| M11 hex validation removed (any string reaches the markup) | KILLED (2 failing) | the garment is tinted in the stored colour upper case and three-digit codes are normalised, nothing else is accepted |
| M12 three-digit hex expanded wrongly | KILLED (1 failing) | the garment is tinted in the stored colour upper case and three-digit codes are normalised, nothing else is accepted |
| M13 role="img" removed | KILLED (10 failing) | every category has its own illustration Tops renders an svg with role img, the given label and a filled shape |
| M14 aria-label replaced by a fixed word | KILLED (11 failing) | every category has its own illustration Tops renders an svg with role img, the given label and a filled shape |
| M15 an external image added to a garment | KILLED (3 failing) | no external reference, and the drawing is sharp and small no source file of the directory refers to anything outside itself except react and the taxonomy types |
| M16 url() paint reference in a garment | KILLED (4 failing) | the garment is tinted in the stored colour Bottoms: the stored colour is the fill of the silhouette |
| M17 curved segment in a garment (Q) | KILLED (1 failing) | no external reference, and the drawing is sharp and small only svg, g, polygon and path elements are drawn, with straight segments only (no curves, arcs, circles or rounded joins) |
| M18 circle drawn in a garment | KILLED (1 failing) | no external reference, and the drawing is sharp and small only svg, g, polygon and path elements are drawn, with straight segments only (no curves, arcs, circles or rounded joins) |
| M19 rounded line joins | KILLED (1 failing) | no external reference, and the drawing is sharp and small only svg, g, polygon and path elements are drawn, with straight segments only (no curves, arcs, circles or rounded joins) |
| M20 two categories share one silhouette | KILLED (2 failing) | every category has its own illustration the registry holds exactly the nine categories of the taxonomy, each a distinct component |
| M21 a category missing from the registry | KILLED (2 failing) | every category has its own illustration the registry holds exactly the nine categories of the taxonomy, each a distinct component |
| M22 component grows past 2 KB (long comment) | KILLED (1 failing) | no external reference, and the drawing is sharp and small each component file is under 2 KB (2,048 bytes) |
| M23 trademark symbol in a comment | KILLED (1 failing) | the design rules still hold for these files no brand, trademark symbol or proprietary font, no inline radius, shadow or background |
| M24 inline radius in a component | KILLED (3 failing) | no external reference, and the drawing is sharp and small no source file of the directory refers to anything outside itself except react and the taxonomy types |
| M25 external link in the wrapper | KILLED (3 failing) | the garment is tinted in the stored colour a missing or hostile colour gives the neutral fallback and never reaches the markup |
| M26 empty label no longer falls back to the category | KILLED (1 failing) | every category has its own illustration an empty label falls back to the category name, an unknown category still draws a labelled placeholder |

Survivors: none. The work order asks for at least 8; 26 were run, grouped as: colour maths (M01 to M03), choice of outline and detail colour (M04 to M09), tint and hex validation (M10 to M12), accessible name (M13, M14, M26), external references (M15, M16, M25), sharp geometry (M17 to M19), registry (M20, M21), size and design rules (M22 to M24).

Reproduce: the harness is session-local (scratchpad); each mutant is one substitution written out in the table above.
