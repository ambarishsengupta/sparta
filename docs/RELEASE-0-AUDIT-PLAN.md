# Sparta: Release 0 Audit Plan

| Field | Value |
| --- | --- |
| Document | Audit plan for Release 0 (stakeholder demo), the release before the MVP |
| Version | 0.1 (draft for review) |
| Date | 2026-11-11 |
| Drafted for | Ambarish Sengupta (Product Owner) |
| Reviewers | C. Prashanth (Solution Architect), Arpan Shah (Style Specialist) |
| Traces to | BRD v1.3, FDD v1.4, HLD v1.3, LLD v1.3; legal pack in `legal`; GitHub milestones "Release 0 (stakeholder demo)" and "Release 1 (MVP)" |
| Status | Draft. This is a plan only: no audit step has been run yet, apart from the checks in section 2. |

## 1. Purpose and the questions the audit answers

Release 0 is the stakeholder demo. Release 1 is the MVP that opens the pilot. This plan covers Release 0 only, in two parts:

| Part | Question | Answer the audit must give |
| --- | --- | --- |
| A. What is built | Is every work order marked closed really done, to the design, and reproducible by someone who did not build it? | A verdict for each of the 41 closed work orders, and a findings register |
| B. What is still to be built | Are the 8 open Release 0 items specified, sized, unblocked and correctly placed in Release 0? | A ready or not-ready verdict for each open item, and a scope decision for the demo |

The two parts together feed one decision by the product owner: **go, go with disclosed limits, or no-go** for the Release 0 checkpoint (issue 63).

Out of scope for this audit: carrying out the Release 1 items (security review, penetration test, style review G9, 100-photo evaluation, receipts, hardening). The audit only checks that deferring each of them is safe for a demo (section 6.4).

## 2. Starting position (checked on 2026-11-11 against the GitHub remote)

These are facts, not audit results. They decide how the audit has to start.

### 2.1 Release 0 in the tracker

49 issues carry the Release 0 milestone: 41 closed, 8 open. Release 1 has 16 issues, all open.

| Slice | Subject | Work orders | Closed | Open |
| --- | --- | --- | --- | --- |
| R0 | Workspace, gates and goals; taxonomy package; colour family function | WO-0001, 0002 | 2 | 0 |
| R1 | Recommendation engine: rules, scoring, ranking, swap choices, synthetic wardrobes, review pack | WO-0003 to 0008 | 6 | 0 |
| R2a | Schemas, lookups, core tables, RLS, consent gate, invitations, onboarding (database) | WO-0040 to 0042 | 3 | 0 |
| R2b | Supabase client, sign-up and sign-in, route gating, acceptance, pilot notice and onboarding screens | WO-0050 to 0053 | 4 | 0 |
| R2c | Export and delete functions, pages, Leave the pilot | WO-0060 to 0062 | 3 | 0 |
| R3 | App scaffold, repository, wardrobe and outfits screens | WO-0020 to 0022 | 3 | 0 |
| R4 | Pairing prior pipeline, learned layer, Complete the look, Wardrobe unlock, feature switches | WO-0010 to 0014 | 5 | 0 |
| R5a | Garment model: reader, preprocessing, class map, training, evaluation, export, model card | WO-0030, 0031 | 2 | 0 |
| R5b | Jobs, storage, worker role, signed-URL route, storage purge, worker service, add by photo | WO-0070 to 0075 | 6 | 0 |
| R6a | Receipt tables, purchases, prices with conversion, wishlist bought, plan purchases | WO-0080 to 0082, 0092 | 4 | 0 |
| R6b | Catalogue tables, take-down, audit log, grants; category illustrations; catalogue picker | WO-0083 to 0085 | 1 | 2 |
| R6c | Collector (fetch, robots, rate limit, mapping, storage); catalogue admin; barcode lookup | WO-0086 to 0088 | 0 | 3 |
| R7 | Aggregation and vendor portal | none yet ("to be specced") | 0 | 1 |
| Demo | Restyle of the whole app, design fixes, demo data pack and script, checkpoint walk-through | WO-0093, 0094, 0097 | 2 | 2 |
| **Total** | | | **41** | **8** |

