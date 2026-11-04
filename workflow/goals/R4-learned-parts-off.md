# Goal: learned parts stay off and no H&M-derived file is tracked or bundled
Predicate: `node workflow/gates/manifest_check.mjs >/dev/null 2>&1 && [ -z "$(git ls-files | grep -E 'pairing-prior-v|unlock-candidates|garment-cnn-v2' | grep -v fixtures)" ] && grep -q "gm1;emb0;pair0;ul:fb;w:base" apps/web/lib/events.ts`
Completed: 2026-11-04
Triggered by: release R4 (G4, BR-59, OI-5 open)
Status: holding
Last pass: 2026-11-04
On violation: stop; remove the file from the index; check the privacy and licence gate (workflow doc G4); do not switch a learned part on without the owner closing BRD OI-5.
Retire when: OI-5 is closed by the product owner and the SA and a new goal replaces this one.
