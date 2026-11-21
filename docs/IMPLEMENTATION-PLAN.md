# Sparta: Implementation Plan (delivery, UI and UX)

| Field | Value |
| --- | --- |
| Document | Implementation plan: delivery sequence, navigation, interaction and visual design |
| Version | 0.1 (draft for review) |
| Date | 2026-11-05 |
| Traces to | BRD v1.3, FDD v1.4, HLD section 12, LLD sections 9, 11 and 14 |
| Status | Draft. Nothing here changes the BRD, FDD, HLD or LLD. Where this plan and those documents differ, the documents win and the difference is listed in "Assumptions and conflicts". |

## How to read this document

- Sections 1 to 6 follow the requested structure: delivery plan, navigation, interaction, visual system, components and tests, and effort and risks.
- Anything that is not in the FDD is labelled **PROPOSED**, with a reason. All PROPOSED items are collected at the end.
- Numbers are either computed (contrast ratios, capacity) and shown with their method, or labelled as a judgement.
- Three design skills govern different parts of the frontend (section 4.1). They share one set of tokens, so the product looks like one product.

---

## 1. Delivery plan

### 1.1 Timeline basis

- **Calendar:** BRD section 12 (12 relative weeks, including the build).
- **Build order:** LLD section 14 (milestones M0 to M6). It is more detailed than the BRD and wins where the two differ (see conflict C-2).
- **Team:** C. Prashanth (solution architect), Arpan Shah (style specialist), Ambarish Sengupta (product owner). All three are on the delivery team (BRD section 5).

### 1.2 Milestones

Each milestone has a "done when" test that is either true or false.

| M | Weeks | Owner (assumed, see A-2) | Deliverables | Satisfies | Depends on | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| M0 Garment model | 1-4 (in parallel) | Prashanth, with Arpan for team photos | Train, test and export the Fashion-MNIST model to ONNX; model card; evaluation on at least 100 team photos; `GARMENT_MIN_CONFIDENCE` set | BR-51, BR-52, FR-23a; FDD 14.3 and 14.4; LOI-9, LOI-10 | Fashion-MNIST files held by the team (BRD section 10) | Test accuracy is about 90% or more on the 10,000 test pictures **and** the team-photo result is recorded **and** the go or no-go decision for the suggestion is written down (LOI-9) |
| M1 Foundations | 1-2 | Prashanth (database, auth), Ambarish (gate copy), Arpan (taxonomy seed) | Repo layout per HLD section 12; CI; local Supabase; migrations for lookups, colour functions, core tables, RLS and storage policies; pgTAP harness; auth and `proxy.ts` gates; `/accept-terms`, `/pilot-notice`, `/onboarding`, `/not-available`; minimal admin slice (invitations, supported countries, maintenance); wardrobe list; manual item form with colour picker; taxonomy seed; first collector run; **design tokens, fonts and the app shell (tab bar and rail)** | BR-01, BR-13, BR-16, BR-17, BR-20, BR-21, BR-22, BR-40, BR-43; FR-1 to FR-9, FR-10, FR-22, FR-29, FR-29a, FR-60, FR-61, FR-68 | none | In CI: pgTAP RLS tests pass; an uninvited email is refused with the FR-8 message; a new user cannot reach the wardrobe before the age and Terms screen, the pilot notice and onboarding; a manual item saves with a derived colour family |
| M2 Wardrobe breadth | 3-4 | Prashanth, Arpan | Catalogue search and picker; all FR-11 filters and FR-12 sorts; tags and collections; condition slider; archive; purchases; wishlist and plan purchases; export, delete account and Leave the pilot; About page. Start pilot recruitment | BR-02, BR-03, BR-08, BR-09, BR-12, BR-14, BR-24; FR-11 to FR-21, FR-24, FR-27, FR-28, FR-30 to FR-36, FR-62 to FR-67 | M1 | Playwright: add from catalogue, filter by colour family, archive and undo, record a purchase, mark a wishlist item bought, export requested, Leave the pilot then sign-in fails |
| M3 Images and receipts | 4-5 | Prashanth | Job table and claim; worker container; photo handler (background removal plus the M0 model); receipt handler with redaction; receipt draft UI; pre-filled item form | BR-05, BR-06, BR-29, BR-51; FR-23, FR-23a, FR-25, FR-40 to FR-47 | M1; M0 export for the garment step | Playwright: a photo item shows "Suggested from your photo" and saves the user's value if changed; a receipt draft creates nothing until confirmed; card numbers, emails and phone numbers are not shown or stored (FR-47) |
| M4 Outfits | 5-6 | Arpan (rules and weights), Prashanth (package) | `packages/rules`: rules R1 to R8, ranking, swap order; builder; suggestions; calendar; optional log; style review of 50 suggestions | BR-10, BR-11, BR-15, BR-50, BR-53, BR-54, BR-55; FR-50 to FR-59 | M2 (items with tags); FOI-8, FOI-9 | Vitest property test on 200 generated wardrobes passes R1, R2 and the slot structure; same inputs give the same output; the style review is about 80% or more acceptable (FDD 14.4) |
| M5 Vendor side | 5-6 | Prashanth (aggregation), Ambarish (vendor onboarding) | Aggregation job and cube with suppression; vendor functions; dashboard, gaps, condition spectrum, reports, feed upload and publish; vendor agreement gate; the rest of the admin console (catalogue queue, aggregation runs, deletion queue, query log, end of pilot) | BR-25, BR-26, BR-30 to BR-36, BR-41; FR-70 to FR-79, FR-80 to FR-88, FR-90 to FR-95, FR-100 to FR-104, FR-69 | M2 data model; synthetic seed data for tests only | pgTAP: a segment of 9 users never appears; the 201st call in an hour is refused; Playwright: a vendor must accept the agreement before the portal opens |
| M6 Hardening and pilot open | 6 | All three | End-to-end and accessibility passes; restore rehearsal; load check at 500 users; email delivery check outside the team; legal pack walkthrough; incident drill | NFR-1 to NFR-8; BR-44, BR-45 | M1 to M5 | Every FDD section 17 acceptance row maps to a passing test; Lighthouse CI meets NFR-3 on a 500-item account; a backup restore has been rehearsed |
| Pilot | 7-12 | All three | Operate, fix, measure (FDD section 16), vendor review, end of pilot | BR-44, BR-45; FR-69 | M6 | The success criteria in BRD section 11 are reported, and the end-of-pilot path (FR-69) has run |

### 1.3 Critical path

```
M1 schema + RLS + auth and consent gates
  -> M2 items, storage, catalogue
     -> M3 job queue and worker ----\
     -> M4 rules package ------------> M6 hardening -> pilot opens
     -> M5 aggregation (needs M2 data model) -/
M0 garment model runs alongside M1 to M3 and joins at M3.
```

External long poles that can block the opening date:

| Item | Why it blocks | Must be closed by |
| --- | --- | --- |
| LOI-5 email provider | No invitation can be sent without it | Before the first invitation (week 3) |
| FOI-6 storefront sources | The seed catalogue (BR-03) needs allowed sources | M1 collector run |
| FOI-8 slot map, FOI-9 weights and review, LOI-11 | The engine cannot be judged without them | End of M4 |
| LOI-9 garment suggestion go or no-go | Decides whether FR-23a ships on | End of M3 |
| LOI-8 invitation hook test | FR-8 depends on it | End of M1 |

