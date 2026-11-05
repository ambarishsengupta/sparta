# Goal: the recommendation engine stays valid and deterministic
Predicate: `npm test -w @sparta/rules >/dev/null 2>&1`
Completed: 2026-11-04
Triggered by: release R1 (engine core)
Status: holding
Last pass: 2026-11-06
On violation: run `npm test -w @sparta/rules`, read the failing property test (R1/R2/slots, determinism, layer rule), fix through a work order; never edit a test to pass.
Retire when: superseded by the engine's next major version goal.