### 2.2 What the remote shows

| # | Fact | Why it matters for the audit |
| --- | --- | --- |
| S-1 | None of the Release 0 work is on GitHub. No branch contains `workflow/` (work orders, evidence, retros, demo script), `packages/`, `supabase/`, `services/worker/` or `ml/`. `main` holds documents only, and the README says there is no application code. | The audit cannot start until the work is somewhere it can be read. This is step 0 (section 4). It is also a risk in itself: 41 work orders of work exist in one place. |
| S-2 | All 65 issues were created on 2026-11-10 within about 20 minutes. Closed issues were closed seconds after creation, and none links to a pull request or a commit. | The tracker mirrors a local ledger. A closed issue is a claim, not evidence. |
| S-3 | The only application code on the remote is a web shell on two stacked, unmerged branches (PR 10, then PR 11 on top of it). It runs on sample data and has no backend dependency. Its CI job (lint, types, contrast, build, Playwright with axe) is green. | It is not the Release 0 app. The audit must find out how it relates to WO-0020 (app scaffold) and WO-0093 (restyle). |
| S-4 | Five pull requests are open and unreviewed: 7 and 8 (the same D2/D3 evidence branch against two bases; the base of 7 is already merged), 9 (implementation plan), 10 and 11 (web shell). | Work is piling up outside `main`. `main` is not a protected branch. |
| S-5 | Six slices needed a fix loop after a failed check (R1 twice, R2a, R2b, R2c, R3, R6a). Named failures include an open redirect, a loosened no-network scan, an untested proxy, and tests with gaps. | The checks do catch things. The audit must confirm each failure was really fixed and that no test was weakened to pass. |
| S-6 | A dedicated security review of WO-0070 to 0083 was deferred to Release 1 by the owner (issue 67), yet WO-0070 to 0075 and 0080 to 0083 are closed inside Release 0. A known residual risk (MAJOR-1, issue 75) and a penetration test of the secret-key routes (issue 66) are also in Release 1. | Release 0 contains storage, signed-URL, admin and deletion code that has not had its security review. That is acceptable only if the demo holds no real personal data and is not open to the public. |
| S-7 | R4 built a learned layer, "Complete the look" and "Wardrobe unlock" from a pairing prior trained offline on the H&M data. The BRD lists "wishlist suggestions to complete a look" as out of scope (section 4.2), and the H&M competition rules limit use to non-commercial research and forbid redistribution. The features are held off by gate G7 until decision OI-5 (issue 68), which is not in the BRD's open items. | Possible scope and licence drift. The audit must confirm the switches are off by default and that no H&M-derived file is in anything that gets published. |
| S-8 | Issue 76 lists places where the build differs from the HLD and LLD: WebP or JPEG, polling or Realtime, Python 3.13 (LLD says 3.11), HMAC or bearer token, GTIN length, export format. WO-0030 is an IDX reader, while the README and BRD describe Fashion-MNIST CSV files. | The design documents on `main` no longer describe what was built. |
| S-9 | Two numbering schemes are in use: slices R0 to R8 in the tracker, and milestones M0 to M6 in LLD section 14 and the draft implementation plan (PR 9). | Without a mapping, requirement coverage cannot be checked. |
| S-10 | The web shell in PR 11 can show H&M product photos from a local, git-ignored folder, with demo prices and ratings. FDD FOI-4 and FR-24 say catalogue items show tinted category illustrations and source images are not copied. WO-0084 and 0085 (illustrations and picker) are still open. | The demo must not show a catalogue the design forbids. |
| S-11 | R6c (collector) is in Release 0, but the decision on real catalogue sources (O1, O2, issue 71) and the collector secret (O6, issue 74) are in Release 1. R7 is in Release 0 with no spec. It corresponds to LLD milestone M5, the largest one. | These two are the main threats to the Release 0 date. |

