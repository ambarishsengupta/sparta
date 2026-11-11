# Goal: export and account deletion keep working and stay safe against the real local stack
Predicate: `supabase status >/dev/null 2>&1 && supabase db reset >/dev/null 2>&1 && supabase test db >/dev/null 2>&1`
Completed: 2026-11-06
Triggered by: release R2c (export_my_data, delete_my_account with server-side re-authentication, audit-log purge; 1073 pgTAP assertions)
Status: holding
Last pass: 2026-11-11
On violation: run `supabase db reset` and `supabase test db`, read file 008 first; never weaken a test; the app-level flows are covered by `npx vitest run apps/web/components/account`.
Retire when: superseded by a hosted-project CI job.
