# Goal: the photo path keeps its guarantees (default-off garment guess, secret key outside client bundles, image paths owned, worker budget protected)
Predicate: `npx vitest run workflow/gates/web_containment.test.ts apps/web/lib/server/signed-urls-throttle.test.ts apps/web/lib/server/signed-urls.test.ts >/dev/null 2>&1 && grep -q "_bool(.*GARMENT_GUESS_ENABLED.*False" services/worker/worker/config.py && grep -q "items_image_path_owner_chk" supabase/migrations/20261106130000_wo0075_item_image_paths.sql`
Completed: 2026-11-06
Triggered by: release R5b (worker, add-by-photo, signed-URL route)
Status: holding
Last pass: 2026-11-06
On violation: do not ship; check the three guarantees in order: garment guess default, token-before-counting in signed-urls.ts, owner check on image paths; GARMENT_GUESS_ENABLED stays false until the 100-photo evaluation.
Retire when: R7/R8 replace these with broader hardening goals.
