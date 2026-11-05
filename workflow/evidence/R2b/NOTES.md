# R2b WO-0051 notes: acceptance, pilot notice, onboarding and not-available screens

## Built
- Pages under `apps/web/app/(auth)/`: `accept-terms`, `pilot-notice`, `onboarding`, `not-available` (they answer 404 unless `NEXT_PUBLIC_DATA_BACKEND=supabase`), plus public `/privacy` and `/terms`.
- Each is reached only through `decideRoute` (proxy): `needs_documents` -> accept-terms, `needs_pilot_notice` -> pilot-notice, `needs_onboarding` -> onboarding, `not_available` -> not-available. The forms finish with a fixed `window.location.assign('/')` and the proxy sends the person to the next step.
- `lib/supabase/consent-actions.ts`: `readVersions` (`app.public_setting`), `readSupportedCountries` (`app.supported_countries`), `acceptDocuments` (`accept_documents`), `acceptPilotNotice` (insert into `app.consent_records`), `completeOnboarding` (`complete_onboarding`). All use the caller's session. No server text reaches the screen except fixed messages.
- Notice text: `lib/consent-form.ts` holds the three paragraphs of `legal/PRIVACY-POLICY.md` section 13 and the FR-61 and FR-9 sentences; a test reads the legal file and the FDD and fails if they differ by one character.

## Decisions
1. Versions (the open gap of WO-0050): terms, privacy and notice versions are read from `app.public_setting` on the server when a page renders; the form sends exactly those values. `accept_documents` raises `stale_version`, and the consent insert policy refuses a notice version that is not current, so a page that is out of date gets "Reload the page" and nothing is stored. There are no version constants in the app.
2. Legal documents: link only. `/privacy` and `/terms` are public pages that name the repository file (`legal/PRIVACY-POLICY.md`, `legal/TERMS-OF-USE.md`); `/privacy` also shows the section 13 notice. Rendering the markdown needs a renderer or a build step outside this work order's size, and `legal/` is not inside `apps/web`, so it would not deploy with it. A participant cannot open a repository file: a rendered copy is needed before real participants (suggest R2c).
3. "No thanks" is Sign out (POST `/auth/sign-out`), with a plain explanation; the notice is shown again at the next sign-in.
4. Country: the select lists the countries from `app.supported_countries()` and "My country is not listed", which asks for a two-letter code (the database checks `^[A-Z]{2}$`). Without that option nobody could ever give an unsupported country, which FR-9 needs. A note says the pilot is not open there. An unsupported answer is kept by the database and the person is held at not-available.
5. Pre-fills (FR-6): hemisphere from a short list of mostly-southern countries (everything else north), currency INR for India else USD (the `profiles.currency` default). Both can be changed. The currency list is `Intl.supportedValuesOf('currency')`, built on the server.

## Document gaps (quoted)
- LLD 9.1 says: "records the notice version from a constant shipped with the app and equal to `ops.settings.current_notice_version`". The work order says the versions come from `app.public_setting`; that is what is built (decision 1). The migration comment ("the web build's constants must equal them") is moot.
- FDD FR-4: "Tapping "No thanks" or closing the pop-up does not join the pilot. The user then sees only a page offering Export my data, Leave the pilot (the deletion in FR-66) and Sign out". LLD 9.1: "`/not-available` offers only Export my data, Leave the pilot and Sign out." The work order: "no Decline path except sign out". Built: Sign out only. Export and Leave the pilot are R2c.
- The notice text itself (Privacy Policy section 13, FR-3) tells people "You can leave at any time with Leave the pilot, which deletes your account and data". That control does not exist until R2c. Until then the notice promises something the app cannot do; the pilot must not open to real participants before R2c.
- FR-61 describes the locked sharing setting in Settings with an information tooltip. Settings is R2c; the locked, ticked, disabled control and the FR-61 sentence (in a native details element, which works without scripts) are on the pilot notice page as the work order asks.
- FR-7 (start from popular items or add my own) is not built: there is no catalogue picker yet. After onboarding the person lands on the wardrobe.
- FR-3 calls the notice a "pop-up"; LLD 9.1 calls it "the blocking pop-up page". Built as a full page.
- FR-6 says hemisphere is "pre-filled from the country"; no document gives the mapping (decision 5).

## Not done
- Export my data, Leave the pilot, About, Settings (R2c). Rendering of the legal documents. The Supabase repository (WO-0052). CC5 screenshots (WO-0052); the screens were walked once by hand in the built app against the local stack (sign-up, confirmation, accept-terms, pilot-notice, onboarding for India and for an unlisted country) and the test users were deleted.
