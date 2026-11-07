# Build state (the orchestrator's only memory between sessions)

Updated: 2026-11-07 (re-cut: Release 0 = stakeholder demo, Release 1 = MVP; WO-0092 fix loop running)
Status: running
Resume trigger: none (no build is running; the orchestrator arms `sparta-resume-<yyyymmddhhmm>` before each work order, workflow doc section 9 step 4)
In-flight branches: none (no work-order worktrees exist yet)
Integration branch: none yet (release/R0 is cut from main after the preconditions below are ticked)
Branch of the documents: engine-hm-images (uncommitted changes; main is untouched)

## Preconditions (the owner and the SA tick these; an agent never does)
Workflow doc 4.1 (before R0):
- [ ] Local commits agreed
- [ ] BRD, FDD, HLD, LLD, workflow doc, `legal/` and `workflow/` committed and merged into `main` by the owner (release/R0 is cut from `main`; the v1.4 documents exist only, uncommitted, on `engine-hm-images`)
- [ ] Branch model accepted (integration branch `release/R<n>` per release, cut from main; work-order branches `wo/WO-nnnn`; the integration branch is Spec QC's base branch)
- [ ] Permission mode for unattended runs approved
Workflow doc 4.2 (accounts and secrets, a G1 precondition for the release named):
- [ ] R2: Supabase dev and production projects; Vercel project with auto-deploy off; GitHub secrets; SMTP provider (LLD LOI-5)
- [ ] R4: private artifact location and read token (HOI-5)
- [ ] R5: worker host

Open preconditions: all four lines of 4.1 and all three lines of 4.2 are unticked. No work order starts until the owner ticks 4.1, and each 4.2 row is a G1 precondition for its release.

## Done
1. Docs updated for Fashion-MNIST IDX files and H&M photographs and purchases: BRD 1.4, FDD 1.5, HLD 1.4, LLD 1.4, legal pack, READMEs, data/recommendation-engine/README.md, .gitignore.
2. Agent workflow written: docs/MVP-AGENT-WORKFLOW.md; graph built from workflow/build_graph.py into docs/mvp-agent-workflow-graph.{html,json,png}.
3. Opus (extra effort) verifier ran on the docs and workflow and reported 30 findings. The product owner decided D1 to D20 for them; workflow doc 0.2 applied them.
4. An Opus approver rejected workflow doc 0.2 (one blocker, ten conditions). Workflow doc 0.3 applies all eleven items: BR-59 and the manifest on main (G4, G7), the pre-armed resume rule with heartbeat and unique trigger ids, preconditions and the branch model (4.1), the accounts checklist (4.2), full FR, NFR and BR traces with per-release events, G9 style review, the path-to-owner table (3.1) and the scope script in G2, the extra `local.env` paths, and edge 18 routed clear of the Design box.
5. The Opus workflow approver reviewed workflow doc 0.3 a second time on 2026-11-04 and gave APPROVED WITH CONDITIONS (no blocker, 13 conditions). Workflow doc 0.4, the graph and the wording spots in LLD 7.8, 7.9, 12.1 and HLD (about lines 183 and 280) apply all 13 conditions. Condition 3 (LLD and HLD wording) needs the SA's signature and must be in place before R4 G1; the other twelve must be in place before R0 G1. Each applied change still goes through G8 (the workflow approver's check), which has not run yet. Nothing is committed.

## Next, in order
1. Ask the workflow approver for the G8 check of the changes made for the 13 conditions (workflow doc 0.4); the SA signs the LLD and HLD wording (condition 3).
2. The owner ticks the preconditions above. Only then start building.
3. Build R0 to R4 with the /agentic-os skill, one release at a time: work orders, build, check, demo, Opus approval, retro (workflow doc sections 4 to 8). For R0 Spec QC runs the release-map and scope checks by hand.
4. Ask the product owner before any push, merge to main or tag. This file is not committed until the owner agrees to commits.

## Open questions for the owner
- Commit the docs and workflow, and accept the branch model (4.1)? (not yet asked)
- OI-5: may models trained on the H&M files be used in the pilot? (a person decides; nothing here may close it)
- Release plan: "start from popular items" (FR-7) and the catalogue link in the thin-wardrobe message (FR-54) go live with R6, so MVP-1 is self-contained. Accept?
- Release plan: NFR-2 (PWA and offline) is built in R2, NFR-4 (WCAG) is traced to R8 with the audit running from R2, BR-27 is traced to R7, BR-42 to R8, BR-28 to R4. Accept?
- G9: two style reviews of 50 suggestions (R3 base weights, R4 prior on). If the R4 review is below the bar the prior is declared not shippable and the owner may tag R4 without it. Accept?
- FDD 16 has no separate event for a swapped suggestion. Add one (a change request) or keep accept and reject only?

## Usage
Checked before and after every work order with `mcp__ccd_session_mgmt__get_usage` (workflow doc section 9). Last recorded: 5-hour window reset at 2026-11-04 01:10 IST, 31% used at 00:15 IST; weekly 47% used. Not re-read by the fix agent. If get_usage returns `unavailable` or `not_applicable`, stop with `waiting-for-owner`; any weekly window (per-model ones too) at 90% or more also stops the run.

