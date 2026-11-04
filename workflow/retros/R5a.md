# Retro R5a (2026-11-04)
Facts: 2 work orders, Spec QC and Model QC PASS first time (fix loops 0). Test accuracy 0.8953 (aim about 90%, floor 0.85); training reproducible bit for bit; ONNX 105,626 bytes; 34 python tests, 24 independent mutants (18 killed).
Worked: pinning the venv outside the repo; script-generated card with hash checks and a vitest gate on the card hash; independent re-implementation of the evaluation; honest status line (team-photo evaluation not done).
Did not work: tuning ran three full trainings on validation and the harness was not committed (the first log was lost); six mutants survived in tests (global pooling, patience, best-weights restore, export tolerance); card wording overstates how much of preprocessing is shared on IDX data.
Proposed changes: commit tuning harnesses; add the LATER test pins; reword the card's preprocessing row (steps 1-5 apply to worker cut-outs only).
Open for the owner: GARMENT_GUESS_ENABLED stays false until the 100-photo team evaluation; the worker (R5b) needs Docker.
