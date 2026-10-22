# Sparta Pilot: Privacy Risk Assessment

| Field | Value |
| --- | --- |
| Version | 0.2 (draft for the academic pilot) |
| Date | 2026-10-22 |
| Type | Lightweight data protection impact assessment, written by the project team with AI assistance |
| Review status | **Not reviewed by a lawyer or privacy professional.** Intended to support a professional review before any public or commercial launch. |
| Scope | The pilot as described in BRD v1.2, FDD v1.3, HLD v1.2 and LLD v1.2 |

## 1. The processing in brief

| Item | Description |
| --- | --- |
| Purpose | Test whether anonymised group data from consumer wardrobes helps brands and retailers plan design and stock. An academic proof of concept. |
| People | About 100 adult men, invited, in the countries where the pilot is open (initially India) |
| Data | Account details, wardrobe items with photos, purchases, receipt images and the lines read from them, wishlist, outfits, usage events (FDD section 13 and the Privacy Policy, section 3) |
| Flow | Participants enter data; a nightly job builds anonymised group figures; vendors see only figures that pass the group-size and rounding rules |
| Where | Supabase (database, files, sign-in), Vercel (web, including data exports), a team member's machine (photo and receipt processing, encrypted weekly backups), another team member's private storage (second encrypted backup copy; provider and country to be named before the pilot opens), GitHub (code and scheduled jobs) |
| Retention | Account data and usage events until deletion or pilot end; invitation list until the person leaves or the pilot ends; receipt-reading results 7 days; exports 7 days; backups 30 days; vendor query log and reviewed vendor reports for the pilot period (Privacy Policy, section 7) |

## 2. Why it is necessary and proportionate

- The data is needed because the question under study is whether this kind of data is useful. Questionnaires and interviews were considered and rejected as less natural and less reliable.
- Only the fields the app needs are collected. Free text is kept out of every shared figure. Photos and receipts never enter the anonymised data.
- Vendors receive group figures, never rows about individuals.
- Participants are adults, are invited, are told what the study is, and can leave at any time with their data deleted.
- The data is not used to train models, for advertising, or for any purpose outside the notice.

## 3. Risks and controls

Likelihood and impact use Low, Medium and High. Residual is after the controls.

| # | Risk | Before | Controls | Residual |
| --- | --- | --- | --- | --- |
| P1 | A vendor works out one participant's data from group figures (re-identification) | M / H | Minimum group of 10; rounding to 5; complementary suppression; at most one filter at a time; no raw user IDs; user code changes on each run; **vendor query log and rate limit**; vendor agreement forbids re-identification attempts; small fixed set of dimensions (section 4) | Low to Medium |
| P2 | Participant data is seen by another participant (access control failure) | L / H | Database row-level security on every table; consent check; automated tests that try cross-user access on every build; review of every policy | Low |
| P3 | Receipts reveal sensitive details (card number, address, loyalty ID, phone, email) | M / M | Users are told not to upload sensitive data and to cover or crop card numbers and addresses; card-like numbers, emails, phone numbers and loyalty or membership numbers are masked and address lines dropped in the lines kept; raw receipt text is never stored; results deleted after 7 days; receipt images are not masked, are private to the user and are deleted when the user deletes them or the account | Low to Medium |
| P4 | Photos show faces or other people's details | M / L | Terms ask for photos of clothes only; background removal; private storage; no vendor access to any photo | Low |
| P5 | A team member's machine (worker) is lost, stolen or misused | M / M | Disk encryption; no open inbound connections; temporary files deleted after each job; the worker has a limited database role (job queue and results, catalogue lookups, its heartbeat) and reaches photos and receipts only through short-lived signed URLs for the job it is running; the Supabase secret key is not on the machine; the machine also holds a read-only backup login that can read all data, and the weekly backups, which are encrypted with a decryption key kept elsewhere (LLD 13.3); rotation steps in the incident plan | Medium |
| P6 | Provider breach (Supabase, Vercel, email) | L / H | Reputable providers; encrypted transport; least data sent to the email service; standard data processing terms; incident plan | Low |
| P7 | Consent is not really free because taking part means sharing | M / M | Framed as study participation; plain-language notice; no pressure; **"Leave the pilot" deletes everything**; invitation-only; adults only; no penalty for leaving | Medium (accepted for the pilot) |
| P8 | Data used for new purposes (for example training models) | L / M | Notice says it will not be; a new purpose needs a new notice and acceptance; reviewed at each phase | Low |
| P9 | Data kept longer than needed | M / M | Fixed retention table; scheduled deletion jobs; at pilot end, delete or re-consent | Low |
| P10 | Unauthorised access to the vendor portal or admin console | L / H | Invitation-only accounts; roles; vendor accepts the agreement; admin console actions logged (LLD section 6); strong passwords and email verification | Low |
| P11 | Participants from countries with stricter laws | M / M | Pilot limited to invited users in listed countries (initially India); country check at sign-up | Low to Medium |
| P12 | Loss of data (outage, deletion) | M / M | Weekly encrypted backups of the database (not of stored photos or receipt images) held in two places; restore rehearsed before opening | Low to Medium |
| P13 | Deleted data remains in backups | H / L | Disclosed in the notice (up to 30 days); a deletion log (user IDs only, kept 30 days) is used after any restore to delete again the accounts deleted since that backup | Low |

