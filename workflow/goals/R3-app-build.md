# Goal: the web app builds and its logic tests pass
Predicate: `npm run build -w apps/web >/dev/null 2>&1 && npx vitest run apps/web >/dev/null 2>&1`
Completed: 2026-11-04
Triggered by: release R3 (suggestions screen, browser-local repository)
Status: holding
Last pass: 2026-11-04
On violation: run the build and `npx vitest run apps/web`; fix through a work order, never by editing a test.
Retire when: R2 replaces the browser-local repository and a new app goal supersedes this one.
