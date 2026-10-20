# Sparta Pilot: Legal and Privacy Review Log

| Field | Value |
| --- | --- |
| Version | 0.1 |
| Date | 2026-10-20 |
| Nature | A check of the BRD and FDD against the main legal frameworks, written by an AI assistant at the product owner's request because the team has no legal expert. **It is not legal advice.** |
| Decision | The product owner has decided that a **professional review is out of scope for the pilot**, which is treated as an academic proof of concept, and required before any public, commercial or wider launch. |
| Frameworks considered | India's Digital Personal Data Protection Act, 2023 (and Rules, 2025); the EU and UK GDPR; CCPA/CPRA; research-ethics norms; scraping and database law in general; open-source licensing |

## 1. How findings were handled

| Status | Meaning |
| --- | --- |
| **Resolved** | Changed in the design documents or covered by a new legal document |
| **Accepted** | Risk accepted for the pilot, with reasons |
| **Deferred** | Needs a professional; to be done before any public or commercial launch |

## 2. Findings and outcomes

| # | Finding | Severity | Status | What was done and where |
| --- | --- | --- | --- | --- |
| 1 | Pilot consent: acceptance is required and the sharing setting is locked, which weakens "freely given" and "unconditional" consent and easy withdrawal | High | **Resolved** (mitigated), **Accepted** (residual), **Deferred** (professional opinion) | Pilot framed as a study ("taking part means sharing"); plain-language notice; **Leave the pilot** button (FR-66) that deletes the account and data; adults and invitation only; no penalty for leaving. See Privacy Policy sections 1, 4, 13; BRD BR-20 to BR-22; FDD FR-3, FR-4, FR-61, FR-66. The locked setting is the product owner's decision. |
| 2 | No named party responsible for the data | High | **Resolved** for the pilot | The "Sparta project team" (three students, ANCP Term 5, 2026) is named in the Privacy Policy, Terms and Vendor Agreement; the contact address is published in the app (FR-67). **Deferred:** who is the legal entity beyond the pilot. |
| 3 | "Global from day one" exposes the pilot to several privacy regimes | High | **Resolved** | Pilot is invitation-only, with a country allow-list, initially India (BR-16, FR-8, FR-9; LLD 4.9). Worldwide launch is out of scope for the pilot. |
| 4 | DPDP rules timing | Info | Noted | Main DPDP obligations start about May 2027, so the pilot is likely to run before them. The design follows the Act's principles anyway. Confirm the date in the official notification. |
| 5 | Need for a privacy policy and notice | High | **Resolved** | `PRIVACY-POLICY.md`, including the first-login notice text. |
| 6 | Re-identification risk with a small cohort | Medium | **Resolved** (controls), **Accepted** (residual) | `PRIVACY-RISK-ASSESSMENT.md`; vendor query log and rate limit (FR-88; LLD 5.7). |
| 7 | Receipts can hold sensitive details | Medium | **Resolved** | Masking of card-like numbers, emails and phone numbers; raw OCR text never stored; results deleted after 7 days (FR-47; LLD 7.4, 13.4); Terms tell users not to upload sensitive data. |
| 8 | Processors, transfers and the worker machine | Medium | **Resolved** (rules), **Deferred** (formal data processing agreements) | Providers and region disclosed in the Privacy Policy section 6; worker host rules (HLD, LLD). The providers' standard terms apply; no custom contracts. |
| 9 | No breach plan | Medium | **Resolved** | `INCIDENT-RESPONSE-PLAN.md`. |
| 10 | Backups keep deleted data up to 30 days | Low | **Resolved** | Disclosed in Privacy Policy sections 7 and 8; deletion within 7 days, backups within 30. |
| 11 | Age checked only by declaration | Low | **Accepted** | Adults only, invitation only, 18+ tick recorded (FR-2); terms say under 18 must not use the app. |
| 12 | Purpose limitation: later ML training | Medium | **Resolved** | The notice and policy say no model training; a new purpose needs a new notice and acceptance (BR-28; FR-5). |
| 13 | Scraping: "public" is not "permitted" | Medium | **Resolved** (rules), **Accepted** (residual), **Deferred** (professional opinion before any paid tier) | `DATA-SOURCING-POLICY.md`: ask first, attributes only, `robots.txt`, rate limit, takedown, record keeping. |
| 14 | No vendor agreement | Medium | **Resolved** | `VENDOR-PILOT-AGREEMENT.md`, accepted in the portal and recorded (FR-94). |
| 15 | No terms of use | Medium | **Resolved** | `TERMS-OF-USE.md`, accepted at sign-up and recorded (FR-68). |
| 16 | Cookies and analytics | Low | **Resolved** | Only essential cookies and first-party pseudonymous events; stated in the Privacy Policy section 11. |
| 17 | Open-source and model licences | Low | **Accepted**, with a check | GPL-3.0 code with MIT and Apache-2.0 libraries is generally compatible. Check each model's licence before release (LLD open item LOI-3). |
| 18 | The "Sparta" name may clash with trademarks | Low | **Deferred** | Do a trademark search before any public launch. |

## 3. Things that remain with the team

- Choose and publish the **contact address** for privacy requests (a configuration value, `CONTACT_EMAIL`; the pilot cannot open without it). Guidance: `CONTACT-ADDRESS.md`.
- Keep the **supported countries** list in `ops.settings` and the **invitations** list up to date.
- The **Supabase region** is South Asia (Mumbai, `ap-south-1`), with Vercel functions in Mumbai (`bom1`); it is shown in the app (FR-67) and named in the Privacy Policy.
- Obtain written **permission or confirmation** from catalogue sources where the policy asks for it.
- Tell faculty about the study and ask whether the course needs ethics approval. This is a recommendation, not a requirement the team has confirmed.

## 4. Before any public or commercial launch

A professional must review: the consent model and notices; the identity and structure of the data controller; applicable privacy laws for every country served; the terms, vendor contracts and fees; the scraping and database-rights position; the privacy risk assessment; the name and trademark position; data processing agreements and international transfers; and insurance. This log and the documents it points to are meant to give that professional a head start.
