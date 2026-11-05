# Goal: the sign-in, consent and repository paths keep passing against the real local stack
Predicate: `supabase status >/dev/null 2>&1 && npx vitest run apps/web/lib/supabase >/dev/null 2>&1`
Completed: 2026-11-05
Triggered by: release R2b (sign-up/sign-in, route gating, consent screens, Supabase repository; security-reviewed twice)
Status: holding
Last pass: 2026-11-05
On violation: start the stack (`colima start`, `supabase start`), run `npx vitest run apps/web/lib/supabase`; any failure on redirects, gating or isolation is a security regression: fix through a work order, never weaken a test.
Retire when: a hosted-project CI job replaces local-only verification.
