# Build state (the orchestrator's only memory between sessions)

Updated: 2026-11-04 (R0 merged; building R1)
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
