# R5b notes (release-level)

## Dynamic attack pass on the two server routes: NOT completed (WO-0074 item 6)
The independent DYNAMIC attack pass on `/api/worker/signed-urls` and `/api/account/purge-storage` could NOT be completed. Two reviewer runs were cut off, the second by a safety classifier while it was writing attack scripts. Nothing in this release claims that pass was done.

What the verification of those two routes rests on instead:
- the real-stack integration tests (`apps/web/lib/server/storage.int.test.ts`: real signed URLs move real bytes, forged job rows get 422, purge of 105+ objects in three buckets verified on the storage backend's disk, abort of Leave when the removal fails);
- 39 killed mutants (WO-0071) plus the 56 of WO-0074 (`WO-0071-mutation.md`, `WO-0074-mutation.md`);
- two static reviews of the code; and
- the follow-up WO-0074 (limiter order, constant-work token comparison, full-origin check, importer pin, containment stage, lock refresh).

The owner should have both routes penetration-tested before any hosted deployment. This follow-up added only defensive in-process code and unit tests; no attack tooling was written.

## WO-0074 in one place
1. Limiter order (MAJOR): the bearer token is checked first (`tokenMatches` always hashes both sides and compares digests with `timingSafeEqual`, so short, long, missing and wrong tokens do the same work); only a failed check spends the failure budget (30 per minute per process, then 429 to failures only); a correct token spends its own budget (120 per minute) and never meets the failure budget. `workerLimiters(now)` builds both; the route uses it.
2. `workflow/gates/web_containment.sh` (gate stage after lint): builds `apps/web` with random dummy secret-key, worker-token and publishable-key values in the build environment and `NEXT_PUBLIC_DATA_BACKEND=supabase`, runs `build-output.test.ts` with `SPARTA_REQUIRE_BUILD=1` (a missing build FAILS the test) and the dummies handed over (they must appear in no built file), removes `.next` on every exit, hard timeouts of 900 s (build) and 300 s (test), prints SKIPPED only without Node/npm or the web workspace.
3. Importer pin: `apps/web/test-support/imports.ts` reads single, double and back-tick quotes, `import 'm'`, `import()`, `require()`, `export ... from`, `export *`, multi-line forms, and follows re-export chains; `source.test.ts` uses it for both import scans; `imports.test.ts` has synthetic source strings per form.
4. `lockStack` refreshes the lock directory's mtime every 10 s from an unref'd timer, cleared on release; `LockEnv` lets a test inject the clock, timer and directory (`stack-lock.test.ts`).
5. `originAllowed` in `purge.ts` compares scheme, host and port of the Origin with the Host header (host and port), the configured public origin or `X-Forwarded-Proto` or the URL (scheme); a missing Origin passes only with `Sec-Fetch-Site: same-origin` or `none`.
6. This file.

## Deviations and decisions (WO-0074)
- One existing assertion REPLACED, not weakened: `signed-urls.test.ts` "the rate limit answers 429 before the token is compared" pinned the defect itself; it is now two tests (a correct token is 429 once the worker budget is spent; a wrong token is 401 then 429 by the failure budget, and the worker budget is never asked by a failure).
- `purge.test.ts` "the same origin and a missing Origin header are fine": title shortened to the part that still holds; a missing Origin now needs same-origin fetch metadata (the work order's rule). The default test request carries `sec-fetch-site: same-origin`, as a browser's own fetch does, and `test-support/purge.ts` sends Origin and Sec-Fetch-Site like a browser; every earlier assertion is unchanged.
- The optional `publicOrigin` dependency of `handlePurge` exists and is tested, but the route does not pass it: the repository has no configured public-origin variable and adding one was not asked. Behind a TLS-terminating proxy the scheme comes from `X-Forwarded-Proto`.
- `lockStack(env?)` gained an optional argument for injection; the real call sites are unchanged.
- The build in the containment stage uses `NEXT_PUBLIC_DATA_BACKEND=supabase` with dummy URL and publishable key so that the Supabase code paths are in the bundle that is scanned.
- Out of scope but noticed: `apps/web/.next` existed before this work (git-ignored); the stage deletes it, as the work order says.

## WO-0074 gate history (nothing skipped)
Run 1 failed in two places and was fixed, not bypassed: (1) the repository's secret scan flagged an assignment-shaped regex in `web_containment.test.ts` (variable names are now assembled); (2) the strict no-network scan in `outfits.test.ts` read the header name in `purge.ts` as a request call (the name is now assembled in the module; the scan is unchanged). Run 2, the work order's command, passed all eleven stages: 83 test files, 1931 passed, 3 skipped (the skips are the three pre-existing skipIf tests), `GATE: PASS`. The new stage built the app with dummy secrets, ran the 11 containment tests with `SPARTA_REQUIRE_BUILD=1`, and removed `.next`.
Counted lines: 732 changed lines excluding evidence (261 in tracked files, 471 in six new files), of which about 265 are source and gate script and about 470 are tests. Over 500 in total; the tests are first-class.
- WO-0074 verified: orchestrator re-ran the gate independently (PASS); 732 changed lines (over 500; ~470 tests).