### 1.4 What can run in parallel

| In parallel | Why it is safe |
| --- | --- |
| M0 with M1, M2 and M3 | Offline training on public data; only joins the worker in M3 |
| M4 with M5 | Different code areas: `packages/rules` and the browser, against SQL aggregation and vendor routes |
| Design tokens and app shell with the M1 database work | No shared files; the shell needs only route names |
| Media sourcing (section 4.6) with M1 and M2 | No code dependency; needs approval only |

### 1.5 First-week task list

1. Create the repo layout from HLD section 12 (`apps/web`, `services/worker`, `jobs/collector`, `supabase`, `packages/taxonomy`, `packages/rules`, `ml/recommendation-engine`).
2. CI workflow (`ci.yml` in LLD section 12) with lint, type check and an empty Vitest and pgTAP run.
3. Local Supabase; first migrations: lookups, colour functions with the LLD golden vectors, core tables, RLS policies.
4. pgTAP harness with the first RLS test (user A cannot read user B).
5. `packages/taxonomy` from FDD section 13.
6. Auth with email and Google, plus the `proxy.ts` gate order from LLD 9.1.
7. Start M0 training.
8. Choose the email provider (LOI-5) and the first storefront sources (FOI-6).
9. Design tokens (section 4), self-hosted fonts and the app shell with the tab bar and rail.
10. Start the media candidate approval (section 4.6).

---

## 2. Level-1 navigation

The source of truth is FDD section 3. The consumer app has exactly five tabs, which fits the five-item limit for a bottom bar.

### 2.1 Layout by width (PROPOSED adaptation)

| Width | Consumer app | Vendor portal | Admin console |
| --- | --- | --- | --- |
| Under 1024 px | Bottom tab bar, icon plus label, 5 items | Top bar plus a drawer (desktop-first, FDD section 3) | Top bar plus a drawer |
| 1024 px and over | Left rail, 96 px, icon plus label | Left rail with labels | Left rail with grouped labels |

Reason: FDD section 3 names a bottom bar for the consumer app; a rail on wide screens keeps the same five places in the same order. Tab bar, rail and drawer are never mixed at the same level.

### 2.2 Consumer tabs (FDD section 3)

| Tab | Icon intent (Phosphor) | Route | Purpose | One primary action | Empty state | Loading | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wardrobe | Coat hanger | `/wardrobe` | See and organise everything owned (the primary outcome, BRD section 6) | Add item | "Start from popular items" or "Add my own" (FR-7), with a one-time hanger illustration | Tile skeletons in the grid shape, 40 per page (LLD 9.2) | Inline message with Retry; cached items stay visible offline (NFR-2) |
| Outfits | Stacked squares (layers) | `/outfits` | Build, save, get suggestions, plan on the calendar | Suggest an outfit | "Pick an occasion and we will suggest up to three outfits" | Three card skeletons | FR-54 message naming what is missing, with links to the catalogue or wishlist |
| Wishlist | Heart | `/wishlist` | Wishlist and plan purchases | Add to wishlist | "Keep track of what you want next" | Row skeletons | Inline with Retry |
| Purchases | Receipt | `/purchases` | History, receipt scan, receipt detail | Scan a receipt | "Record what you bought, or scan a receipt" | Row skeletons with the total strip | Inline; a failed scan offers manual entry (FR-45) |
| Me | User circle | `/me` | Settings, privacy and sharing, export, delete, About the pilot | none (settings list) | not applicable | Section skeleton | Inline |

Off-nav consumer screens: sign-in and sign-up (FR-1, FR-8), `/accept-terms` (FR-2, FR-68), `/pilot-notice` (FR-3 to FR-5), `/onboarding` (FR-6, FR-7, FR-9), `/not-available` (FR-4, FR-9), `/maintenance` (LLD 9.1), `/about` (FR-67), the offline banner (LLD 9.3) and the end-of-pilot banner (FR-69). These screens hide the tab bar; the gate screens offer only what LLD 9.1 allows.

### 2.3 Vendor portal (FDD section 3)

| Destination | Icon intent | Route | Purpose | Primary action | Empty or suppressed state | Loading | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Chart bar | `/vendor` | Ownership mix, trends, condition spectrum (FR-72 to FR-76) | Apply one filter (FR-77) | "Not enough users to display", never 0 (FR-76, FR-80) | Chart skeletons | Message with Retry; the rate limit (FR-88) shows "Too many requests, try again after [time]" |
| Gaps | Target | `/vendor/gaps` | Ranked gaps (FR-75, FR-81) | Open a segment | "No visible ownership" label (FR-81) | Table skeleton | As above |
| Reports | File text | `/vendor/reports` | Monthly gap and demand report (FR-78, FR-79) | Open the latest report | "The first report appears after the team reviews it" | Row skeleton | As above |
| Product feed | Upload | `/vendor/feed` | Upload, validate, publish (FR-90 to FR-93) | Upload a file | Template link (FDD 10.5) | Progress per row | Errors row by row (FR-91) |
| Account | Identification card | `/vendor/account` | Agreement, contact address (FR-94, FR-95) | none | not applicable | Skeleton | Inline |

Gate: `/vendor/agreement` blocks everything until accepted (FR-94).

### 2.4 Admin console (FDD section 3; grouping PROPOSED)

| Group | Destinations | FRs |
| --- | --- | --- |
| People | Invitations; Users and vendors (delete, export, suspend, end access); Deletion queue | FR-8, FR-63, FR-64 |
| Data | Catalogue sources and review queue; Aggregation runs; Reports review | FR-100 to FR-104, FR-86, FR-79 |
| Operations | Worker status and vendor query log; Settings (supported countries, maintenance mode); End of the pilot | FR-88, FR-9, FR-69 |

---

## 3. Interaction layer

### 3.1 Key flows with tap counts

Tap counts are the minimum on a phone, after sign-in, with typing counted separately. They are estimates from the gate order in LLD 9.1 and the FDD fields.

| Flow | Steps | Taps |
| --- | --- | --- |
| First login | Age tick, Terms and Privacy tick, Continue (FR-2, FR-68); "I understand and join the pilot" (FR-3, FR-4); onboarding: country (open and choose), hemisphere and currency pre-filled from the country, Continue (FR-6, FR-9); "Start from popular items" or Skip (FR-7) | 8 |
| Add item: catalogue | Add, Catalogue, choose item, Save (details optional) (FR-21) | 4 |
| Add item: manual | Add, Manual, category (2), sub-type (2), colour swatch, Save; name filled automatically (FR-22) | 8 |
| Add item: photo | Add, Photo, capture, keep cut-out, confirm or change the suggestion, Save (FR-23, FR-23a) | 5 to 7 |
| Add item: receipt | Add, Receipt, capture, then one tap per line (match, new or skip), Confirm (FR-40 to FR-44) | 4 plus one per line |
| Add item: barcode (Could) | Add, Barcode, scan, pick if several match, Save (FR-26) | 4 to 5 |
| Build outfit | Outfits, New, then for each of top, bottom and footwear: open slot and pick (2 each), Save (FR-50) | 9 |
| Suggestion: accept | Outfits, Suggest, occasion chip, Accept (FR-52, FR-53) | 4 |
| Suggestion: swap | Swap on the item, pick the first (most similar) choice (FR-53) | 2 |
| Suggestion: reject | Reject (FR-53) | 1 |
| Record purchase | From the item: Add purchase, date pre-filled, type store and price, Save (FR-30) | 2 plus typing |
| Wishlist bought | Bought, purchase form, Save; the item moves to the wardrobe (FR-35) | 2 plus typing |
| Leave the pilot | Me, Privacy and sharing, Leave the pilot, re-authenticate, Confirm (FR-66) | 5 plus password |