## 3. Audit rules

| Rule | Meaning |
| --- | --- |
| Independent | No work order is audited by the person or agent session that built or checked it. The SA signs off database policy and security findings, the style specialist signs off engine findings, and the product owner signs off scope findings. |
| Re-run, do not re-read | Evidence in `workflow/evidence/` is a pointer. A check counts only when the auditor reruns it from a clean clone at the frozen commit (section 4) and sees the same result. |
| Frozen target | The audit runs against one commit SHA. Work that continues during the audit goes to a separate branch and is audited as a difference later. |
| No fixes inside the audit | The audit writes findings. Fixes go through new work orders and the normal checks, so the audit does not mark its own work. |
| Every finding is recorded | One row per finding: ID, work order, requirement, severity, evidence (command and output, or file and line), owner, decision. |
| Risk decides depth | Privacy, security and data-right paths are checked in full. Presentation code is sampled. |

**Verdict for each closed work order**

| Verdict | Meaning |
| --- | --- |
| Verified | Rerun passes; the code matches the work order and the design |
| Verified with findings | Works, with findings of Major or lower |
| Not verified | Evidence missing, not reproducible, or the code is not in the frozen commit |
| Failed | Does not do what the work order or the requirement says |

**Severity of a finding**

| Severity | Meaning | Effect on Release 0 |
| --- | --- | --- |
| Blocker | A closed claim is false on a path the demo uses; personal data, a secret or licensed data would be exposed; a privacy rule is not enforced | No-go until fixed |
| Major | Requirement missed or design departed from without a recorded decision; a test that cannot fail; a gate bypassed | Fix, or disclose in the demo and move to Release 1 with an owner |
| Minor | Works, but departs from conventions or documents | Release 1 |
| Note | Observation or improvement | Backlog |

## 4. Step 0: make the work auditable

Nothing in Part A can run before this.

| Step | Action | Done when |
| --- | --- | --- |
| 0.1 | Before anything is pushed to the public repository, scan the local workspace: secret scanner over the full history; search for `.env` files, keys and connection strings; search for H&M files, Fashion-MNIST files, team photos, receipt images and any real personal data; check file sizes | Scan output is saved, and every hit is removed from history or confirmed as a false positive |
| 0.2 | Push the workspace to a branch (for example `release-0`), including `workflow/` with work orders, evidence, retros, specs and the demo script | The branch is on the remote and a fresh clone contains every path named in the issues |
| 0.3 | Freeze: tag the commit (`release-0-audit-1`) and record the SHA in the findings register | Tag exists |
| 0.4 | Record the environment: Node, Python, Supabase CLI and Docker versions; the commands that run every gate | One file a newcomer can follow without help |
| 0.5 | Tidy the remote so the audit has one baseline: close PR 7 (duplicate of 8); decide whether PRs 9, 10 and 11 merge, are replaced by the Release 0 branch, or close | Each open PR has a written decision |

If step 0.1 finds a secret that was ever pushed or shared, treat it as an incident under `legal/INCIDENT-RESPONSE-PLAN.md` and rotate it before continuing.

## 5. Part A: audit of what is built

Nine workstreams. A1 and A2 come first, because the others depend on them. A3 to A9 can run in parallel.

### A1. Ledger reconciliation

Goal: one table that links every claim to its proof.

- Build the matrix: issue, work order, slice, spec section, commits, files changed, tests added, evidence file, check results (Spec QC, Model QC, Security review, critic), fix loops.
- Confirm that each of the 41 closed work orders has a work-order text, at least one commit and at least one evidence file in the frozen commit.
- List work with no issue and issues with no work. Known gaps to explain: WO-0095 and WO-0096 (the Demo slice jumps from 0094 to 0097), and code in the workspace that no work order covers.
- List every gate (G1 to the last), its definition, whether it is automatic or a human decision, and its current state. G7 and G9 are known; the rest must be read from `workflow/`.
- Map slices R0 to R8 to milestones M0 to M6 and to the BR and FR ranges, so that A3 has one scale.

