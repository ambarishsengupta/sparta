# Goal: the consumer database rebuilds from migrations and its security suite passes
Predicate: `supabase status >/dev/null 2>&1 && supabase db reset >/dev/null 2>&1 && supabase test db >/dev/null 2>&1`
Completed: 2026-11-05
Triggered by: release R2a (schemas, RLS, consent gate, invitations; 754 pgTAP assertions)
Status: holding
Last pass: 2026-11-12
On violation: run `supabase db reset` then `supabase test db` and read the failing file (003 grants, 004 isolation, 005 consent gate, 006 invitations/onboarding, 007 triggers); fix through a work order; never weaken a test. If the stack is not running the predicate fails: start it with `colima start` and `supabase start`.
Retire when: the hosted project replaces local-only verification and a CI database job supersedes it.