Rules that apply to every flow:

- The primary action is the only filled button on a screen; other actions are outline or text buttons.
- Every destructive action has one confirmation step. Undo is offered where the FDD allows it (archive can be undone, FR-15).
- Back preserves scroll position and filters. Filters are stored in the URL (LLD 9.2), so a view can be linked and restored.
- After a route change, focus moves to the page heading.

### 3.2 Desktop keyboard shortcuts (PROPOSED)

The FDD asks only for keyboard use on the main flows (NFR-4). These shortcuts are additions. To meet WCAG 2.1.4, single-key shortcuts work only when focus is not in a text field, and a setting can turn them off.

| Keys | Action | Scope |
| --- | --- | --- |
| `/` | Focus search or filter | Wardrobe, Wishlist, Purchases, vendor tables |
| `n` | New item | Wardrobe |
| `g` then `w` / `o` / `l` / `p` / `m` | Go to Wardrobe / Outfits / Wishlist / Purchases / Me | Consumer app |
| `f` | Open filters | Wardrobe |
| `s` | Suggest an outfit | Outfits |
| `a` / `r` | Accept or reject the focused suggestion | Suggestions |
| `?` | Open the shortcuts sheet | Everywhere |
| `Esc` | Close a sheet, dialog or tooltip | Everywhere |

Focus: the tab order follows the visual order; a "Skip to content" link comes first; the focus ring is 2 px with a 2 px offset in the focus colour (4.75:1 on canvas, see 4.4); a dialog traps focus and returns it to the control that opened it.

### 3.3 Mobile gestures (PROPOSED)

Every gesture has a visible button that does the same thing, and no gesture blocks the system back swipe.

| Gesture | Where | Button with the same effect |
| --- | --- | --- |
| Pull to refresh | Lists | Refresh in the overflow menu |
| Swipe a wishlist row left | Wishlist | Row menu: Bought, Remove |
| Long-press a tile | Wardrobe | "Select" button in the toolbar |
| Drag a sheet down | Any bottom sheet | Close button |

Horizontal swipes are not used on the main wardrobe grid, to avoid conflict with scrolling.

### 3.4 Locked sharing setting (FR-61, BR-22)

- The switch is shown on, greyed out, with `aria-disabled="true"`, and stays focusable so screen readers announce it.
- The info icon is a real button (44 by 44 px target). Tap, focus or hover opens a tooltip with the exact FR-61 text. `Esc` or moving focus away closes it. The tooltip is linked with `aria-describedby`.
- The tooltip uses the yellow tint background with ink text (16.73:1).
- **Leave the pilot** sits in its own section below, separated from the other settings, as a danger outline button. It does not use a visually heavier style than the other settings, so the screen stays calm (BRD RK-4).

### 3.5 State matrix

Every interactive element has these six states. They are specified once in the tokens and reused.

| State | Visual | Accessibility |
| --- | --- | --- |
| Rest | Token fill or outline | Role and label |
| Hover (pointer only) | 3 px ink offset shadow, moves up 1 px | none |
| Focus | 2 px focus ring, 2 px offset | Visible on keyboard focus only (`:focus-visible`) |
| Pressed | Moves down 1 px, shadow removed, within 100 ms | none |
| Disabled | 45% opacity, no shadow, `not-allowed` cursor | `disabled` or `aria-disabled` |
| Loading | Label kept, small progress bar inside the button, button disabled | `aria-busy="true"`, result announced politely |

---

## 4. Visual system, motion, media and readability

### 4.1 Which design skill governs which part of the frontend

| Frontend area | Skill | Settings (variance / motion / density) | What it contributes |
| --- | --- | --- | --- |
| Entry surfaces: sign-in and invite-only sign-up, `/accept-terms`, `/pilot-notice`, `/onboarding`, `/about`, `/not-available`, `/maintenance`, empty states, the end-of-pilot banner, and the motion language | **taste** (design-taste-frontend) | 7 / 7 / 3 | Asymmetric hero (not centred); at most 4 text elements in a hero; real media, not drawn mockups; every animation has a reason; reduced motion respected; no custom cursor; theme, colour and shape locks; no em-dashes in UI copy; its pre-flight checklist |
| Consumer app: the five tabs, forms, filters, colour picker, condition slider, builder, suggestions, calendar | **ui-ux-pro-max** | 4 / 5 / 5 | Order of priorities: accessibility, touch, performance, style, layout; bottom bar of 5 with labels; rail at 1024 px and over; 44 px targets with 8 px gaps; 150 to 300 ms micro-interactions with exits shorter than entrances; form rules (label above, error below, validate on blur, focus the first invalid field); state kept on back; its pre-delivery checklist. Its rules are written for native apps and are applied here in their web form |
| Vendor portal and admin console (desktop-first, dense) | **stitch** (stitch-design-taste) | 3 / 3 / 8 | A Stitch-ready `DESIGN.md` (Appendix A); sans serif only; monospace figures; dividers instead of cards; skeleton loaders, no spinners; single column under 768 px; the anti-pattern list as "never" rules |

All three use the tokens in 4.3 to 4.5. The taste skill says dashboards are out of its scope, which is why the vendor and admin areas use the Stitch skill.

**Design read:** an invite-only menswear wardrobe PWA and a vendor insights portal, for design-conscious men aged 18 to 40 in India and for brand and retail buyers. The language is bright and editorial: a sunlit studio with highlighter-pen colour. It is built on the LLD stack (Tailwind CSS and shadcn/ui), with custom tokens. **Not** a corporate gradient with rounded cards.

### 4.2 Stack notes

- The LLD fixes the stack: Next.js 16 or later, Tailwind CSS, shadcn/ui, TanStack Query, react-hook-form with zod, Recharts, next-intl and a PWA service worker library (LLD section 2).
- shadcn/ui components are restyled to these tokens and never shipped in their default look.
- **PROPOSED dependencies** (not in the LLD; each needs approval before anything is installed):
  - `motion` for spring and layout animation.
  - `@phosphor-icons/react` as the single icon family. shadcn/ui ships Lucide icons by default, so this replaces them.
- Fallback with no new dependency: CSS transitions plus React `ViewTransition`. Next.js documents this in its view transitions guide (nextjs.org/docs/app/guides/view-transitions) behind the `experimental.viewTransition` flag. Because the flag is experimental, every transition must also work as a plain CSS fade.

### 4.3 Colour tokens

Light is the primary theme and dark is the second. Surfaces are a cool off-white: no cream or beige, no pure white, no pure black.