Output: the reconciliation matrix. A work order with no commit or no evidence is "Not verified" at once.

### A2. Clean-clone reproducibility

Goal: prove the build and the checks run for someone else.

- Fresh clone of the frozen commit on a machine that has never held the project. Follow only the written instructions.
- Run in order: install; lint, format and type check; Vitest; local Supabase start, migrations from zero, pgTAP; worker tests (pytest); garment model card check; build; Playwright with axe; secret scan; dependency audit.
- Record for each: pass or fail, duration, count of tests, count of skipped tests.
- Compare with LLD section 12.1 (`ci.yml`). Record which steps exist only locally and which run in GitHub Actions. Today only the web job runs in Actions.
- Run the full suite three times and record any test that changes result.

Output: a reproducibility report. A step that cannot be run from the instructions is a Major finding; a failing gate on a closed work order is a Blocker for that work order.

### A3. Requirement traceability

Goal: know which requirements Release 0 really covers.

- For every BR and FR in the range of a closed slice, record: implemented (file), tested (test name), demonstrated (step in the demo script), or not in Release 0 (with the issue that carries it).
- Check each row of FDD section 17 (acceptance criteria) that falls inside Release 0. LLD section 11 says each maps to a test whose name carries the FR number; confirm by searching test names.
- Mark each "Must" requirement that is neither built nor carried by an open issue. These are silent gaps.
- Check the open design items that Release 0 work depends on: FOI-8 (slot map), FOI-9 and LOI-11 (ranking weights), FOI-10 (garment class map), LOI-2 (colour swatches), LOI-8 (invitation hook). For each: closed, or the build uses a placeholder, and where the placeholder is.

Output: the traceability matrix, with a coverage figure per slice.

### A4. Technical audit, slice by slice

For each slice: read the work orders, read the code, rerun its tests, then try the checks below by hand. Depth is full for R2a, R2b, R2c and R5b, and for the database parts of R6a and R6b; sampled elsewhere.

