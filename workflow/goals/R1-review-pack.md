# Goal: the review pack keeps at least 50 suggestions from 5 producing wardrobes
Predicate: `grep -E "^review pack:|suggestions from [5-9] wardrobes" workflow/evidence/R1/review-pack.md >/dev/null`
Completed: 2026-11-04
Triggered by: release R1 (CC8)
Status: holding
Last pass: 2026-11-06
On violation: regenerate with `npm run review-pack -w @sparta/rules` and check the header count; a wardrobe producing no suggestions is a defect.
Retire when: the human style specialist's review pack replaces it.