**Neutrals**

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | #F6F7FA | #101116 | Page background |
| `--surface` | #FCFCFE | #181922 | Panels, sheets, tab bar |
| `--line` | #DADDE6 | #2C2E3A | Decorative dividers only (never the only boundary of a control) |
| `--control-border` | #8A8D9C | #6E7184 | Input and control borders |
| `--ink` | #14151C | #F2F3F7 | Primary text, outlines on flash fills |
| `--ink-soft` | #454757 | #C3C5D1 | Secondary text, and **all text on tinted tiles** |
| `--ink-mute` | #5E6070 | #A2A4B3 | Hints on canvas or surface only, **never on tints** |
| `--focus` | #C93C00 | #FF7A45 | Focus ring |
| `--accent-text` | #C93C00 | #FF8A5B | Links and accent text |

**Flash colours**: flat fills with dark text. No glows, no gradients, no violet.

| Name | Light fill / text on it / tint | Dark fill / text on it / tint | Role (locked across the product) |
| --- | --- | --- | --- |
| Electric Tangerine | #FF5A1F / #14151C / #FFE7DC | #FF7A45 / #101116 / #3A2016 | Brand, primary action, Wardrobe tab |
| Hot Pink | #FF2E93 / #14151C / #FFE0EF | #FF5FAE / #101116 / #3A1A2A | Favourites, Wishlist tab |
| Acid Lime | #C6F432 / #14151C / #F2FCD2 | #D4FF4F / #101116 / #2A3313 | Success, "Brand new" condition band |
| Electric Cyan | #19D3F3 / #14151C / #D9F7FD | #4DE1F7 / #101116 / #123139 | Info, offline banner, Me tab |
| Sun Yellow | #FFD60A / #14151C / #FFF6CC | #FFE14D / #101116 / #36301A | Highlight, locked-setting tooltip, Purchases tab |
| Electric Cobalt | #2F5BFF / #FFFFFF / #E1E8FF | #7C98FF / #101116 / #1B2347 | Outfits and suggestions, Outfits tab |

Rules:

- Each tab has one pop colour. It is used only for that tab's active pill and a light header wash, so the navigation is never a rainbow bar.
- Where a fill alone is under 3:1 against the canvas (tangerine, lime, cyan and yellow in light mode, see 4.4), the element carries a 1.5 px ink outline. The outline is what marks the boundary.
- White text appears only on light-mode cobalt (5.17:1).
- Semantic colours reuse the flash roles. Errors use `--accent-text` together with an icon and text, never colour alone.

**Content colour**

- Item tile background: `color-mix(in oklab, <item colour> 14%, var(--canvas))`. This extends FR-24, which already tints catalogue illustrations in the item's own colour.
- The colour swatch on a tile has a 1.5 px ink ring.
- Outfit cards carry a swatch strip with one segment per slot.
- Colour-family chips use the family reference swatch (FR-29a).

### 4.4 Measured contrast (WCAG 2.x)

Method A: a Python script computing WCAG relative luminance, run on the token file. Method B: axe-core 4.10.2 run in the browser on a rendered specimen page in both themes (see 4.7). All values come from method A unless marked.

| Pair (light) | Ratio | Needed | Pair (dark) | Ratio |
| --- | --- | --- | --- | --- |
| ink on canvas | 16.99 | 4.5 | ink on canvas | 17.00 |
| ink-soft on canvas | 8.55 | 4.5 | ink-soft on canvas | 10.98 |
| ink-mute on canvas | 5.79 | 4.5 | ink-mute on canvas | 7.63 |
| ink on surface | 17.76 | 4.5 | ink on surface | 15.77 |
| ink-mute on surface | 6.06 | 4.5 | ink-mute on surface | 7.08 |
| control border on canvas | 3.08 | 3.0 | control border on canvas | 3.91 |
| focus ring on canvas | 4.75 | 3.0 | focus ring on canvas | 7.29 |
| accent text on canvas | 4.75 | 4.5 | accent text on canvas | 8.11 |
| accent text on surface | 4.96 | 4.5 | accent text on surface | 7.53 |

| Flash (light) | Text on fill | Ink on tint | Fill vs canvas (non-text, needs 3.0) | Flash (dark) | Text on fill | Ink on tint | Fill vs canvas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tangerine | 5.84 | 15.35 | 2.91, ink outline required | Tangerine | 7.29 | 13.55 | 7.29 |
| Pink | 5.26 | 14.87 | 3.23 | Pink | 6.73 | 13.91 | 6.73 |
| Lime | 14.20 | 17.01 | 1.20, ink outline required | Lime | 16.36 | 11.98 | 16.36 |
| Cyan | 10.10 | 16.18 | 1.68, ink outline required | Cyan | 12.06 | 12.43 | 12.06 |
| Yellow | 12.89 | 16.73 | 1.32, ink outline required | Yellow | 14.48 | 11.88 | 14.48 |
| Cobalt | 5.17 (white) | 14.90 | 4.83 | Cobalt | 7.00 | 13.74 | 7.00 |

With the ink outline, every outlined element measures 16.99:1 against the canvas in light mode. Ink-soft on every tint is between 7.49 and 8.98.

**Garment-tint worst case** (method A, ink and ink-soft text on the tinted tile; 22 test colours: the 18 colour families plus pure black, white, yellow and blue, and a neon green):

| Tint | Light, worst ratio | Worst colour | Dark, worst ratio | Worst colour |
| --- | --- | --- | --- | --- |
| 10% | 6.35 | Pure black | 9.03 | Pure white |
| 14% (chosen) | 5.60 | Pure black | 8.12 | Pure white |
| 20% | 4.59 | Pure black | 6.77 | Pure white |

The tint is capped at 16%.

**Finding from method B:** the rendered page showed `--ink-mute` on the Navy and Black tiles at 4.35:1 and 3.78:1, which fails. Browsers mix `color-mix` darker than the script estimated. The rule "text on tints uses ink or ink-soft, never ink-mute" fixed it: after the change, axe reported zero contrast violations in both themes. Method A is still useful for planning, but the browser check is the one that counts.

### 4.5 Typography, icons, shape and copy

| Role | Typeface | Licence and source | Why |
| --- | --- | --- | --- |
| Display and headings | **Bricolage Grotesque** (variable: optical size and weight) | SIL Open Font License 1.1, designer Mathieu Triay (Google Fonts licence page) | Distinctive sans with character and no serif, so it fits both editorial entry pages and app headings |
| UI and body | **Instrument Sans** (variable) | SIL Open Font License 1.1, designers Rodrigo Fuenzalida and Jordan Egstad (Google Fonts licence page) | Precise and very readable at 16 px, with a little warmth |
| Figures, prices, counts, vendor tables | **Geist Mono** | SIL Open Font License 1.1 (github.com/vercel/geist-font) | Tabular figures, needed for dense vendor views |

- The OFL allows bundling the fonts with the GPL-3.0 code. Record the licences beside LOI-3 and LOI-10.
- Fonts are self-hosted through `next/font`, so visitors make no requests to Google. This suits a privacy-first product.
- Not used:
  - Inter.
  - Serif faces in the app UI.
  - Fraunces and Instrument Serif, which the taste skill names as overused.
  - Space Grotesk, which the ui-ux-pro-max database offered as a generic pick.
