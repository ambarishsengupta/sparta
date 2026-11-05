# Goal: H&M-trained files are marked not built in the manifest
Predicate: `node workflow/gates/manifest_check.mjs >/dev/null 2>&1`
Completed: 2026-11-04
Triggered by: R0 (Harness and foundations), WO-0001; workflow document G4 and G7
Status: holding
Last pass: 2026-11-06
On violation: Someone pinned a sha256 for garment-cnn-v2.onnx, pairing-prior-v1.json or unlock-candidates.json in models.manifest.json. Revert the pin; do not merge. Only the product owner and the SA can close G7 (OI-5) and lift this rule.
Retire when: G7 (OI-5) is closed by the product owner and the SA, and this goal is replaced by one for the pinned hashes.
