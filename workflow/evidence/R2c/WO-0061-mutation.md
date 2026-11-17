# WO-0061 mutation evidence (R2c)

Each mutant is ONE change to a copy of apps/web made outside the repository (scratch copy, deleted afterwards). The unit and structure suites of apps/web (every `*.test.ts` except the real-stack `*.int.test.ts`; 1,100+ tests) are then run on the copy. The unmutated copy passes all of them (baseline: 0 failures). KILLED means at least one test failed. The real-stack suite (`account.int.test.ts`) was not re-run per mutant.

| # | Mutant | Result | Failing tests | Killed by |
| --- | --- | --- | --- | --- |
| M01 | Leave: skip the password re-entry (no sign-in before the delete) | KILLED | 4 | components/account/account-actions.test.ts |
| M02 | Leave: carry on to the delete when the sign-in fails | KILLED | 3 | components/account/account-actions.test.ts |
| M03 | Leave: call any odd answer of the delete function a success | KILLED | 1 | components/account/account-actions.test.ts |
| M04 | Leave: say 'nothing was deleted' when the result is unknown | KILLED | 1 | components/account/account-actions.test.ts |
| M05 | Leave: do not stop on a missing email (go on to sign in) | KILLED | 1 | components/account/account-actions.test.ts |
| M06 | Export: save any answer as an export document | KILLED | 9 | components/account/account-actions.test.ts |
| M07 | Export: the file name carries the full timestamp instead of the date only | KILLED | 2 | components/account/account-actions.test.ts |
| M08 | Cookies: sweep any cookie that mentions sb, not only the sb- session cookies | KILLED | 1 | components/account/account-actions.test.ts |
| M09 | Gate: a held person can no longer open Leave the pilot | KILLED | 13 | lib/supabase/gate-account.test.ts, proxy-account.test.ts |
| M10 | Gate: a held person can open Settings | KILLED | 7 | lib/supabase/gate-account.test.ts, proxy-account.test.ts |
| M11 | Gate: the goodbye page needs a session | KILLED | 3 | lib/supabase/gate-account.test.ts, proxy-account.test.ts |
| M12 | Markdown: allow javascript: addresses | KILLED | 2 | components/legal/markdown.test.ts |
| M13 | Markdown: images become links | KILLED | 1 | components/legal/markdown.test.ts |
| M14 | Markdown: no limit on the size of a document | KILLED | 1 | components/legal/markdown.test.ts |
| M15 | Markdown: relative addresses may hold a colon (a scheme can sneak in) | KILLED | 2 | components/legal/markdown.test.ts |
| M16 | Markdown: protocol-relative addresses allowed | KILLED | 5 | components/legal/markdown.test.ts |
| M17 | Markdown: address credentials allowed | KILLED | 2 | components/legal/markdown.test.ts |
| M18 | Renderer: other-site links lose rel=noopener noreferrer | KILLED | 1 | components/legal/markdown.test.ts |
| M19 | Markdown: table headers lose scope | KILLED | 3 | components/account/a11y.test.ts, components/legal/markdown.test.ts |
| M20 | Contact: any text counts as a configured address | KILLED | 10 | components/account/a11y.test.ts, lib/pilot-config.test.ts |
| M21 | About: falls back to the address in the Privacy Policy when none is configured | KILLED | 2 | components/account/a11y.test.ts |
| M22 | End-of-pilot plan: takes the first paragraph of section 7 instead of the right one | KILLED | 2 | components/legal/files.test.ts |
| M23 | Leave form: opens the goodbye page before the cookies are swept | KILLED | 1 | components/account/a11y.test.ts |
| M24 | Leave form: goes home instead of the goodbye page | KILLED | 2 | components/account/a11y.test.ts, lib/supabase/source.test.ts |
| M25 | Nav: Settings shown to a signed-out visitor | KILLED | 1 | components/account/a11y.test.ts |
| M26 | Settings page: sharing is no longer locked (checkbox enabled) | KILLED | 1 | components/account/a11y.test.ts |
| M27 | Not-available page: the Leave the pilot link is gone | KILLED | 1 | components/account/a11y.test.ts |
| M28 | Legal files: the Privacy page reads the Terms file | KILLED | 2 | components/account/a11y.test.ts, components/consent/a11y.test.ts |
| M29 | Settings validation: any currency accepted | KILLED | 1 | lib/settings-form.test.ts |
| M30 | Save profile: success without checking that one row changed | KILLED | 1 | components/account/account-actions.test.ts |

30 of 30 mutants killed.

Two survivors of earlier runs were fixed by strengthening assertions, never by weakening any:
- M04 (unknown result worded as "Nothing was deleted") survived once because the test looked for a lower-case phrase; the assertion is now case-insensitive.
- M12 (allow javascript: addresses) was killed only by luck of the random property test, because `new URL('javascript:x')` has no host and the host check hides the change; explicit host-carrying payloads (`javascript://example.org/%0aalert(1)` and others) were added to the refused list, so the kill is now deterministic.