- Scale: 12 / 14 / 16 / 18 / 22 / 28 / 40 px.
  - Body text is at least 16 px.
  - Line height is 1.5 for body and 1.15 for display.
  - Text lines are no longer than 65 characters.
- Spacing: 4 px base with 8 px steps; section gaps of 16, 24, 32 and 48 px.
- Radius rule, applied everywhere:
  - inputs 8 px;
  - cards and tiles 14 px;
  - sheets 24 px;
  - buttons, chips and the active tab pill are fully rounded.
- Elevation: border first; a 3 px ink offset shadow on hover; no soft drop shadows on light surfaces.
- Icons: Phosphor (PROPOSED), one weight, 24 px. No emoji, and no hand-drawn icon paths. The empty-state scenes are the only custom SVG.
- UI copy (`messages/en.json`):
  - plain labels;
  - no em-dashes;
  - no filler verbs ("elevate", "seamless", "unleash");
  - no scroll cues or version badges;
  - no invented precise numbers.
  - Example figures are labelled "Example".

### 4.6 Media layer: licensed photos and video, found with Firecrawl

**Purpose:** the entry surfaces should feel like an art-directed, high-end site. The taste skill requires real imagery and rules out drawn mockups or text-only heroes.

**Where media goes**

| Use media | Do not use media |
| --- | --- |
| Sign-in and invite hero (short looping video with a poster) | Inside the wardrobe: items show their own photo or a tinted illustration (FR-24) |
| Onboarding steps | Vendor dashboard and admin console |
| About page | Pilot notice, accept-terms and Leave the pilot. Consent screens stay calm, with no persuasive imagery (FR-3, FR-4, FR-66; BRD RK-4) |
| Vendor sign-in panel | |
| Empty-state companions | |

**Sourcing order**

1. The team's own lookbook shoot. The team already has to photograph at least 100 owned garments for FDD 14.4, so this costs little extra.
2. Generated imagery, if a tool is available.
3. Licence-checked free media found with Firecrawl.
4. Labelled placeholder slots.

**Licences checked** (read from each licence page through Firecrawl on 2026-11-05):

| Source | Allowed | Not allowed | Verdict |
| --- | --- | --- | --- |
| Pexels | Free use, attribution not required, can modify | Identifiable people in a bad light; selling unaltered copies; implying endorsement by people or brands; redistributing on other stock or wallpaper platforms; use as a trademark | Usable |
| Unsplash (free licence) | Free commercial use, attribution appreciated | Selling without significant change; compiling images to build a similar or competing service. **Unsplash+ images are a separate paid licence** | Usable, free licence only |
| Coverr | Commercial use, attribution not required | Re-uploading raw files; using brands that appear in the footage; **any AI training**; competing stock services | Usable for the hero video; never as ML data |
| Mixkit | The licence page did not return readable terms | not read | **Not used until the terms are read** |

**Media register.** The user approved the download on 2026-11-05. The files are in `data/media/raw/`, git-ignored; `data/media/MANIFEST.json` records the URLs, SHA-256 hashes and review notes. Each file was opened and inspected after download.

| # | Placement | Source page | Creator | Licence | Downloaded file | Review |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Hero video loop (trim to 8 to 12 s) | pexels.com/video/clothes-hanging-in-a-rack-7764682 | cottonbro studio | Pexels | 1080 x 2048 MP4, 25 fps, 21.4 s, 6.8 MB | **Approved.** Three plain tees on a green rack, grey studio, no people or labels. Vertical, so it suits phones; crop to 16:9 for desktop |
| 2 | Hero poster (planned) | pexels.com/photo/folded-assorted-color-shirts-581087 | Francesco Paggiaro | Pexels | 6000 x 3376 JPEG, 2.7 MB | **Rejected.** Shows "KU LEUVEN" lettering, a woven brand-style tag and a care label; no crop removes all three. **Replaced** by the first frame of video 1: `data/media/derived/hero-poster_from-pexels-7764682` (1080 x 2048, JPEG 75 KB, WebP 35 KB), approved after review |
| 3 | Onboarding "start from popular items" (4:5) | pexels.com/photo/flat-lay-of-clothes-3998648 | Hana Brannigan | Pexels | 3725 x 5215 JPEG, 5.0 MB | **Approved.** Casual flat lay on wood. One tee has a music-note print, not a brand; neck labels are unreadable at web sizes |
| 4 | About page and empty wardrobe (1:1 crop) | unsplash.com/photos/white-t-shirt-in-wooden-closet-JZ7xidLBKck | wang binghua | Unsplash (free) | 7008 x 4672 JPEG, 2.0 MB | **Approved.** A single white tee on a hanger. Calm |
| 5 | Vendor sign-in panel | unsplash.com/photos/a-rack-that-has-a-bunch-of-clothes-hanging-on-it-IZDEH8Qd7Cg | Bennie Bates | Unsplash (free) | 5566 x 3711 JPEG, 1.3 MB | **Approved.** Plain tees in cream, navy, yellow and green against orange; no labels visible. Closest match to the flash palette |

These are source masters. Before shipping, every file is re-encoded to fit the budgets below.

**Rejected**

- `unsplash.com/photos/...-pRmovFmyOOs`: it is Unsplash+, a paid licence.
- Pexels video 9594990: an identifiable person, and not menswear.
- All Mixkit clips: licence terms not verified.
- Any retailer or brand imagery: BRD section 9, AD-8 and FR-24 say product images are never copied.

**After approval**

- Files are self-hosted, never hotlinked, so visitors make no third-party requests.
- Files stay out of git through a manifest and a fetch script. The repo already does this for Fashion-MNIST (`data/recommendation-engine`). It matters here because the repo is public and Pexels does not allow redistribution on other platforms.
- A credits page and an `ASSETS` register (source, creator, licence, date) ship with the site.

**Art direction**

- One colour grade on every photo: the same contrast curve and a slight cool shift, so the flash colours in the UI stand out against calm imagery.
- Fixed ratios: 16:9 hero, 4:5 portrait, 1:1 detail.
- No text baked into images.
- No stock people smiling at laptops.

**Video rules**

- 8 to 12 s, muted, `playsinline`, about 4 MB or less at 1080p, H.264 MP4 plus WebM.
- A poster image always loads first and is the LCP element.
- A visible pause button (WCAG 2.2.2).
- The poster replaces the video under reduced motion and on data-saver or slow connections.
- No audio and no flashing.

**Image rules**

- AVIF or WebP through `next/image`, with explicit width and height.
- The blur-up placeholder is the tile's tint colour.
- Lazy loading below the fold.
- About 600 KB or less of media above the fold on mobile, to protect NFR-3.

**Readability over media**

- Text never sits on a photo or video. Copy lives in its own panel next to the media.
- Where an overlay cannot be avoided, it is a solid tinted panel, and its contrast is checked against the worst sampled frame.

### 4.7 Micro-interactions and transitions

**Rules**

- Animate `transform` and `opacity` only.
- Durations: feedback 200 ms or less; hero 480 ms or less; exits at about 65% of the entrance.
- Easing tokens: `snap` = `cubic-bezier(.2,0,0,1)`, and a `spring` token (stiffness 100, damping 20, or a CSS `linear()` curve).
- Every animation has a reduced-motion version: instant, or a 150 ms fade.
- Animations can be interrupted and never block input.
- No `window` scroll listeners. Use IntersectionObserver, CSS scroll-driven animation, or the motion library's hooks.
- No looping decoration; at most one or two pausable status loops per screen. This overrides the Stitch skill's "every component loops" default, which conflicts with WCAG 2.2.2.