| Slice | Checks beyond rerunning the tests |
| --- | --- |
| R0 | Taxonomy JSON is the single source for TypeScript, Python and the database seed (LLD section 3 rule). Colour family golden vectors in LLD section 11 pass in both TypeScript and SQL, and the two give the same answer for 200 random colours. The gate scripts fail when given a deliberately broken input. |
| R1 | Rules R1 to R8 each have a fixture that fails when the rule is removed. Determinism (FR-58): same input twice, byte-identical output. No network call in `suggest` or `swapChoices` (FR-59), checked by a scan that has not been loosened (see A6). Property test on 200 wardrobes. Thin wardrobe behaviour. WO-0008 was "fix loop 2, last": confirm the layer defect is fixed, not accepted. Ranking weights: placeholder or agreed (FOI-9). |
| R2a | Migrations apply from zero in the order in LLD section 2. Every `app` table has RLS on and a policy. Run the LLD section 11 database list by hand for a sample: user A cannot read B; no consent gives no rows; a consumer cannot change `role`, `age_confirmed` or `deleting`; an uninvited email is refused (FR-8); an unsupported country gives no rows (FR-9); a stale document version is refused (FR-68). `security definer` functions have a fixed `search_path`. |
| R2b | Gate order in `proxy.ts` matches LLD 9.1. Open redirect from WO-0053: try five crafted `next` values. The proxy now has tests. Session cookies as in LLD section 10. "Backend switch": find what the app runs on when the switch is off, and which mode the demo uses. |
| R2c | Export contains every user table and matches the documented format (issue 76 lists export format as a drift point). Delete removes rows and storage objects, writes `ops.deletion_log`, removes the invitation, and sign-in then fails (FR-63, FR-64, FR-66). MAJOR-1 is recorded with an owner. |
| R3 | The repository layer is the only path to data (no direct client calls in components). Wardrobe filters and sorts against FR-11 and FR-12. Outfits screen against FR-50 to FR-55. Empty, loading and error states exist for each screen. |
| R4 | Every learned feature is off by default and cannot be turned on from the browser. With switches off, engine output is identical to R1 output. No H&M-derived file (prior, embeddings, model) is in the frozen commit or in any build output. The pipeline never reads participant data (BR-28, BR-52). "Complete the look" and "Wardrobe unlock" are not reachable in the demo unless the owner decides OI-5. |
| R5a | Training reruns from the public files with a fixed seed and gives the accuracy on the model card (about 90% or more on the 10,000 test pictures, BRD section 11). ONNX file hash equals the model card. Class map values all exist in the taxonomy. Licences recorded (LOI-10). Team-photo evaluation is not done (issue 70): the card must say so. |
| R5b | `worker_role` can claim a job and cannot read `app.items`. Two workers never claim the same job. Signed-URL route rejects a bad or replayed signature, and a path that belongs to another user (WO-0075). Uploaded images keep no EXIF. The Supabase secret key appears only in the route handlers listed in LLD section 6. Storage purge on deletion leaves nothing behind. With `GARMENT_GUESS_ENABLED=false` the photo job still completes. |
| R6a | Money is `numeric(12,2)` with a currency on every amount. Conversion is display only and the original currency is kept (BR-12). Wishlist "bought" creates one purchase, once. The exchange-rate table works with no provider chosen (issue 72): find what the demo shows. Receipt tables exist with no receipt flow: confirm nothing in the app points at them. |
| R6b (closed part) | Catalogue tables, take-down and audit log match LLD 4.8. `collector_role` can upsert a source row and cannot see vendor or user rows. Vendor rows are isolated by vendor (FR-93). |
| Demo (closed part) | WO-0093 restyled every existing screen: check each against the design tokens, in light and dark, at 375 and 1440 pixels wide. axe passes on every screen, not only the shell. Contrast script covers the new tokens. Critic findings from WO-0094 are all closed. |

Output: one scorecard per slice (verdict per work order, findings, tests run, coverage).

### A5. Security and privacy

The dedicated review is deferred (issue 67). This workstream is the minimum needed to show the app safely, not a replacement for it.

- Secrets: scanner over the full history; `.env.example` holds names only; no key in client bundles (search the built output for `sb_secret`, connection strings and the HMAC key).
- Authorisation: with two test users and one vendor, try every route handler and every table through the public API as the wrong user. Record each result.
- The four secret-key routes named in issue 66 (`/api/worker/signed-urls`, `/api/account/purge-storage`, `/api/receipts`, `/api/admin`): who can call each, what stops everyone else, and whether the demo deployment exposes them.
- Content-Security-Policy header present; no `dangerouslySetInnerHTML`; logs carry IDs only (LLD section 10).
- Consent path: nothing is stored before the notice is accepted; "No thanks" leaves only export, Leave the pilot and sign out (FDD section 17).
- Demo data: every row is synthetic and generated by a seeded script. No real person, no real receipt, no team photo. This is what makes S-6 acceptable.
- Demo environment: local or hosted; if hosted, which project, who can reach it, and whether sign-up is closed.
- Dependencies: no high-severity advisory.

Output: a security and privacy memo with a clear statement of what was and was not checked, so nobody reads it as the full review.

### A6. Process audit: did the checks work?

- For each of the six fix loops, read the failed check, the fix and the re-check. Confirm the fix changed code, not only tests. For R2b, confirm the no-network scan was restored to its strict form.
- Mutation spot-check: in five high-risk places (an RLS policy, the consent gate, the invitation check, the redirect check, rule R1), break the code on purpose and confirm a test fails. A test that still passes is a Major finding.
- Count skipped, pending and "expected failure" tests, and tests with no assertion.
- Check that maker and checker were different sessions for each work order, and that no checker result was overridden without a recorded reason.
- Read the retros: every action they name is either done or carried by an issue.
- Check the loop limit ("fix loop 2, last"): what happens when a slice fails after the last loop, and whether that ever happened.

