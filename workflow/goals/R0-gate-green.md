# Goal: The gate is green
Predicate: `bash workflow/gates/gate.sh >/dev/null 2>&1`
Completed: 2026-11-04
Triggered by: R0 (Harness and foundations), WO-0001
Status: holding
Last pass: 2026-11-04
On violation: Run `bash workflow/gates/gate.sh` and read the first stage marked FAIL. Tell the orchestrator and the Gate engineer; fix through a normal work order, never by editing a test, a gate script or this file to make it pass.
Retire when: The product owner decides the gate is replaced by a new gate script, and a successor goal exists.