| Moment | Signature motion | Why it exists |
| --- | --- | --- |
| Tab change | An "ink blob" pill stretches from the old tab to the new one in the new tab's pop colour; the icon tilts 6 degrees; content slides 16 px in tab order | Shows where you are and which way you moved |
| Tile to item detail | Shared-element morph: the tile image and swatch grow into the detail hero (React `ViewTransition` name per item, CSS fade fallback) | Keeps you oriented between list and detail |
| Item saved | The swatch dot blooms into the tile tint; neighbouring tiles part on the spring | Confirms the save and shows where the item went |
| Colour picker | The swatch dot overshoots slightly as you drag; the family name ("Navy") rolls in (FR-29a) | Shows the colour family Sparta derived |
| Condition slider | The band label flips like a split-flap board; the thumb loses saturation as the value rises (FR-19) | Links the number to its meaning |
| Suggestions | Three cards deal in with a 60 ms stagger; Swap flips only the changed slot; Accept zips the swatch strip into the Saved list | Shows exactly what changed |
| Wishlist "Bought" | A heart token flies to the Purchases tab and the row collapses | Explains where the item went |
| Empty states | One-shot SVG scene (a hanger swings once) and one action button | Teaches the next step without looping |
| Vendor charts | Bars rise with a stagger; counts tick up in tabular figures; hidden segments show a still hatched pattern | Reveals the data in reading order; never implies a 0 |
| Sheets and toasts | Sheets settle on the spring and can be dragged closed; toasts slide and fade, stay 5 s and pause on hover or focus | Feedback with an escape route |
| Skeletons | A shimmer washed in the tab's tint (static under reduced motion) | Shows loading in the shape of the result |

**Ethical guardrails**

- No reward animation for logging "what I wore" (FR-56: no prompts, streaks or rewards).
- The pilot notice and Leave the pilot screens stay calm and balanced: no confetti, and "I understand and join the pilot" is not given more visual weight than "No thanks" (FR-3, FR-4, FR-66; BRD RK-4).

### 4.8 Readability validation (done for this draft)

| Check | Method | Result |
| --- | --- | --- |
| Contrast, every token pair in both themes | Python script, WCAG luminance | 0 failures among text and control pairs. Four light-mode flash fills are under 3:1 against the canvas, and each gets an ink outline (16.99:1) |
| Contrast on a rendered page | axe-core 4.10.2 in the browser, tags wcag2a, wcag2aa, wcag21aa, wcag22aa | First run: 2 failures (ink-mute on dark tints). After the fix: 0 violations in light and in dark. axe could not compute contrast over the striped media placeholder and left it as "incomplete" |
| Garment-tint worst case | Script, 22 test colours | 14% tint gives at least 5.60:1 (light) and 8.12:1 (dark); the cap is set at 16% |
| Colour blindness | Machado 2009 simulation, minimum OKLab distance between colours | **Flash set:** lime and yellow merge under deuteranopia (distance 1.9), and tangerine and pink are close under tritanopia (2.9). This is acceptable only because every role also carries an icon and a text label, never hue alone. **Okabe-Ito chart palette:** all pairs stay at 7.6 or more, but charts still use direct labels |
| Fonts load | Browser font check on the specimen | Bricolage Grotesque, Instrument Sans and Geist Mono all loaded |
| Mobile width | Specimen at 375 x 812 | No horizontal scroll (scroll width = client width = 375); every visible target at least 24 px; tab targets 48 px |
| Desktop width | Specimen at 1440 x 900, light and dark | Viewed in both themes. Fixes made: rail pill height, and the vendor "Not enough users to display" note moved to its own row so it no longer wraps in a narrow column |

**Not yet validated:** real screens; text-spacing override (WCAG 1.4.12); 200% zoom; screen reader passes; motion on real devices; the media files themselves. These are in the M6 test plan (5.3).

### 4.9 Design-skill checklists (run against the specimen and this specification)

| Checklist | Passed now | Checked in the build |
| --- | --- | --- |
| taste pre-flight | Theme lock, colour-role lock, shape lock, button and form contrast, no Inter, no banned serifs, no em-dashes in UI copy, no scroll cues, no version badges, hero of 4 text elements or fewer, motion has reasons, reduced motion | CTA wrap at desktop, real images in place, Core Web Vitals |
| ui-ux-pro-max pre-delivery | Contrast in both themes, 44 px targets, bottom bar of 5 with labels, labels above fields, colour not used alone, single icon family | Safe areas on real phones, dynamic text size, screen reader order |
| Stitch anti-patterns (vendor and admin) | No emoji, no pure black, no neon glows, no three equal cards, sans serif only, skeletons not spinners | Generated screens, once Appendix A is run in Stitch |

---

## 5. Components, screens and tests

### 5.1 Shared components

| Component | Key props | States (beyond the six in 3.5) | Notes |
| --- | --- | --- | --- |
| `ItemTile` | `item`, `selected`, `onOpen` | archived, never worn, favourite, offline-queued | Tint from item colour (4.3); name and family in ink and ink-soft only |
| `FilterBar` | `filters`, `onChange` | one or more active, similar-colour active | All FR-11 filters; serialises to the URL (LLD 9.2) |
| `ColourPicker` | `value`, `onChange`, `sourceImage?` | eyedropper unsupported (canvas fallback) | `react-colorful` per LLD 9.4; live family name (FR-29a) |
| `ConditionSlider` | `value?`, `onChange`, `clearable` | empty (not rated) | Band label from `lk_condition_band` (FR-18, FR-19) |
| `OutfitSlotBuilder` | `slots`, `onPick` | slot empty, item archived ("needs attention", FR-51) | Slot map from FDD 14.1 |
| `SuggestionCard` | `outfit`, `reason`, `onAccept`, `onSwap`, `onReject` | swapping | One-line reason (R8); swatch strip |
| `SwapSheet` | `choices`, `onPick` | no valid choice | Most similar first (FDD 14.2) |
| Gate pages and `ConsentModal` | `version`, `onAccept`, `onDecline` | stale version (reload message, LLD 9.1) | Calm layout, buttons of equal weight |
| `HiddenSegment` | `reason` | none | Hatched, "Not enough users to display", never 0 (FR-76, FR-80) |
| `ChartWrapper` | `series`, `labels`, `summary` | loading, error, empty | Recharts; direct labels; a text summary for screen readers; data table toggle |
| `ReceiptDraft` | `lines`, `onConfirm` | extracting, failed | Nothing saved until confirmed (FR-42); masked values (FR-47) |
| `OfflineBanner`, `EndOfPilotBanner` | `queued`, `endDate` | none | Cyan role; links to export and Leave the pilot (FR-69) |
| `EmptyState`, `Skeleton`, `ErrorState` | `kind`, `action` | none | One action each |

### 5.2 Screen specs (wireframe level)

**Sign-in and invite page (taste)**: an asymmetric split. At 768 px and over, the copy panel takes 55% and the media 45%; on mobile the media goes below the copy.