Output: a short report on whether a closed work order can be trusted in future without a full audit.

### A7. Scope and document drift

- Compare what was built with BRD section 4 (in scope, out of scope). Known candidates: the R4 features (S-7), the popular-items grid with prices and ratings (S-10), "delight" effects, and theme switch. For each: in the documents, a PROPOSED item with a decision, or unrecorded.
- Turn issue 76 into a table: document says, build does, which is right, who decides. Add any further drift found in A4 (for example CSV or IDX, Python version).
- Check LLD section 16 (LD-1 to LD-8) and LOI-1: has the SA confirmed them? The build depends on them.
- Decide where OI-5 lives. It should be in the BRD open items if it is a product decision.
- Check the README status paragraph and repository tree against reality. Both are out of date as soon as the Release 0 branch is pushed.

Output: a drift register. Each row ends in one of: change the document, change the build, or record an accepted departure.

### A8. Data, licence and legal

- H&M: no file from the dataset, and nothing derived from it that the rules treat as redistribution, in the repository, the build output or the demo deployment. Photos shown in a demo to people outside the course: check against the competition rules before doing it.
- Fashion-MNIST: files are git-ignored; checksums in `data/recommendation-engine` match what training used.
- GPL-3.0 header on each source file (LLD section 2); third-party licences listed; model and OCR licences recorded where already chosen (LOI-3, LOI-10; issue 73 for PaddleOCR is Release 1).
- Media in `data/media/MANIFEST.json` (PR 9): each asset has a licence that allows the use.
- The collector, if run at all for Release 0, ran only against recorded pages or sources already approved under `legal/DATA-SOURCING-POLICY.md`. No live collection before O1 and O2 are decided.
- Screen text for the notice, Terms and Privacy Policy matches the versions in `legal`, and the version numbers recorded on acceptance match.

Output: a licence and data sheet for Release 0.

### A9. Product and demo readiness of what exists

- One design: the prototype, the shell in PR 10, the redesign in PR 11 and the WO-0093 restyle are four visual lines. Record which one the demo uses and retire the rest.
- Walk every built consumer flow by hand on a phone-width browser and a desktop browser: sign up, accept, onboard, add an item three ways (manual, catalogue, photo), filter, build an outfit, get suggestions, swap, record a purchase, wishlist, export, leave. Record tap counts and any dead end.
- Labels: every sample or made-up number on screen says so.
- Performance spot-check against NFR-3 on a 500-item account (full check is Release 1).

Output: a walkthrough log with screenshots, and a list of rough edges ranked by how visible they are in a demo.

## 6. Part B: audit of what is still to be built

### 6.1 Ready check for each open item

Each open Release 0 item is checked against the same list.

| Check | Question |
| --- | --- |
| Spec | Is there a work order with the FR numbers it satisfies and a "done when" that is true or false? |
| Tests named | Are the pgTAP, Vitest, pytest or Playwright tests named before the build starts? |
| Dependencies | Is everything it needs closed, or is there a stated stand-in? |
| Decisions | Is any owner decision pending? Who decides, and by when? |
| Security class | Does it touch RLS, secrets, storage or vendor functions? If so, which review does it get in Release 0? |
| Demo relevance | Which step of the demo script needs it? If none, why is it in Release 0? |
| Size | Estimate in work orders and days, with the fix-loop rate from A6 applied |

| Item | Known concerns to resolve in the check |
| --- | --- |
| WO-0084 category illustrations | Must replace any product photo in the catalogue (FR-24, FOI-4). Licence or authorship of the illustrations. |
| WO-0085 catalogue picker, popular-items onboarding | Reconcile with the grid already in PR 11. Source link must be shown. No prices or ratings unless the documents add them. |
| WO-0086, 0087 collector | Depends on O1, O2 and O6, which are in Release 1. For Release 0, restrict to recorded pages and fixtures, or move the slice. |
| WO-0088 catalogue admin, barcode | Admin routes use the secret key: needs at least the A5 checks. Barcode is a "Could" (BR-07): confirm it belongs in a demo release. GTIN length is a known drift point. |
| R7 aggregation and vendor portal | No spec. See 6.2. |
| WO-0097 demo data pack and script | See 6.5. Depends on a scope decision for R7. |
| Issue 63 checkpoint | Entry criteria are section 8 of this plan. |