## G8 check of v0.4 (Opus, 2026-11-04): APPROVED. Remaining edits, each gets a quick G8 look
- B (before R0 G1): section 9.6 heartbeat must stop by itself after the work order's time box plus 15 minutes, so a run cut off by the usage limit goes stale and the trigger can take over.
- C (before R0 G1): G4 and LLD 12.1 `manifest_check` applies to the root `models.manifest.json` only; the synthetic fixture manifest of LLD 7.8 is exempt.
- A (before R4 G1, SA signs): HLD diagram lines 163, 166, 170 still say pinned without the OI-5 caveat.
- D (before R4 G1): name the pinned manifest copy's location once: `SPARTA_ARTIFACT_DIR`, outside the repository, never copied into the checkout; use the same words in G4, R4, R5 and LLD 12.1.
- E (optional): .gitignore comment on models.manifest.json; roster says Doc-sync keeps READMEs but 3.1 gives data/recommendation-engine/README.md to the ML maker; Done item 5 should also name HLD line 263.
- Also still open: the human preconditions in sections 4.1 and 4.2, and the SA's signature on the LLD 7.8, 7.9, 12.1 and HLD wording.


## Run log
- 2026-11-04 01:13 IST: automated resume fired. Status is waiting-for-owner (not waiting-for-limit-reset) and all 4.1 and 4.2 preconditions are unticked, so no work order started and nothing was changed. Status left as waiting-for-owner.