```
+--------------------------------+---------------------------+
| Every piece you own,           |  [hero video, poster      |
| in one place.                  |   first, pause button]    |
| Free wardrobe for men in the   |                           |
| pilot. (under 20 words)        |                           |
| [Sign in]  [How the pilot works]                           |
+--------------------------------+---------------------------+
Supported countries line (FR-8) sits below the hero.
```

**Wardrobe (ui-ux-pro-max)**

```
Wardrobe                         [search /]  [filters f]
[summary strip: 84 items, by category] (FR-17, Could)
[tile][tile][tile]   2 columns at 375 px, 4 at 768, 6 at 1024+
[tile][tile][tile]
                                   (+) Add item  <- primary
[Wardrobe][Outfits][Wishlist][Purchases][Me]  <- bottom bar
```

**Outfit suggestions (ui-ux-pro-max)**

```
Suggest an outfit
Occasion: (Casual)(Work)(Formal)(Party)(Sport)(Date)(Travel)
Season: Winter (from date and hemisphere)
+---------------------------+
| Work, cool weather        |
| [top][layer][bottom][shoe]|
| ============ swatch strip |
| "Layer works for cool weather; navy and grey are neutral."
| [Accept] [Swap] [Reject]  |
+---------------------------+  x up to 3, dealt in with a stagger
Thin wardrobe -> "You need a bottom for this occasion" + links (FR-54)
```

**Vendor dashboard (Stitch)**

```
[rail] Dashboard | Gaps | Reports | Product feed | Account
Filter (one at a time): Size | Season | Price band | Region (FR-77)
Ownership mix ---------------------------------------------
Shirts    ##############   45
Chinos    ##########       30
Kurtas    //////////////   Not enough users to display
Purchase trend (monthly line) | Wishlist trend (monthly line)
Condition spectrum (bands, sequential single hue)
Counts rounded to 5. Segments under 10 users hidden.
```

### 5.3 Test plan (aligned with LLD section 11)

| Layer | Tool (from the LLD) | Added by this plan |
| --- | --- | --- |
| Database | pgTAP against local Supabase | none; keep the LLD list (RLS, suppression, rate limit, legal controls) |
| Shared logic | Vitest | Colour-family golden vectors shared between TypeScript and SQL; token contrast script runs in CI and fails the build if any pair drops below its threshold |
| Web components | Vitest and Testing Library | The six states (3.5) for each shared component; reduced-motion snapshots |
| End to end | Playwright against `next start` and the worker | Every flow in 3.1 at 375 x 812 and 1440 x 900; keyboard-only run of first login and add item; theme switch |
| Accessibility | axe in Playwright | Run the wcag22aa tags as well as wcag21aa; both themes; text-spacing override and 200% zoom checks |
| Performance | Lighthouse CI on a 500-item account | Media budget check on the sign-in page (LCP is the poster) |
| Engine | FDD 14.4 | About 90% or more on Fashion-MNIST test pictures; at least 100 team photos; 50 suggestions from at least 5 synthetic wardrobes, about 80% or more acceptable |

---

## 6. Effort, open decisions and risks

### 6.1 Effort

**Capacity basis:** 3 people x 5 days x 6 build weeks = 90 person-days gross. Assume about 60% is available (assumption A-1), giving about 54 person-days.

Sizes are a judgement from the number of FRs and components each milestone carries:

| Size | Person-days |
| --- | --- |
| S | 3 to 5 |
| M | 6 to 9 |
| L | 10 to 12 |

| Milestone | Size | Person-days (judgement) | Basis |
| --- | --- | --- | --- |
| M0 | M | 7 | Small CNN on public data plus evaluation; mostly waiting on training runs |
| M1 | L | 12 | Schema, RLS and auth gates carry the privacy promise; most pgTAP work lands here |
| M2 | L | 10 | Many FRs, mostly standard CRUD and filters |
| M3 | M | 8 | Worker, two handlers, redaction, draft UI |
| M4 | M | 9 | Rules package, ranking, property tests, style review time |
| M5 | L | 11 | Suppression logic and vendor functions need careful tests |
| M6 | S | 5 | Test passes, rehearsals, legal walkthrough |
| **Total** | | **62** | About 8 person-days over the 54 available |

**Ways to close the gap**, in order:

1. Defer Could items: FR-17, FR-26, FR-43, FR-56 and FR-57.
2. Ship the media layer with placeholders and add the files in pilot week 7.
3. Use the CSS-only motion fallback (4.2) instead of the motion library.

### 6.2 Open decisions that block work

| ID | Decision | Blocks | Owner |
| --- | --- | --- | --- |
| FOI-9 | Ranking weights and the 50-suggestion review | Opening with suggestions on (M4) | Arpan Shah |
| FOI-8, FOI-10 | Slot map; garment-to-sub-type table | M4; M3 suggestion mapping | Arpan Shah |
| FOI-6 | First storefront sources | Seed catalogue (M1, M2) | Delivery team |
| OI-1 | Default sharing state in the shipped product | Not the pilot; the post-pilot release | Product owner |
| OI-3 | Professional legal review | Any public, commercial or wider launch | Product owner |
| OI-4 | Whether participant data may improve the engine | Any learning after the pilot | Product owner |
| LOI-5 | Email provider | First invitation | Delivery team |
| LOI-9 | Garment suggestion go or no-go | FR-23a on or off at opening | Product owner and SA |
| Done | Media candidate list approved and downloaded 2026-11-05; 4 of 5 passed review (4.6) | none | Product owner |
| New | Approve the PROPOSED dependencies (4.2) | Motion layer and icon family | SA |

### 6.3 Risks (new, specific to this plan)

| ID | Risk | Mitigation |
| --- | --- | --- |
| IP-1 | Flash colours tire the eye or compete with garment colours | One pop colour per tab; flash used as small fills and tints; garment tint capped at 16%; style specialist reviews screens |
| IP-2 | Motion hurts performance on low-end phones (NFR-3) | Transform and opacity only; budgets in 4.7; Lighthouse CI; CSS-only fallback |
| IP-3 | A media licence is misread or changes | Licence text recorded on the day it is read; manifest outside git; credits page; replace with team photos when possible |
| IP-4 | Experimental view transitions break in a Next.js update | Plain CSS fade fallback for every transition |
| IP-5 | Flash colours merge for some colour-blind users (4.8) | Icon plus text label on every role; never hue alone |
| IP-6 | Effort exceeds capacity by about 8 person-days (6.1) | Deferral order in 6.1 |

---

## Assumptions and conflicts

### Assumptions

| ID | Assumption |
| --- | --- |
| A-1 | About 60% of each person's time is available for the build, because the team is also delivering ANCP coursework. |
| A-2 | The coding split is: Prashanth on database, worker and CI; Arpan on taxonomy, rules, style review and UI polish; Ambarish on acceptance, vendors, recruitment and the legal walkthrough. BRD section 5 names roles but not this split. |
| A-3 | Currency is pre-filled from the country at onboarding. FR-6 pre-fills only the hemisphere. |
| A-4 | Tap counts in 3.1 are estimates from the FDD fields, not measurements. |
| A-5 | Media sizes in 4.6 are the downloaded source masters; shipped sizes will be smaller after re-encoding. |