### 6.2 R7 in detail

R7 is the vendor half of the product, and the part the stakeholders most need to see. It is unspecified and maps to the largest LLD milestone (M5: FR-70 to FR-95).

The audit produces a scope proposal with two options for the owner:

| Option | Contents | Risk |
| --- | --- | --- |
| Full | Everything in LLD section 5 and FDD section 10: aggregation run, cube, suppression, vendor functions, dashboard, gaps, condition spectrum, report, query log and rate limit, agreement gate, feed upload and publish | Largest remaining piece of work; unlikely to fit beside R6b, R6c and the demo pack |
| Demo slice (recommended starting point) | Aggregation run on synthetic data; minimum group of 10, rounding to 5 and complementary suppression with their pgTAP tests (FR-80, FR-82, FR-83); read-only dashboard and gaps view; vendor role isolation. Report, feed upload, query-log screen and rate limit move to Release 1. | Smaller, and it still shows the privacy rules working |

Whatever the option, three things are not negotiable, because they are what the demo claims: no segment under 10 users is shown, counts are rounded, and a vendor cannot reach any `app` table. The spec must name the tests for these before the build starts.

Also check: the synthetic data set is large enough to fill segments of 10 or more (the charter planned about 5,000 synthetic users), is generated by a seeded script, and is labelled as synthetic on screen.

### 6.3 Dependencies and decisions

Build one list of every decision and external dependency that an open Release 0 item needs, from: BRD OI-1 to OI-4, FDD FOI-6 and FOI-8 to FOI-10, HLD HOI-4, LLD LOI-1 to LOI-11, owner decisions O1 to O6, OI-5, and MAJOR-1. For each: needed for Release 0 (yes or no), stand-in used, owner, date.

Expected result: most are Release 1. The ones that are not must be decided before the open work starts, not during it.

### 6.4 Release boundary: is each deferral safe?

For every Release 1 issue, record why the demo can go ahead without it and what the demo must say.

| Deferred to Release 1 | Safe for a demo only if |
| --- | --- |
| Security review (67), penetration test (66), MAJOR-1 (75) | Synthetic data only; no public sign-up; secrets are demo-only and rotated afterwards |
| Receipts (58, 59, 60, 64) | The demo script does not show receipt scan, and no dead receipt button is visible |
| Style review G9 (69) and ranking weights | Suggestions are presented as rule-based with placeholder weights, as the README already states for the prototype |
| 100-photo evaluation (70) | The photo suggestion is shown as a suggestion, and the Fashion-MNIST figure is not presented as real-world accuracy |
| OI-5 (68) | The R4 features stay off |
| Catalogue sources (71), FX provider (72), OCR licences (73), admin account (74) | Stand-ins are in place and labelled |
| Document sync (76) | The drift register (A7) exists, so nobody is misled by the documents |
| R8 hardening (65) | Nothing in the demo is described as pilot-ready |

### 6.5 Demo plan audit

- The script covers both audiences (consumer and vendor) and each step names the requirement it shows.
- Every step runs on built, verified work orders. A step that needs an open item is marked.
- The data pack is synthetic, seeded and reset by one command.
- Dry run twice in a row from a reset state, by someone other than the author, with a timer.
- A fallback for each fragile step (worker offline, network down): recorded screens or a local run.
- One slide or page of honest limits: what is not built, what is placeholder, what has not been reviewed.

### 6.6 Capacity

