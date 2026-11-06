# Release R5b: Photo path (spec and work orders)
Date: 2026-11-06
Requested by: product owner delegation (workflow section 11a: continue with the next release in the plan). Conventions in R0.md. Branch release/R5b (from main with R0 to R5a, R2a to R2c, R3, R4). Local Supabase stack and Docker (Colima) are running. Rule 11 (background work) and the subagent time box (45 minutes per work order, 20 for a re-check) apply to every agent.
Scope: item entry by photo (FR-23, FR-23a, BR-51): the jobs table and storage buckets (database), the Python worker (queue claim, background removal, thumbnails, garment model v1 category guess with the committed ONNX file, version 2 only if the manifest allows: it does not, so v1 only), and the app flow (upload, preview, accept the cut-out or keep the original, pre-filled form with 'Suggested from your photo', item_features saved). Receipts, catalogue, vendor side are later releases.
Dependencies approved by delegation: Python worker: fastapi, uvicorn, psycopg (binary), onnxruntime, numpy, pillow, rembg (background removal; its ONNX model download on first use is allowed, record its licence and source URL in the worker README), pytest; exact pins in services/worker/requirements.txt, installed in a virtualenv OUTSIDE the repo or in the Docker image. No new web dependencies.
Sensitive paths: migrations, storage policies, the worker's database role: delegated approval; Opus security review per work order. The worker must never hold the service-role/secret key: it connects as the limited `worker_role` (LLD 7.1) and the secret key never appears in the worker image or repo.

## Goal
A signed-in participant can add an item from a photo: the photo is stored privately, a worker removes the background and suggests a category and sub-type with the garment model v1, and the add-item form is pre-filled for the person to confirm; everything verified against the real local stack with the worker running in Docker.