### Conflicts (the documents win)

| ID | Conflict | How this plan handles it |
| --- | --- | --- |
| C-1 | BRD section 12 is a 12-week timeline that includes the build, with the pilot opening in weeks 5 to 6. BRD section 4.1 calls the pilot 3 months. LLD section 14 shows the pilot in weeks 7 to 12. | Uses BRD for the calendar and LLD for the build order. **Open question for the product owner:** is the pilot 3 months from opening, or weeks 7 to 12? |
| C-2 | BRD weeks 3-4 list the consent flow and outfit builder; the LLD puts consent in M1 and the builder in M4. BRD weeks 5-6 list receipt OCR; LLD M3 is weeks 4-5. | Follows the LLD. |
| C-3 | NFR-4 and LLD section 11 target WCAG 2.1 AA; the request asked for 2.2 AA. | Designs to 2.2 AA, which is stricter; 2.1 AA stays the documented floor. |
| C-4 | The request said "admin console last", but FR-8 and FR-9 need invitations and supported countries from M1. | Builds a minimal admin slice in M1 and the rest in M5. |
| C-5 | BRD and README describe four item-entry methods; FDD 5.3 has five, including barcode (FR-26, Could). | Covers all five; barcode is marked Could. |
| C-6 | The FDD does not define keyboard shortcuts. | All shortcuts are PROPOSED and WCAG 2.1.4-safe. |
| C-7 | The taste and Stitch skills say "one accent, no neon"; the user asked for really flashy colours. | Flat flash fills with ink text, one pop colour per tab, roles locked, no glows or gradients. The user's request wins. |
| C-8 | The Stitch skill asks for looping micro-interactions on every component; ui-ux-pro-max and WCAG 2.2.2 limit continuous motion. | No decorative loops; at most two pausable status loops per screen. |
| C-9 | The LLD names shadcn/ui, which ships Lucide icons; the taste skill prefers Phosphor. | Phosphor is PROPOSED, pending SA approval. |
| C-10 | "Photos and videos from the internet" against BRD section 9, AD-8 and FR-24, which forbid copying product images. | Only explicitly licensed free media, never retailer or brand imagery, self-hosted, kept out of git, with user approval before download. |
| C-11 | The ui-ux-pro-max design-system search proposed a rose and gold palette with Fredoka and Nunito. | Not used: it did not fit menswear or the taste skill's rules. |

---

## PROPOSED additions

| # | Addition | Reason |
| --- | --- | --- |
| P-1 | Left rail at 1024 px and over for the consumer app | Same five places on wide screens; adaptive navigation |
| P-2 | Admin rail grouped as People, Data, Operations | Eight destinations are easier to scan in three groups |
| P-3 | Keyboard shortcuts (3.2) and a setting to turn them off | Faster desktop use; WCAG 2.1.4 |
| P-4 | Mobile gestures with button equivalents (3.3) | Speed on phones without hiding actions |
| P-5 | Garment-tinted tiles for every item, not only catalogue items | Extends FR-24; colour comes from the user's own clothes |
| P-6 | Media layer (4.6) with a credits page and an `ASSETS` register | Premium entry pages, with licences recorded |
| P-7 | A media sourcing rule placed next to `legal/DATA-SOURCING-POLICY.md` (this plan does not edit the legal files) | Covers licensed media the way the existing policy covers catalogue data |
| P-8 | `motion` and `@phosphor-icons/react` dependencies | Spring and layout animation; one icon family |
| P-9 | Token contrast check in CI | Stops a later colour change from breaking readability |
| P-10 | axe wcag22aa tags in Playwright | Matches the 2.2 AA target (C-3) |

---

## Appendix A: Stitch-ready DESIGN.md (vendor portal and admin console)

This text is written in the stitch-design-taste format. It can be pasted into Google Stitch (labs.google/stitch) to generate vendor and admin screens. **It has not been run in Stitch yet.** It can move to its own file later.

```markdown
# Design System: Sparta Vendor Portal and Admin Console

## 1. Visual Theme and Atmosphere
A calm, dense, desktop-first analytics workspace. Cockpit density (8), predictable
symmetric layout (3), restrained motion (3). It belongs to the same family as the
bright Sparta consumer app, but colour is reserved for data and status. The mood is
a well-lit studio desk: cool off-white surfaces, ink-dark type, sharp hairlines.

## 2. Color Palette and Roles
- Studio Canvas (#F6F7FA): page background
- Paper Surface (#FCFCFE): panels and tables
- Hairline (#DADDE6): row dividers, decorative only
- Control Edge (#8A8D9C): input and control borders (3.08:1 on canvas)
- Ink (#14151C): primary text (16.99:1 on canvas)
- Ink Soft (#454757): secondary text (8.55:1)
- Ink Mute (#5E6070): hints on canvas or surface only (5.79:1)
- Ember Accent Text (#C93C00): links, focus ring, the only accent in chrome (4.75:1)
- Electric Tangerine (#FF5A1F, ink text, 1.5px ink outline): the single primary button
- Chart series (Okabe-Ito): #0072B2, #E69F00, #009E73, #D55E00, #56B4E9, #CC79A7,
  #F0E442 (always with a direct label and outline), #595959
- Hidden segment: hatched Hairline pattern with the text "Not enough users to display"
Dark mode: Canvas #101116, Surface #181922, Ink #F2F3F7, Ink Soft #C3C5D1,
Accent Text #FF8A5B.

## 3. Typography Rules
- Display and headings: Bricolage Grotesque, weight 600-700, tight tracking, 22-28px
- Body and UI: Instrument Sans 14-16px, line-height 1.5, max 65 characters per line
- Numbers, counts, prices, dates: Geist Mono with tabular figures, always
- Banned: Inter, any serif, system fallback as the visible face

## 4. Component Stylings
- Buttons: one filled primary per screen (tangerine, ink text, ink outline, fully
  rounded); secondary is an outline. Press moves 1px down. No glows.
- Tables: no cards; border-top dividers between groups only, not on every row;
  sortable headers with aria-sort; sticky header.
- Charts: direct labels, legend next to the chart, a text summary, a data table toggle.
- Filters: one filter at a time; choosing a second replaces the first.
- Inputs: label above, error below in Ember Accent Text with an icon, 8px radius.
- Loaders: skeletons shaped like the final table or chart. No circular spinners.
- Empty and suppressed states: plain sentence plus one action; never show 0 for a
  hidden segment.

## 5. Layout Principles
Left rail with labels (Dashboard, Gaps, Reports, Product feed, Account). Content in a
12-column grid, max width 1400px. Collapse to a single column below 768px. No
overlapping elements. No three equal cards in a row.

## 6. Motion and Interaction
Bars rise once with a 40ms stagger, counts tick up once, then everything is still.
Transitions 150-200ms, ease-out. Everything static under prefers-reduced-motion.
No looping animation.

## 7. Anti-Patterns (Never)
No emoji. No pure black. No neon glow. No gradient text. No purple-to-blue gradients.
No three equal cards. No invented precise numbers: label example data "Example".
No filler words such as "elevate" or "seamless". No em-dashes. No custom cursor.
No 0% for a suppressed segment. No individual user data anywhere.
```