- Count the remaining Release 0 work in work orders. Apply the observed fix-loop rate (6 slices out of 10 completed slices needed at least one loop).
- Set it against the days left before the demo date and the course dates still ahead in the charter (final report and slide deck in the week of 16 November).
- If it does not fit, the audit recommends what moves to Release 1, in this order: barcode lookup, live collector, feed upload, reports.

## 7. Outputs

| Output | Content | Owner |
| --- | --- | --- |
| Findings register | One row per finding (section 3) | Audit lead |
| Reconciliation matrix | Issue, work order, commits, evidence, verdict (A1) | Audit lead |
| Traceability matrix | BR and FR to code, test and demo step (A3) | Audit lead |
| Slice scorecards | One page per slice (A4) | Auditor for the slice |
| Security and privacy memo | What was checked, what was not (A5) | SA |
| Drift register | Document or build, and the decision (A7) | SA and product owner |
| Readiness table | Ready or not ready for each open item, R7 scope proposal (Part B) | Product owner |
| Go or no-go memo | One page: verdict counts, open Blockers and Majors, disclosed limits, decision | Product owner |

After the decision, update the tracker so that it tells the truth: reopen any issue whose work order is "Not verified" or "Failed", open an issue for each Major, and move re-scoped items between milestones.

## 8. Exit criteria for the Release 0 checkpoint

Go requires all of these:

1. Every closed work order has a verdict, and none on a path the demo script uses is "Not verified" or "Failed".
2. The clean-clone run (A2) is green at the frozen commit, with no skipped test on a privacy or security path.
3. No open Blocker. Each Major is fixed, or listed in the demo's limits with an owner and a Release 1 issue.
4. The demo uses synthetic data only, and no secret, personal data or H&M-derived file is in the repository or the deployment.
5. The three vendor privacy rules in 6.2 are enforced and tested, or the vendor part is not shown.
6. Every open Release 0 item is done, or moved to Release 1 with a written reason.
7. The demo script passes two dry runs in a row from a reset state.
8. The README status and the tracker match the audited state.

## 9. Sequence and effort

Effort is in working days from the day the frozen commit exists. It assumes fresh agent sessions do the reruns and reading, and the three team members review and decide.

| Day | Work | Who |
| --- | --- | --- |
| 0 | Step 0 (section 4): scan, push, freeze, tidy pull requests | SA, product owner |
| 1 | A1 ledger reconciliation; A2 clean-clone run. In parallel: 6.3 decisions list and 6.2 R7 scope proposal, which do not need the code | Audit sessions; product owner for 6.2 and 6.3 |
| 2 | A4 for R2a, R2b, R2c, R5b (full depth); A5; A6 | Audit sessions; SA reviews |
| 3 | A4 for the other slices; A3; A7; A8; A9; 6.1 ready checks; 6.5 first dry run | Audit sessions; style specialist for R1 and R4; product owner for A9 and 6.5 |
| 4 | Findings review, verdicts, capacity (6.6), go or no-go memo, tracker update | All three |

If only one day is available, run this cut and say plainly that it is a cut: step 0, A2, A4 for R2a, R2b, R2c and R5b only, the secrets and demo-data checks from A5, the H&M check from A8, 6.2 and one dry run.

## 10. Questions for the product owner

The plan can start without these, but each changes its size.

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | Where is the Release 0 workspace, and can it be pushed to this repository after the scan in step 0.1? | Nothing in Part A can run without it |
| Q2 | What is the date of the stakeholder demo, and who are the stakeholders (faculty, a vendor, both)? | Sets the depth of the audit, and whether showing H&M photos is acceptable at all |
| Q3 | Will the demo run locally or on a hosted deployment? | Decides how much of A5 applies |
| Q4 | Is R7 expected in full for Release 0, or is the demo slice in 6.2 acceptable? | The largest scope decision left |
| Q5 | Which visual design is the Release 0 design (A9)? | Three open lines of UI work depend on it |
| Q6 | Is OI-5 to be decided before the demo, or do the R4 features stay off? | Decides whether R4 is audited as shipped or as dormant code |