## Completion conditions
- CC1: `bash workflow/gates/gate.sh` exits 0 (db_tests real; the worker's pytest suite runs in the gate when the worker venv/Docker is available, else a clearly printed SKIPPED stage).
- CC2: pgTAP: `app.jobs` (owner-only RLS, consent gate, status machine, no client update of status/result, no delete by client except cascade), storage buckets `item-images` (private, size and MIME limits per LLD 4.6) with owner-folder policies (a user reads/writes only objects under their own user id folder; an anonymous caller and another user cannot list or fetch; objects of another user cannot be overwritten), `worker_role` with exactly the privileges of LLD 7.1 (claim a queued job, write its result, read/write storage objects of the job's owner only through a controlled path; cannot read `app.items`, profiles or any other table), the claim function is atomic (two concurrent workers never claim the same job: tested), `app.delete_my_account()` also deletes the caller's storage objects and jobs (test), mutation proof of at least 15 mutants.
- CC3: worker pytest suite (at least 40 tests): claim/lock/retry/fail handling with a real local database, preprocessing identical to `ml/recommendation-engine/garment/preprocess.py` (import or copy with a hash-equality test), background removal behind an interface with a fake in tests and the real model in one slow test, thumbnails and WebP re-encoding limits, garment inference with the committed ONNX model (accuracy sanity on 20 Fashion-MNIST test pictures rendered as cut-outs, labelled correctly at least 15/20; honest numbers), confidence threshold 0.6 and Dress mapping to none, guards (oversized image, non-image, decompression bombs, EXIF rotation, animated images), result schema per LLD 7.3 (version-aware: `garment-cnn-v1`, 10 classes, 32 numbers), `GARMENT_GUESS_ENABLED` and `GARMENT_MODEL_VERSION` switches (default guess ON only if the team-photo evaluation is done: it is NOT, so the worker default is OFF and the app shows no suggestion until the owner/style specialist evaluates; document), the worker never logs image bytes or personal data, mutation proof of at least 15 mutants.
- CC4: Docker: `services/worker/Dockerfile` and `compose.yaml` build and run the worker on the local Colima Docker connecting to the local database as `worker_role` (credentials via environment from a git-ignored file, never committed; document in the README); a real end-to-end test: upload an image as a user, a job appears, the Dockerised worker processes it, the job result and cut-out appear, the user can read them and no other user can.
- CC5: app flow with real-stack integration tests and a real-browser evidence run (screenshots + honest transcript): add-by-photo page, upload with browser re-encode, progress, preview accept/keep original, pre-filled form labelled 'Suggested from your photo' only when the guess is enabled and confident, item saved with item_features, delete of item removes its images (storage objects) or documents why not; accessibility tests; the no-network scan stays strict (only same-origin Supabase calls through the allowed modules); no secret key anywhere in apps/web or services/worker.
- CC6 (G4): nothing H&M-derived; learned parts: garment v1 only; models.manifest.json unchanged; `GARMENT_GUESS_ENABLED` default false in the worker and documented; no photos of real people stored in the repo (test images are synthetic or Fashion-MNIST renders).

## Scope fence
Will NOT touch: ml/* (read-only, except importing preprocess), packages/*, legal/*, docs/*, the learned H&M parts, receipts, catalogue, vendor side.

---
# Work Order WO-0070: jobs, storage and the worker role (database)
Action: execute. Owner: Backend and database maker. Checker: Spec QC + Security (Opus).
In scope: supabase/migrations/**, supabase/tests/**, supabase/config.toml, supabase/seed/**, workflow/gates/db_tests.test.ts, workflow/evidence/R5b/**
Instructions: read docs/LLD.md 4.4 (jobs), 4.6 (storage), 7.1 to 7.4 (worker role, claim query, job types, result shape), 12.3, supabase/migrations (all) and tests (style, helpers). Implement per CC2. Include the delete_my_account update (storage objects and jobs of the caller) in a new migration with re-authentication behaviour unchanged, with tests. Keep secrets out of files (worker role password via a settings/secret mechanism for local only: use a documented local-only password set by a git-ignored script `supabase/scripts/set-worker-password.sh` reading an env var; never a literal in a migration). Local stack only; restore with `supabase db reset`. Counted lines may exceed 500: tests first-class.
Completion conditions: CC1, CC2, CC6.

---
# Work Order WO-0071: the worker service
Action: execute (after WO-0070). Owner: Worker maker. Checker: Spec QC + Security.
In scope: services/worker/**, workflow/gates/**, workflow/evidence/R5b/**, .gitignore
Note: ml/recommendation-engine/garment/preprocess.py is read-only (copy it into the worker with a hash-equality test); workflow/gates only to add a worker test stage (`worker_tests.sh`) to gate.sh that runs pytest when the venv python is available or SKIPPED; .gitignore only for services/worker caches and env files.
Instructions: read docs/LLD.md 7.1 to 7.7 and docs/FDD.md FR-23, FR-23a, 14.3, the committed garment card (ml/recommendation-engine/garment/model_card.md), the class map, WO-0070's migrations, and services/worker/models/garment-cnn-v1.onnx. Build per CC3 and CC4. Time-box and rule 11 apply (Docker runs only for the duration of tests; stop containers you start).
Completion conditions: CC1, CC3, CC4, CC6.

---
# Work Order WO-0072: add-by-photo flow in the app
Action: execute (after WO-0071). Owner: Frontend maker. Checker: Spec QC + Security.
In scope: apps/web/**, workflow/evidence/R5b/**
Instructions: read FDD FR-23, FR-23a and LLD 9.4 (image-prep) and the existing app. Build per CC5 with the Supabase repository modules for storage/jobs (same-origin only), browser re-encoding (canvas to WebP, max size), polling with a hard timeout (rule 11 applies to the app too: bounded polling with a clear message), the preview step, the pre-filled form, item_features saving (embedding 32 numbers, model_version string), deletion of images on item delete if storage policy allows else document. Evidence per CC5.
Completion conditions: CC1, CC5, CC6.
