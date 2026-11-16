# Womenswear (CR-001): spec and work orders
Date: 2026-11-15
Requested by: product owner, 2026-11-12 ("add all the women outfits as well and expand to both men and women as the target audience") and 2026-11-15 (draft the change request and work orders). **Not started: every work order waits for item X-CR1 (the owner's yes on docs/CR-001-womenswear.md).** Conventions in R0.md. Every work order uses GATE_WO=workflow/work-orders/Womenswear.md with its WO_ID. Branch: release/W, cut from main after the audit work orders WO-0124 to WO-0128 are merged (the lint baselines should be empty or small before 17 work orders build on them).
Scope: decisions D1 to D10 of CR-001. Traces to: BRD 4.1, 4.2, 7.5 (BR-56 to BR-60), FDD 4 (FR-6), 5, 8, 10, 13, 14; new requirement ids are added by WO-0131 and mapped to this release in the same commit (release_map must pass).
Order: W1 (WO-0131 to 0133), W2 (0134 to 0137), W3 (0138 to 0142), W4 (0143, 0144), W5 (0145 to 0147). W3 and W4 may run in parallel after W2; two makers never edit the same file.

Standing rules restated:
- Workflow rule 12: lint is law. No new baseline entry. Merge only on `GATE: PASS (FULL: no stage skipped a check)` with GATE_STRICT=1.
- The men's behaviour does not change. `packages/rules/data/fixtures/suggest-baseline.fixture.json` stays byte-for-byte identical through W1 and W2; a diff in it fails the work order.
- Every women's rule value is DRAFT until the womenswear style specialist signs it (X-STYLE-W), marked in the data file the way the men's values are.
- H&M-trained parts stay off by default; no H&M row, photograph or id is committed (repo_lint RL03 enforces it).
- `profiles.wardrobe` is never called gender in code, copy, column comments or documents.

## Draft taxonomy additions (input to WO-0132; the specialist confirms)
- **Tops** (women): Blouse, Top, Camisole, Tunic, Crop top, Bodysuit. Shared with men: T-shirt, Shirt, Polo, Sweater, Cardigan, Hoodie.
- **Bottoms** (women): Skirt, Leggings, Culottes, Palazzo. Shared: Jeans, Trousers, Shorts, Joggers, Chinos.
- **One-pieces** (new category, women): Dress, Maxi dress, Jumpsuit, Playsuit, Dungarees.
- **Outerwear** (women): Shrug, Cape. Shared: Jacket, Blazer, Coat.
- **Footwear** (women): Heels, Flats, Wedges, Ballet flats, Heeled boots. Shared: Sneakers, Boots, Sandals, Formal shoes.
- **Accessories** (women): Handbag, Clutch, Dupatta, Stole, Hair accessory, Jewellery. Shared: Watch, Belt, Cap, Scarf, Bag.
- **Ethnic wear** (women): Saree, Salwar kameez, Kurta set, Kurti, Lehenga, Anarkali, Blouse (saree). Men's stay as they are.
- **Occasion wear** (women): Gown, Cocktail dress, Trouser suit.
- **Activewear** (women): Sports bra top, Sports leggings, Sports skirt. Shared: Sports T-shirt, Track pants, Sports shorts, Track jacket.
- **Underwear and socks**: no new sub-type beyond a generic women's entry; never suggested; no size (D6).
- **Fit** adds: Bodycon, A-line, Flared, Wrap. **Material** adds: Silk, Chiffon, Georgette, Viscose, Knit. **Size systems** add: Dress size UK, EU, US, IN.

---
## Slice W1: scope and data model

# Work Order WO-0131: documents and legal text for CR-001
Action: execute. Owner: Spec agent (doc sync), legal consultant for the legal pack. Checker: Spec QC; the product owner signs BRD, FDD and legal changes, the SA signs HLD and LLD.
In scope: docs/BRD.md, docs/FDD.md, docs/HLD.md, docs/LLD.md, README.md, legal/**, workflow/gates/release_map.py, workflow/gates/release_map.test.ts, docs/MVP-AGENT-WORKFLOW.md
Note: no code. New requirement ids continue the existing ranges. Scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): of the workflow document only section 7 (the release plan) may change; "its data" of release_map.py is the Traces column of that section and the script's test file.
Instructions: apply D1 to D10. BRD: audience in 1, 4.1, 4.2 (remove "womenswear and other audiences" from out of scope; add D10's list), 5 (style specialists), 7.5, 9, 11 (targets), RK-11 wording, a new risk for thin segments. FDD: FR-6 (the wardrobe question), 5.3 and 13 (sub-types with audience, sizes), 8 and 14.1 (one-piece group, rule sets by audience), 14.3 (Dress row), 14.5 (unlock list per audience), 10 and 11 (audience dimension), 16 (no new event). HLD and LLD: every sentence that says menswear; LLD 4 (columns), 5 (facts and cube), 7.8 and 7.9 (type map, index groups), 9.5 (rule-set selection). Legal: privacy policy and pilot notice name the wardrobe question and say it is shared only in group figures; privacy risk assessment gets a row for it; vendor agreement names the audience dimension. Add the release row "W" to the release plan and map every new id.
Completion conditions: release_map passes; `git grep -n -i "men only"` and the README's audience row agree with D1; the legal review log has an entry for this change; gate green (WO_ID=WO-0131).

---
# Work Order WO-0132: taxonomy version 2 (audience tag, women's sub-types, fits, materials, sizes)
Action: execute. Owner: Engine maker. Checker: Spec QC; consult: style consultant.
In scope: packages/taxonomy/src/**
Note: `taxonomy.json` gets `version: 2`. Each sub-type becomes an object `{ name, audience }` with audience `men`, `women` or `both`; every existing sub-type keeps its name. A new category for one-pieces is `draft: true` until signed.
Instructions: add the draft list above; add `audienceOf(category, subType)`, `subTypesFor(category, wardrobe)` and the `Wardrobe` type (`menswear | womenswear | both`) to the package API; extend the validators (unknown audience, duplicate sub-type across categories, a sub-type with no slot group) and the tests. Keep every existing export working (the app and the engine compile unchanged with wardrobe `menswear`).
Completion conditions: taxonomy tests cover every new sub-type and the three wardrobe values; `subTypesFor(c, 'menswear')` returns exactly today's lists (asserted against a frozen copy); typecheck and lint pass with no new baseline entry; gate green (WO_ID=WO-0132).

---
# Work Order WO-0133: database: audience on sub-types, new lookups, `profiles.wardrobe`
Action: execute. Owner: Database maker. Checker: Spec QC + security review (a new personal-data column).
In scope: supabase/migrations/**, supabase/seed/**, supabase/scripts/gen-seed.ts, supabase/tests/database/**
Note: migrations are append-only. 900_catalog_lint must pass unchanged. Scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): under supabase/migrations only new files; an applied migration is never edited.
Instructions: `catalog.lk_sub_type.audience text not null default 'both' check (audience in ('men','women','both'))`, set from the taxonomy by the generated seed; new rows for sub-types, fits, materials, size systems and sizes. `app.profiles.wardrobe text not null default 'menswear' check (wardrobe in ('menswear','womenswear','both'))`; the person may update their own value (column grant and policy as for `currency`); it is in the export and removed with the account. A trigger or check keeps `items.sub_type` valid for any audience (an item is never rejected because of the profile's wardrobe: the wardrobe only filters what the forms offer). pgTAP: grants, the default, the check, export and delete, and that another user cannot read the column.
Completion conditions: `supabase db reset` and all pgTAP files pass, including 900_catalog_lint; the seed test shows lookups equal to the taxonomy; no new db_lint finding; gate green with GATE_STRICT=1 (WO_ID=WO-0133).

---
## Slice W2: engine

# Work Order WO-0134: one-piece slot group and audience-aware eligibility
Action: execute. Owner: Engine maker. Checker: Spec QC + code review.
In scope: packages/taxonomy/src/slots.json, packages/taxonomy/src/**, packages/rules/src/**
Note: decision D3. The men's baseline fixture must not change. Scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): packages/rules/data/rules.json is NOT in scope (it lies outside packages/rules/src and changes only with the style specialist's signature).
Instructions: add the group `top-and-bottom` (`slots: ["Top","Bottom"]`, `fill: "both"`) for the one-piece sub-types and the saree, lehenga and salwar kameez sets as the specialist's draft says; generalise the code paths that today special-case `layer-and-bottom` (eligibility, combinations, completeness, swap, anchor, unlock counting, the Supabase and local mappers' `fill === 'both'` branch) so any two-slot group works. `suggest()` takes the wardrobe type and offers only sub-types of that audience (`both` offers all). Property tests: an outfit never holds a one-piece together with another top or bottom; every suggestion's items belong to the requested audience.
Completion conditions: new unit and property tests pass; the men's baseline fixture is byte-identical (a test compares its hash); the engine stays browser-safe (lint section 3); gate green (WO_ID=WO-0134).

---
# Work Order WO-0135: the womenswear rule set, version 1 (draft)
Action: execute. Owner: Engine maker. Checker: Spec QC; consult: style consultant (mandatory, LLD 9.5).
In scope: packages/rules/data/**, packages/rules/src/**
Note: decision D4. `rules.json` stays the men's file; add `rules.women.json` with the same schema and a loader that picks by audience. Every value carries a DRAFT note.
Instructions: for each of the seven occasions set the allowed sub-types per slot, forbidden pairs, colour and pattern limits and layer rules for womenswear (for example Work: blouse, shirt or top with trousers or a skirt, or a dress, closed shoes; Formal: gown, cocktail dress, saree or trouser suit with heels or formal flats; Sport: activewear and sneakers). Season rules (no sandals in winter, no heavy knits in summer) and the footwear pairs (no heels with sports leggings, and so on). Reason templates reuse the existing sentences; add one for a one-piece ("One piece, so top and bottom always match"). Weights and penalties start as copies of the men's.
Completion conditions: rules-data tests validate both files against one schema; a hard-rule test per occasion for the women's set; `suggest()` returns up to three suggestions for each of the five fixture wardrobes of WO-0137 on every occasion where the wardrobe allows it; gate green (WO_ID=WO-0135).

---
# Work Order WO-0136: accessories, ethnic wear and the women's unlock list
Action: execute. Owner: Engine maker. Checker: Spec QC; consult: style consultant.
In scope: packages/rules/data/**, packages/rules/src/**
Note: today a suggestion adds only the best-matching belt. Keep that for menswear.
Instructions: for womenswear a suggestion adds at most one accessory by a scored rule: a bag whose colour family matches the shoes or is neutral, else none; a dupatta or stole fills Layer for the ethnic sets when present. Slot mapping and occasion entries for saree, salwar kameez, kurta set, kurti, lehenga and anarkali (decision D8). `unlock-fallback.women.json`: up to 40 common womenswear combinations of sub-type and colour family, DRAFT; Wardrobe unlock reads the list of the wardrobe type.
Completion conditions: tests for the accessory rule (match, neutral, none), for each ethnic set on Party and Formal, and for unlock with each wardrobe type; the men's unlock results are unchanged (asserted against the existing fixture); gate green (WO_ID=WO-0136).

---
# Work Order WO-0137: fixture wardrobes, the women's baseline and the review pack
Action: execute. Owner: Engine maker. Checker: Spec QC + Model QC (golden outputs).
In scope: packages/rules/src/fixtures/**, packages/rules/data/fixtures/**, packages/rules/scripts/review-pack.ts, workflow/evidence/W/**
Note: invented wardrobes only. The men's fixture file is not regenerated.
Instructions: five women's fixture wardrobes (rich, thin, capsule, ethnic-heavy, work-heavy) and one mixed wardrobe for `both`; `suggest-baseline.women.fixture.json` generated from them; the random wardrobe generator draws sub-types by audience. Extend the review pack script to print 50 women's suggestions from the five wardrobes for the G9 review, with the checker's problem list.
Completion conditions: both baseline fixtures are checked by tests; the determinism test covers the women's set; the review pack is in workflow/evidence/W/ and an AI style review of it is recorded (not a substitute for G9); gate green (WO_ID=WO-0137).

---
## Slice W3: app

# Work Order WO-0138: the wardrobe question at onboarding and in Settings
Action: execute. Owner: Frontend maker (UX brief first). Checker: Spec QC + design critic; real-browser evidence.
In scope: apps/web/components/consent/**, apps/web/components/account/**, apps/web/lib/onboarding.ts, apps/web/lib/settings-form.ts, apps/web/lib/supabase/**, apps/web/lib/local-repository.ts, apps/web/lib/repository.ts, apps/web/app/?auth?/**
Note: the last item is the route group apps/web/app/(auth)/: a bracket cannot be written on the In scope line, so each bracket is written as ? (one character), which matches that folder and no other (WO-0149, repo_lint RL13). Decision D1. Exact wording: "Which clothes do you keep here?" with Menswear, Womenswear, Both. No default is pre-selected at onboarding; existing accounts keep `menswear`.
Instructions: add the field to the onboarding form and to Settings (changeable at any time, with one sentence on what it changes), to both repositories and the mappers, and to the export. The gate (lib/supabase/gate.ts) does not change. The local (no-login) backend stores it in the browser document.
Completion conditions: form tests and a11y source tests for the new field; integration test against the stack (set at onboarding, change in Settings, present in the export); screenshots desktop and mobile; lint clean with no new baseline entry; gate green with GATE_STRICT=1 (WO_ID=WO-0138).

---
# Work Order WO-0139: item form, filters and pickers by audience; photo pre-fill
Action: execute. Owner: Frontend maker. Checker: Spec QC.
In scope: apps/web/components/wardrobe/**, apps/web/components/catalogue/**, apps/web/lib/item-form.ts, apps/web/lib/filters.ts, apps/web/lib/photo-flow.ts, apps/web/lib/catalogue.ts
Instructions: sub-type, fit, material and size lists come from `subTypesFor` and the new lookups for the profile's wardrobe; "Both" shows all, grouped. An existing item whose sub-type is outside the current wardrobe type still opens and saves. The photo flow's suggested category uses the garment map of WO-0143 (Dress is now a suggestion for womenswear and both). Catalogue picker and filters gain the audience filter, defaulting to the wardrobe type.
Completion conditions: tests for each wardrobe value on the form, the filters and the picker; an item of the other audience round-trips; gate green (WO_ID=WO-0139).

---
# Work Order WO-0140: outfit builder and suggestions with one-pieces
Action: execute. Owner: Frontend maker. Checker: Spec QC + design critic; real-browser evidence.
In scope: apps/web/components/outfits/**, apps/web/lib/suggestions-view-model.ts, apps/web/lib/engine-config.ts
Instructions: the builder shows a one-piece across the Top and Bottom slots and clears either slot's other item when one is chosen (and the reverse), as it does for a suit. Suggestions pass the wardrobe type to the engine; with "Both" a two-way switch (Menswear rules, Womenswear rules) sits above the occasion picker and is remembered in the browser. Swap lists respect the audience. Complete the look and Wardrobe unlock use the lists of the chosen audience.
Completion conditions: view-model tests for one-piece outfits, the switch and swaps; the no-network scan and lint rules stay green; screenshots of a dress outfit, a saree outfit and the switch; gate green (WO_ID=WO-0140).

---
# Work Order WO-0141: illustrations for the new sub-types
Action: execute (design: the Visual craft agent builds, the Design critic scores). Owner: Visual craft agent. Checker: Design critic.
In scope: apps/web/components/ui/illustrations/**, workflow/evidence/W/**
Note: same drawing language as WO-0084 (flat, tinted with the item's colour, no brand marks, no photographs).
Instructions: one illustration per new sub-type family (about 35 sub-types, sharing shapes where it reads well: for example Maxi dress from Dress), plus the one-piece category tile. `CategoryIllustration` falls back to the category shape for any sub-type without its own drawing, so nothing is ever blank.
Completion conditions: illustrations.test.ts covers every taxonomy sub-type (no missing, no orphan); contrast tests green on light and dark tints; critic score at least 8 of 10; gate green (WO_ID=WO-0141).

---
# Work Order WO-0142: wording sweep and accessibility
Action: execute. Owner: Frontend maker. Checker: Spec QC.
In scope: apps/web/app/**, apps/web/components/**, apps/web/lib/**, supabase/scripts/demo-data.sh
Note: scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): in supabase/scripts/demo-data.sh only wording may change.
Instructions: remove every user-facing "men" or "menswear" that is now wrong (About, pilot notice summary, empty states, the thin-wardrobe message, vendor headings). Add a source test that fails on "men's", "for men" or "menswear" in user-facing strings outside the taxonomy labels and the wardrobe question.
Completion conditions: the new source test passes; a11y tests green; gate green (WO_ID=WO-0142).

---
## Slice W4: models (off by default)

# Work Order WO-0143: garment maps for womenswear
Action: execute. Owner: ML maker. Checker: Model QC.
In scope: ml/recommendation-engine/garment/class_map.json, ml/recommendation-engine/garment_v2/**, ml/recommendation-engine/garment/tests/**, services/worker/worker/**, services/worker/tests/**
Note: scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): in services/worker/worker only the loading of the class map may change. Version 1 (Fashion-MNIST) is not retrained: only its class map changes (class 3 Dress maps to One-pieces / Dress). Version 2 is still not built; this work order extends its type map so the later training work order covers both audiences.
Instructions: map Dress in version 1 and return it only when the job's wardrobe type is womenswear or both (the worker reads the type from the job input, which the app sets). Extend the version 2 type map from 20 to about 32 H&M product types (Dress, Skirt, Blouse, Top, Vest top, Leggings/Tights, Jumpsuit/Playsuit, Bodysuit, Heels and so on), each with category, sub-type and prior slot, DRAFT. Update the model card of version 1 (map change only, hash unchanged).
Completion conditions: map tests for both versions; the worker tests show Dress suggested for a womenswear job and not for a menswear job; the committed model file's hash is unchanged; gate green with GATE_STRICT=1 (WO_ID=WO-0143).

---
# Work Order WO-0144: pairing table and unlock candidates per audience
Action: execute only when X-HMOK covers womenswear. Owner: ML maker. Checker: Model QC + privacy and licence check (G4).
In scope: ml/recommendation-engine/pairing/**, packages/rules/src/pairing.ts, packages/rules/src/learned.test.ts, apps/web/lib/engine-config.ts, models.manifest.json
Note: outputs are not committed (repo_lint RL01 and RL04). The pipeline's Menswear filter becomes a parameter.
Instructions: `build_prior.py --audience women` uses the Ladieswear and Divided index groups, the extended type map of WO-0143 and the same cleaning; the one-piece slot pairs with Layer and Footwear only. Evaluate per audience on the last eight weeks as today; a table ships only if it clears the same AUC bar. Output `pairing-prior-women-v1.json` and `unlock-candidates.women.json`; the engine loads the file of the chosen audience; the manifest gets two more `not-built` entries. Prior card per audience.
Completion conditions: pipeline tests on the synthetic data for both audiences; the women's card records AUC with its interval and the decision; manifest check passes; the app runs with the women's files absent (rules only); gate green with GATE_STRICT=1 (WO_ID=WO-0144).

---
## Slice W5: vendor, demo, release

# Work Order WO-0145: audience as a vendor dimension and filter
Action: execute. Owner: Database maker, then Frontend maker. Checker: Spec QC + security review (suppression).
In scope: supabase/migrations/**, supabase/tests/database/**, apps/web/lib/vendor/**, apps/web/components/vendor/**
Note: scope limits moved off the In scope line on 2026-11-16 (WO-0149, repo_lint RL13: the line must be a list scope_check.sh can read): under supabase/migrations only new files. Decision D9. The audience of a fact is the audience of the item's sub-type (`both` counts under the owner's wardrobe type; under `both` profiles it counts in each audience's figures once). Minimum group size, rounding and complementary suppression are unchanged and must be re-proved with the new dimension.
Instructions: add `audience` to `analytics_private.facts` and as filter dimension `f_audience` in the cube and in every vendor function's filter list; the suppression tests of 016 and 020 are extended with an audience split that would reveal a small group by subtraction and must be hidden. Dashboard, gaps and reports get the filter value in the existing filter control.
Completion conditions: pgTAP for the new dimension including the subtraction case; integration tests of the dashboard with the filter; 900_catalog_lint green; no new no-unsafe baseline entry; gate green with GATE_STRICT=1 (WO_ID=WO-0145).

---
# Work Order WO-0146: demo data and the H&M demo catalogue for womenswear
Action: execute. Owner: Backend maker. Checker: Spec QC + G4.
In scope: supabase/scripts/**, supabase/seed/**, workflow/demo/**, apps/web/lib/demo.ts, apps/web/lib/demo-catalogue.ts
Note: local only. Invented people (`@example.test`). The H&M loader reads the local folder at run time and commits nothing.
Instructions: demo-data.sh adds two womenswear accounts (rich, thin) and one `both` account with wardrobes from the fixtures of WO-0137, purchases, a wishlist and outfits; the insights seed gets enough synthetic consumers per audience to clear the minimum group size. `load_hm_demo_catalog.py --audience` loads Ladieswear articles too (same cap per audience) with the extended mapping. DEMO-SCRIPT.md gets a five-minute womenswear path: onboarding question, add a dress by photo, a Work suggestion with a dress, the vendor filter.
Completion conditions: the demo-data test passes live; the loader's tests cover both audiences on the invented fixture; a fresh checker walks the new path in a real browser; sweep clean; gate green with GATE_STRICT=1 (WO_ID=WO-0146).

---
# Work Order WO-0147: collector mapping, release check and retro
Action: execute. Owner: Backend maker, then the orchestrator. Checker: Spec QC; release approver.
In scope: jobs/collector/mapping/**, jobs/collector/tests/**, workflow/retros/W.md, workflow/goals/**, workflow/STATE.md, workflow/github/work-items.csv
Instructions: the collector's category mapping recognises the women's sub-types and sets the audience (test pages added to the local test site). Then the release check: release_map over every id of CR-001, all three lint baselines no larger than at the start of the release, GATE_STRICT gate FULL, the G9 pack handed to the womenswear specialist (X-STYLE-W), retro and a goal `W-womenswear` that re-checks the men's baseline hash and the women's fixture.
Completion conditions: collector tests green; retro written; goal passes; the owner's checkpoint item for the womenswear demo is on the board.