## 4. Re-identification: how it could happen and what stops it

| Attack | Example | Stopped by |
| --- | --- | --- |
| **Small group** | Asking for "oversized maroon cardigan, brand X, size XXL" and finding a count of 1 | Segments with fewer than 10 participants are never shown |
| **Differencing** | Comparing "all tops" with "all tops except the one that was hidden" to compute the hidden segment | Complementary suppression hides further segments until the hidden ones together cover at least 10 participants in every total they add up to, so a hidden segment cannot be recovered; rounding to 5 |
| **Combining filters** | Narrowing by size, then by season, then by region until the group is tiny | Only one filter at a time; every combination is checked against the group-size rule |
| **Repeating over time** | Comparing figures from successive nightly runs to detect one person joining or leaving | Rounding to 5, the minimum group of 10 and complementary suppression, which hide most changes of one person; vendors can query only the latest run, though they could record each night's figures themselves; the query log (every answered call) and the rate limit expose only high-volume probing; the agreement forbids it |
| **Linking with outside data** | Matching a vendor's own customer list against a segment | Only group figures leave Sparta; the agreement forbids re-identification attempts |
| **Insider** | A team member looks at an individual account | Team access is limited to the three team members and to running and fixing the service; admin console actions are logged; direct database access through the Supabase dashboard is not separately logged on the free plan; the team agrees not to browse accounts |

### Extra controls specific to the pilot

1. **Vendor query log and limit.** Every answered vendor query is logged (who, which function, which parameters, when). A vendor may make at most 200 calls per hour; a call refused by the limit is not logged, but the 200 calls before it are.
2. **Review before the first vendor demo.** The team checks every dashboard view with test data for small-group and differencing weaknesses and records the result.
3. **No new dimension or filter** is added to vendor views without updating this assessment.
4. **Brand-level views** show only brands with at least 10 contributing participants in the segment, as for every other dimension.

## 5. Conclusion

With the controls above, the remaining risks are acceptable for an invitation-only academic pilot of about 100 adults. Risk P7 (the strength of consent when sharing is part of taking part) is the one to put in front of a professional first. This assessment must be repeated, and professionally reviewed, before the product is opened to the public, offered commercially, used with minors, used to train models, or sold to vendors for a fee.

## 6. Actions

| Action | Owner | When |
| --- | --- | --- |
| Add the vendor query log and rate limit | Technical lead | Before vendors get access |
| Run the dashboard check with test data and record the result | Technical lead and product owner | Before the first vendor demo |
| Rehearse the backup restore | Technical lead | Before the pilot opens |
| Practise the incident plan with a leaked-key scenario | All | Before the pilot opens |
| Review this assessment | All | At pilot midpoint and at pilot end |