## Build log (orchestrator)
- 2026-11-04: owner delegated all approvals. R0 built and merged into main (gate green, 86 tests). Spec QC failed it twice; fix loops used: 2. Not independently re-verified after fix loop 2 (see retros/R0.md).
- Deviation: no Docker or Supabase CLI here, so R2 database/auth work and R5 worker/garment training cannot be verified in this environment; R3 is built before R2 on a browser-local repository (see work-orders/R3.md).
- Order of work: R1 (engine), R3 (app), R4 (learned layer), then R5 to R8 as far as the environment allows.
- 2026-11-04 (later): R1 engine core built and merged to main after 2 fix loops (WO-0006, 0007, 0008). WO-0010 (H&M pairing prior pipeline) was imported early: prior AUC 0.608 [0.601, 0.615] ships narrowly; artifacts stay in data/recommendation-engine/artifacts (git-ignored); manifest still not-built (G4). AI style review: 80.8% acceptable (not the specialist's G9). R3 (app) is next, then R4 TS parts (WO-0011, WO-0012).
- 2026-11-04 (later): R3 (app) merged to main after Spec QC pass 2. R4 built on release/R4 (WO-0010 prior, WO-0011 engine, WO-0013 unlock layer rule, WO-0012 app): gate green, 672 tests. R4 verification (Spec QC and G4/Model QC, Opus) was interrupted by the 5-hour limit and resumed. R2, R5 to R8 not started: blocked by environment (no Docker/Supabase CLI/torch) except where noted in the final report.
- 2026-11-04 (end): R4 merged to main after Spec QC PASS, Model QC PASS and G4 (FAIL on the pre-existing D3 notebook exposure, recorded in legal finding 20; R4's own diff clean). MVP-1 as built: R0 harness, R1 engine, R3 app on a browser-local repository, R4 learned layer (off by default). NOT built: R2 (Supabase accounts/RLS/data), R5 (worker, photo path, garment models), R6, R7, R8: blocked by the environment (no Docker, Supabase CLI or torch) and by the weekly usage limit. Next when resumed: R5a garment model v1 on the Fashion-MNIST IDX files if torch is installable; R2 needs Docker and Supabase CLI.
- 2026-11-04 (owner said 'Continue with it'): weekly usage was 87% (stop threshold 90%), resets 21:30 IST. Resume trigger created: sparta-resume-202611042132 (fires 2026-11-04 21:32 IST, one-shot) to continue with R5a (garment model v1 on the Fashion-MNIST IDX files). Resume trigger: sparta-resume-202611042132. In-flight branches: none.
- 2026-11-04: OWNER OVERRIDE for this week's weekly usage window only: the 90% weekly stop rule (workflow doc section 9) is waived by the product owner ('Override this rule just for this week's weekly limit'). The 5-hour rule still applies. Work continues now on release/R5 (R5a). The scheduled resume sparta-resume-202611042132 stays as a safety net (it exits if Status is running and fresh).
- 2026-11-04 (end): R5a merged: garment model v1 (Fashion-MNIST IDX, test accuracy 0.8953) with ONNX, evaluation, card and a hash gate; Spec QC and Model QC PASS. Remaining and blocked here (no Docker, Supabase CLI, Postgres): R2 (accounts, database, RLS), R5b (FastAPI worker, background removal, photo job, item-form pre-fill), R6 (receipt OCR, catalogue, purchases), R7 (aggregation, vendor portal), R8 (hardening). The 21:32 IST resume trigger was deleted: nothing left that this environment can run.
- 2026-11-05: R2a merged to main (754 pgTAP assertions, security-reviewed twice). R2b on release/R2b: WO-0050 (sign-up/in, gating), WO-0051 (consent screens), WO-0052 (Supabase repository, real-browser evidence), WO-0053 (security fix loop after the first review found an open redirect): gate green, 1233 tests. Second security re-verification (Opus) was interrupted by the 5-hour limit and is being resumed; R2b must not merge until it passes. Not built yet: R2c (export, delete, Leave the pilot, About, Settings, rendered legal pages), R5b worker, R6, R7, R8. The pilot must not open to real participants before R2c (the notice promises 'Leave the pilot').
- 2026-11-05 (end): R2b merged to main after two security reviews (second PASS). Built: R0, R1, R2a, R2b, R3, R4, R5a. Not built: R2c (export, delete account, Leave the pilot, About, Settings, rendered legal pages), R5b (worker, photo path), R6 (receipts, catalogue, purchases), R7 (aggregation, vendor portal), R8 (hardening). Next in order: R2c, then R5b/R6/R7/R8. Rule 11 (background work hygiene) applies. The local Supabase stack and Colima VM are running: stop with `supabase stop` and `colima stop` if idle.
- 2026-11-06: R2c on release/R2c: WO-0060 (export/delete functions), WO-0061 (pages, leave flow) committed; the first security review FAILED R2c (F1 server-side re-authentication missing, F2 auth audit-log email kept after deletion, F3 pilot-notice/accept-terms pages lack Export/Leave, F4 quadratic regex in the legal renderer, F5/F6 test gaps). Fix work order WO-0062 was interrupted by the 5-hour limit and is being resumed. R2c must not merge until the security re-check passes. Remaining after R2c: R5b, R6, R7, R8.
- 2026-11-06: R2c merged to main after two security reviews (second PASS). Built: R0, R1, R2a, R2b, R2c, R3, R4, R5a. Not built: R5b (worker, photo path, jobs, storage), R6 (receipts, catalogue, purchases), R7 (aggregation, vendor portal), R8 (hardening). Owner decisions open (human-only): MAJOR-1 password-change bypass risk acceptance before any hosted deployment; H&M licence OI-5; the human style specialist; D3 notebook exposure; accounts and keys for hosting; pushing. Rule 11 and section 11a apply: continue with R5b.
- 2026-11-06: R5b on release/R5b. WO-0070 (jobs, private storage, worker_role, atomic claim) committed and security-reviewed PASS. The review found MAJOR-1 (account deletion leaves file bytes in storage) so WO-0071 was added: server-only admin module (only place with SUPABASE_SECRET_KEY), signed-URL route for the worker, storage purge before account deletion, DB follow-ups. WO-0071 was cut off by the 5-hour limit and is resumed. Then WO-0072 (worker service in Docker) and WO-0073 (add-by-photo flow). R5b must not merge before the reviews pass.
- 2026-11-06: WO-0071 committed (gate green). The independent security review of its routes: pass 1 static only, pass 2 INCOMPLETE (its output was cut off by a safety classifier while writing attack scripts; I did not reword to evade it). OPEN GAP for the owner: penetration-test /api/worker/signed-urls and /api/account/purge-storage before any hosted deployment. Confirmed finding: limiter counts before token check (worker DoS): fix in WO-0074 with MINOR-1,3,4,5. Then WO-0072 (worker) and WO-0073 (add-by-photo).
- 2026-11-06: WO-0074 committed (5f6051f). WO-0072 worker service launched (Sonnet maker). Next: WO-0073, then R5b Spec QC, security review, retro, goal, merge.
- 2026-11-06: WO-0072 committed (worker service, 141 pytest, 30/30 mutants). Next: WO-0073 add-by-photo, then R5b Spec QC + security review (worker route + purge route pen-test still open), retro, goal, merge.
- 2026-11-06: R5b complete (WO-0070..0075, checker PASS, retro R5b, goal R5b-photo-path). Merged to main. Next: R6 (receipts OCR, catalogue, purchases/wishlist). Open: pen-test of worker + purge routes before hosting.
- 2026-11-06: R6 spec written (Opus). Sub-releases R6a (WO-0080..82), R6b (83..85), R6c (86..88), R6d (89..91), each merged on its own. Owner-only O1..O6 in R6.md (real sources, collection legality, fx provider, OCR licences, pen test, collect.yml/admin account).
- 2026-11-07 OWNER RE-CUT: Release 0 = pre-MVP stakeholder demo with all features; Release 1 = the MVP. Receipts (R6d + receipt parts of WO-0082), ALL pen testing, dedicated Opus security reviews and R8 hardening move to Release 1 (docs/MVP-AGENT-WORKFLOW.md 2a). UI to be styled off off---white.com (style only; spec in workflow/work-orders/Demo.md, WO-0093; no brand marks). Release 0 order: WO-0092 (fix loop, running) -> WO-0093 restyle -> WO-0081 -> WO-0082 (plan purchases only) -> R6b (+ flagged synthetic demo catalogue) -> R6c -> R7 -> WO-0097 demo pack + script -> Release 0 demo checkpoint. Spec QC, gate and mutation proof are NOT deferred.
