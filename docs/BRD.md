# Sparta: Business Requirements Document (BRD)

| Field | Value |
| --- | --- |
| Document | Business Requirements Document |
| Version | 1.3 (adds the pilot recommendation engine; amends 1.2) |
| Date | 2026-10-29 |
| Product owner | Ambarish Sengupta |
| Status | Final, with the 1.3 amendment awaiting review by the solution architect |
| Related documents | FDD, HLD, LLD; legal pack in `legal`; ANCP D1 project charter (`docs/ANCP_TM_D1_v1.pdf`) |

## 1. Purpose

This document states what the business needs from the Sparta pilot and why. It does not describe how the system is built. Functional behaviour is in the FDD, architecture in the HLD and detailed design in the LLD.

## 2. Background and problem

Men often own many clothes yet struggle to decide what to wear or what to buy. Brands and retailers plan ranges and stock mainly from past sales and judgement. They cannot see what customers already own, what they still want, or which wardrobe gaps exist.

Sparta is a free digital wardrobe. Users catalogue what they own, build outfits, record purchases and keep a wishlist. Anonymised and aggregated data, covered by the consent rules in section 7.2, is shared with brands and retailers (vendors) to help them plan design, inventory and stocking.

This creates a chicken-and-egg problem. Users need a catalogue to get started. Vendors only sign up when there is user data to see. The pilot breaks the loop by seeding a small catalogue from public storefront data, so users can start immediately, and by collecting data organically as they use the app.

## 3. Business objectives

| ID | Objective |
| --- | --- |
| BO-1 | Build a real wardrobe, purchase and wishlist dataset, with users informed and consenting, through organic app use. |
| BO-2 | Prove that this dataset produces vendor insights that are useful (see section 11). |
| BO-3 | Sign up at least one vendor during the pilot as proof of commercial interest. |
| BO-4 | Provide a free, useful consumer product that people keep using. |
| BO-5 | Create a clean base (data model, consent records, open-source code) that later AI features and a native app can build on. |
| BO-6 | Offer outfit recommendations from an engine that is built and tested before the pilot on public data and style rules, and measure whether users accept its suggestions. |

## 4. Scope

### 4.1 In scope (pilot, 3 months)

- Consumer web app (responsive, installable as a PWA), English only, multi-currency price display.
- Seed catalogue built from publicly available storefront data (attributes such as category, colour, size, style, price), plus user-added items.
- Wardrobe: view, organise and edit everything the user owns.
- Item entry by manual form, photo upload with background removal, receipt scan with OCR, and catalogue or barcode lookup.
- Outfit builder and a recommendation engine for menswear outfits (section 7.5). Style rules (season, occasion, colour, layering, footwear) decide which outfits are allowed, a ranking step orders them, and a small image model suggests a category and sub-type when an item is added by photo.
- Building and testing that engine before the pilot opens, using public data (the Fashion-MNIST dataset) and photos owned by the team.
- Purchase history with receipts, wishlist and outfit/purchase planning.
- Invitation-only sign-up (email or Google sign-in; Apple sign-in after the pilot) for adults in the supported countries (initially India), acceptance of the Terms of Use and Privacy Policy, a first-login pilot notice that users must accept to join the study, a **Leave the pilot** button, data export and deletion.
- The pilot legal pack in `legal`: privacy policy, terms of use, vendor pilot agreement, incident response plan, privacy risk assessment and data sourcing policy.
- Vendor portal: read-only aggregate dashboard, gap and demand insights report, product feed upload.
- Open-source release of the codebase under GPL-3.0.

### 4.2 Out of scope (pilot)

- Native iOS and Android apps.
- Paid AI features, inspiration matching and a style chat assistant.
- Training, tuning or personalising any machine-learning model on participant data (BR-28, BR-52).
- Outfit inspiration (photo, link, feed) and wishlist suggestions to complete a look.
- Womenswear and other audiences.
- Payments, affiliate links, sponsored promotions, vendor billing.
- Email or inbox-based receipt import.
- Languages other than English.

## 5. Stakeholders

| Stakeholder | Interest |
| --- | --- |
| Product owner (Ambarish Sengupta) | Owns scope, priorities and acceptance. |
| Delivery team (C. Prashanth, Arpan Shah, Ambarish Sengupta) | Builds and runs the pilot. Also the ANCP project team. |
| Solution architect (C. Prashanth) | Owns and reviews the HLD and LLD. |
| Style specialist (Arpan Shah) | Owns the menswear taxonomy, outfit rules, ranking weights and style quality, and reviews sample suggestions before the pilot opens. |
| Pilot consumers | Men aged 18 and over, recruited for the pilot. |
| Pilot vendor(s) | At least one brand or retailer receiving the aggregate insights. |
| Course faculty | Review the academic project that this product supports. |

## 6. Target users

| Persona | Description | Main need |
| --- | --- | --- |
| Student or early-career man (18-25) | Small, changing wardrobe, budget-aware, phone first. | See what he owns and avoid buying duplicates. |
| Working professional (25-40) | Larger wardrobe, dressing for work and events, short on time. | Quick, occasion-appropriate outfits. |
| "Nothing to wear" everyday user | Owns clothes but struggles to combine them. | Simple outfit suggestions with little effort. |

The most important consumer outcome is **seeing and organising everything he owns**.

## 7. Business requirements

Priority uses MoSCoW: Must, Should, Could. Every requirement traces to the FDD, except BR-42 and BR-43, which are design constraints traced in the HLD, and BR-23, which applies to the shipped product and is not built or tested in the pilot (the pilot behaviour is BR-22).

### 7.1 Consumer

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-01 | Users can sign up and sign in with email or Google, and declare they are 18 or over. Apple sign-in is planned after the pilot. | Must |
| BR-02 | Users can see and organise their whole wardrobe: browse, filter by any attribute and sort by the main ones, custom tags and collections, favourites, a user-set "never worn" flag, and archive status (sold, donated, discarded or lost). | Must |
| BR-03 | Users can add items from a seed catalogue of popular items, so a new user is not facing an empty wardrobe. | Must |
| BR-04 | Users can add items that are not in the catalogue by manual entry. | Must |
| BR-05 | Users can add an item by photo upload, with automatic background removal. | Should |
| BR-06 | Users can add purchases from a receipt scan, with OCR extracting items, price, date and store. | Should |
| BR-07 | Users can look up an item by barcode or catalogue search. | Could |
| BR-08 | Users can record when, where and for how much they bought an item, and attach receipts. | Must |
| BR-09 | Users can keep a wishlist and plan future purchases. | Must |
| BR-10 | Users can build, save and plan outfits from items they own. | Must |
| BR-11 | Users receive up to three outfit suggestions for an occasion and season, made from their own wardrobe by the recommendation engine (section 7.5). | Must |
| BR-12 | Prices display in the original currency, with display conversion where available. | Should |
| BR-13 | The app is usable on a phone browser and installable as a PWA. | Must |
| BR-14 | Users can rate each item's condition themselves on a 0 to 100 scale (0 = brand new, 100 = falling apart). Vendors see condition as a spectrum of bands, not raw scores. | Should |
| BR-15 | Logging "what I wore today" is available but completely optional. The app never prompts, reminds or rewards it, and no wear counts are kept or aggregated, because a log is not a reliable measure of wear. | Could |
| BR-16 | The pilot is open by invitation only. Sign-up works only for invited email addresses, and the app can be used only by users who declare a country on the supported list (initially India) at onboarding. | Must |
| BR-17 | At sign-up users accept the Terms of Use and the Privacy Policy. Acceptance is recorded with the version and time. | Must |

### 7.2 Privacy and consent

The pilot and the shipped product use different consent settings. The pilot needs every user's anonymised data to prove the concept. The shipped product will not assume that.

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-20 | **Pilot:** on first login each user sees a pop-up explaining that the pilot is a free 3-month study and that anonymised, aggregated data from all participants is shared with vendors. The user must accept it to use the app. The wording follows the Privacy Policy (`legal/PRIVACY-POLICY.md`). | Must |
| BR-21 | **Pilot:** the pop-up states plainly who runs the pilot, what is shared with vendors and what they can and cannot see, that no data is used to train AI models, the pilot length (3 months) and how to leave, and links to the Privacy Policy, which sets out in full what is collected and how long data is kept. The acceptance is recorded with a timestamp and the notice version. | Must |
| BR-22 | **Pilot:** the sharing setting is visible in settings but greyed out and locked on, with an info tooltip explaining that the pilot is a study that needs anonymised data from its participants and that the shipped product will let users disable sharing. A prominent **Leave the pilot** button deletes the user's account and data at any time, with no reason needed and no penalty. | Must |
| BR-23 | **Shipped product:** users can disable sharing of anonymised data in settings. The default state (on or off) is decided before launch; see open item OI-1. | Must |
| BR-24 | Users can export their data and delete their account and data at any time, in both the pilot and the shipped product. | Must |
| BR-25 | Vendors never see individual users, wardrobes, receipts or purchase records. | Must |
| BR-26 | Vendor outputs show a segment only when at least 10 contributing users are in it during the pilot, and at least 50 in the shipped product. | Must |
| BR-27 | The system collects only the personal data it needs, and keeps images and receipts out of any shared dataset. | Must |
| BR-28 | The pilot does not use participant data to train AI or machine-learning models. Any new purpose needs a new notice and a new acceptance. | Must |
| BR-29 | Receipt scanning keeps only store, date, currency and item lines. Card numbers, emails, phone numbers and loyalty numbers are masked, address lines are dropped, raw scan text is never stored, and reading results are deleted after 7 days. | Must |

### 7.3 Vendor

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-30 | A vendor can sign in to a read-only aggregate dashboard showing the ownership mix by category, colour family, fit and brand, plus purchase and wishlist trends over time. | Must |
| BR-31 | A vendor can see gaps (segments with high wishlist demand and low ownership) and receive a gap and demand insights report. A monthly report is acceptable for the pilot. | Must |
| BR-32 | A vendor can upload a product feed so their items appear in the catalogue. | Should |
| BR-33 | Vendor data views respect the minimum group size and use only data from pilot participants who accepted the notice (BR-20) or, in the shipped product, users who have sharing on (BR-23). | Must |
| BR-34 | Vendor views can be filtered by size, season, price band or region, one filter at a time, where group sizes allow. | Should |
| BR-35 | Vendor queries are logged and rate limited, to detect and prevent attempts to single out a participant. | Must |
| BR-36 | A vendor must accept the Vendor Pilot Agreement (`legal/VENDOR-PILOT-AGREEMENT.md`) before first use. Acceptance is recorded. | Must |

### 7.4 Platform and data

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-40 | All wardrobe data uses one fixed taxonomy (category, colour, fit, material, brand, size) so aggregates are consistent. | Must |
| BR-41 | The seed catalogue is built from public storefront data under the data-sourcing rules in section 9. | Must |
| BR-42 | The system runs within a free or very low-cost hosting budget (see section 8). | Must |
| BR-43 | The codebase is open source under GPL-3.0, with no secrets or personal data in the repository. | Must |
| BR-44 | The pilot records usage events needed to measure the success criteria in section 11. | Must |
| BR-45 | When the pilot ends, participants are told in advance in the app and by email and can export their data. The team then either closes the pilot and, within 30 days, deletes all participants' data, including usage events, and the vendor query log, or asks each participant to accept a new notice and deletes the data of everyone who does not. This follows the Privacy Policy, section 7. | Must |

### 7.5 Recommendation engine

The engine recommends outfits. It has two stages: the occasion and season rules decide which outfits are allowed, and a ranking step, which also scores colour, pattern, layering and footwear, orders the allowed ones. A small image model helps with items added by photo.

What can and cannot be learned before the pilot has data: Fashion-MNIST is a public set of 70,000 small greyscale pictures of single garments, labelled with ten garment types. It can teach a model to recognise what kind of garment a photo shows. It says nothing about which garments go well together. Until there is real data, how well clothes go together comes from the style rules and ranking weights owned by the style specialist, and the pilot does not learn from participants (BR-28, BR-52).

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-50 | The engine recommends outfits only from the user's own active items. Every suggestion fits the chosen occasion and season and has the required pieces (top, bottom, footwear). Colour, pattern, layering and footwear matching are scored so that the best-matched outfits come first. Each suggestion states in one line why it was chosen. | Must |
| BR-51 | When a user adds an item by photo, the app suggests a category and sub-type from the picture. It is only a suggestion: the user confirms or changes it, and the app works the same way when no suggestion is made. | Should |
| BR-52 | The engine and its image model are built and tested before the pilot opens, using public data and photos owned by the team. No participant data is used to train, tune or personalise any machine-learning model during the pilot (BR-28). The team may still adjust the style rules and ranking weights by hand after reading overall accept and reject counts. | Must |
| BR-53 | Users stay in control: they can accept, swap or reject any suggestion, and the same wardrobe, occasion and date always give the same suggestions. | Must |
| BR-54 | The quality of the engine is checked before the pilot opens (section 11) and measured during it from the suggestion accept and reject events (BR-44). | Must |
| BR-55 | The engine runs within the free hosting budget (BR-42): suggestions are ranked in the user's browser, and the image model runs in the existing worker. | Must |

## 8. Constraints

- **Timeline:** a 3-month pilot, running alongside the ANCP course deadlines.
- **Team:** three people.
- **Budget:** free tiers wherever possible (for example Supabase and Vercel). If needed, self-host or pay no more than about $20 a month in total.
- **Scale:** about 100 pilot users, which is a good outcome and not a hard limit. Hosting must handle growth beyond that without redesign.
- **Platform:** web first (PWA). Native apps come after the pilot.
- **Audience:** men only, adults only, English only.
- **Legal expertise:** the team has no legal expert. The pilot is therefore invitation-only, adults only and limited to supported countries, and uses the legal pack in `legal`. A professional review is out of scope for the pilot and required before any public, commercial or wider launch.
- **Technology decisions** (backend, hosting split, OCR and image tooling) are delegated by the product owner to the architecture documents, which C. Prashanth (SA) will review.

## 9. Data sourcing and legal position

- The seed catalogue comes from publicly available product information (category, colour, size, style, price) from storefronts that allow data collection.
- The product owner's position is that this is low risk because the data is public, the project is academic proof of concept, nothing is commercialised, and the code is open source under GPL-3.0.
- User-added items are entered by the users themselves, so there is no scraping question for them.
- **Business rules the project will follow regardless, to keep that position strong:**
  - Collect only from sites whose `robots.txt` and terms allow it, and keep a record of each source and its terms.
  - Rate-limit requests and identify the collector.
  - Store product attributes and a link back to the source. Do not copy or redistribute product images.
  - Remove a source's data quickly if the source asks.
- Even a free, invitation-only pilot that offers vendor insights could be read as commercial use. A professional legal review must confirm the position before any public, commercial or wider launch, including any paid vendor tier (OI-3). This is noted as risk RK-3.
- The team has drafted a legal pack (privacy policy, terms, vendor agreement, incident plan, privacy risk assessment, data sourcing policy) in `legal`. It was written with AI assistance and has not been reviewed by a lawyer; `legal/LEGAL-REVIEW.md` records each finding and how it was handled.
- Collection follows `legal/DATA-SOURCING-POLICY.md`: ask first where possible, attributes only, `robots.txt`, rate limits, a source register and a 2-working-day takedown.

## 10. Assumptions and dependencies

- Enough men can be recruited through the team's networks to reach about 100 users.
- At least one vendor is willing to receive the dashboard and report and to give feedback.
- Several storefronts allow data collection, and their product pages expose the attributes the taxonomy needs.
- The Fashion-MNIST files (60,000 training and 10,000 test pictures, published by Zalando Research under the MIT licence) are held by the team in `data/recommendation-engine/mnist` and are not committed to the repository.
- The style specialist has time to set the ranking weights and review sample suggestions before the pilot opens.
- Free tiers of the chosen hosting and database services stay available and sufficient for the pilot.
- The product owner, delivery team and SA (C. Prashanth) are available for reviews within a few days of a request.

## 11. Success criteria

None of these is a hard gate. They define what "working" looks like and guide decisions.

| Area | Indicator | Indicative level |
| --- | --- | --- |
| Reach | Registered, consenting pilot users | About 100 (more is better) |
| Data | Items per active user; share of items with complete taxonomy fields | Enough to fill vendor segments of 10 or more users; most items complete |
| Consent | Users who accepted the pilot notice | All active pilot users |
| Engagement | Weekly active share of pilot users | Tracked from launch; target set after the first month |
| Vendor | Vendors who sign up | At least 1 |
| Proof | A vendor reviews the dashboard or report and says whether it would change a range or stock decision | Documented feedback |
| Quality | Segments shown meet the minimum group size, with no individual data exposed | 100% |
| Recommendations | Share of outfit suggestions that users accept (accepted / accepted + rejected) | Tracked from launch; target set after the first month |
| Photo suggestion | Share of photo-added items where the user keeps the suggested category | Tracked from launch; target set after the first month |
| Engine quality before launch | Image model accuracy on the 10,000 Fashion-MNIST test pictures; accuracy on photos of team-owned garments; share of sample suggestions the style specialist judges acceptable (FDD section 14.4) | About 90% or more on the test pictures; team-photo result reported; about 80% or more judged acceptable |

## 12. Pilot timeline (relative)

| Weeks | Focus |
| --- | --- |
| 1-2 | Requirements, architecture, seed catalogue collection, core app (accounts, catalogue, wardrobe). Train and test the image model on Fashion-MNIST (in parallel with the app). |
| 3-4 | Item entry methods, purchases, wishlist, outfit builder, consent flow. Start recruiting. |
| 5-6 | Recommendation engine (rules, ranking, swap order) and its pre-launch checks, receipt OCR, aggregation pipeline, vendor dashboard. Pilot opens. |
| 7-10 | Pilot running, vendor onboarding, fixes, feedback. |
| 11-12 | Vendor review, evaluation against section 11, write-up, decisions for the next phase. End-of-pilot notice to participants, then close-down or re-acceptance (BR-45). |

Dates will be fixed in the delivery plan, aligned with the ANCP deadlines.

## 13. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| RK-1 | Not enough users or vendors in 3 months. | Recruit early; keep onboarding to a few minutes; the seed catalogue means users can start at once. |
| RK-2 | Users find manual entry too much effort. | Seed catalogue, photo and receipt entry, and quick add from the catalogue. |
| RK-3 | Scraping or commercial-use concerns. | Follow the rules in section 9; a professional legal review confirms the position before any public, commercial or wider launch, including any paid vendor tier (OI-3). |
| RK-4 | Privacy or consent failure with real users. Making acceptance a condition of the pilot weakens the claim that consent is freely given. | The pilot is framed as a study; clear notice with recorded acceptance; **Leave the pilot** deletes everything; adults and invited users only; minimal data; aggregation only; no personal data in the repository; privacy risk assessment (`legal/PRIVACY-RISK-ASSESSMENT.md`). |
| RK-5 | Free tiers or the team's capacity limit the build. | Keep scope fixed to section 4; defer native apps and AI; review the plan weekly. |
| RK-6 | Small pilot makes aggregates thin. | Minimum group size of 10; report coverage clearly; do not over-claim. |
| RK-7 | No professional legal review during the pilot. | Invitation-only, adults only, supported countries only; the legal pack and review log; incident plan; a professional review is required before any public or commercial launch (OI-3). |
| RK-8 | The image model is trained on small, greyscale, studio-style product pictures and may do poorly on phone photos of real clothes (for example white, folded or patterned items). | The result is only a suggestion, shown above a confidence threshold; tested on team-owned photos before launch; switched off if results are poor (LLD 7.7); the app works without it. |
| RK-9 | Fashion-MNIST holds no information about which clothes go together, so outfit quality rests on the style rules until there is data to learn from, and suggestions may feel generic. | The style specialist owns the rules and weights and reviews sample suggestions before launch; acceptance and rejection are measured; learning from participant data waits for a new notice (OI-4). |

## 14. Decisions log

| Decision | Source |
| --- | --- |
| Men only, adults only, English only; the pilot is by invitation in supported countries (initially India); a wider or global launch comes after a professional review | Product owner |
| Web app (PWA) first | Product owner |
| Pilot: acceptance of the first-login anonymised-data notice is required to use the app; sharing can be turned off after the 3-month pilot | Product owner |
| Pilot: sharing setting shown greyed out and locked on, with explanatory tooltip; leaving is by deleting the account | Product owner |
| Shipped product: users can disable sharing; default state still open (OI-1) | Product owner |
| Aggregation only; minimum group of 10 in the pilot and 50 in the shipped product | Product owner |
| Seed catalogue from public storefront data, plus user-added items | Product owner |
| Vendor pilot receives dashboard, gap report and feed upload | Product owner |
| Outfit recommendations from a recommendation engine: team-curated style rules decide what is allowed, a ranking step orders it, and an image model trained on public Fashion-MNIST data helps with photo items | Product owner (29 October 2026) |
| The engine is built before the pilot on public data; no participant data trains, tunes or personalises any machine-learning model in the pilot | Follows BR-28; confirmed with the engine decision above |
| Free or under about $20 a month hosting | Product owner |
| Technology choices delegated to the architecture documents; C. Prashanth is the SA | Product owner |
| Arpan Shah is the style specialist (taxonomy and outfit rules) | Product owner |
| No hard numeric targets; about 100 users and 1 vendor is the aim | Product owner |
| The pilot is framed as an academic study; a **Leave the pilot** button deletes the account and data | Product owner (delegated to the business analyst) |
| No participant data is used to train AI or machine-learning models in the pilot | Product owner (delegated to the business analyst) |
| A professional legal review is out of scope for the pilot and required before any public or commercial launch | Product owner |

### Difference from the ANCP D1 charter

The ANCP D1 charter (`docs/ANCP_TM_D1_v1.pdf`) is a submitted course document and is not being changed. Where the two differ, this BRD and the legal pack in `legal` apply to the pilot.

| Topic | Charter | This BRD |
| --- | --- | --- |
| Users | 150 or more consenting users and 6,000 or more items by the data freeze | About 100 users, indicative only (section 11) |
| Backend | A Python backend serving web and mobile clients | Backend choices are left to the HLD; web (PWA) only in the pilot |
| Consent | Users opt in separately to sharing anonymised data with vendors | Accepting the first-login notice is required to use the app; sharing is locked on and users leave with **Leave the pilot** (BR-20 to BR-22); turning sharing off comes with the shipped product (BR-23, OI-1) |
| Launch scope | Global (meeting log) | Invitation-only in supported countries, initially India; a wider launch only after a professional review (BR-16, OI-3) |
| Vendor product feeds | Out of scope | Feed upload is in scope (BR-32) |
| Vendor payments | Vendors pay for dashboards and promotions (stakeholder map) | Vendors take part free; no payments or billing in the pilot (section 4.2) |
| Dates | MVP live 21 October, data freeze 30 October, term ends 20 November 2026 | A 3-month pilot on a relative timeline; dates set in the delivery plan (section 12) |
| Models and course data | Gap-ranking and forecasting models built on pilot data; pseudonymised, aggregated extracts in the course repository | No participant data is used to train AI or machine-learning models (BR-28). Course work, including the academic report and the charter's course-repository extracts, uses only public data and aggregated pilot figures (group figures built under the same rules as vendor outputs, and overall pilot statistics), with no row about an individual participant (Privacy Policy, section 4). These extracts are kept out of the public code repository, which holds no personal data (BR-43). The recommendation engine's image model is trained on the public Fashion-MNIST dataset, not on participant data (BR-52). |

## 15. Open items

| ID | Item | Owner |
| --- | --- | --- |
| OI-1 | Default sharing state in the shipped product. Off by default is the safest under GDPR and similar laws. On by default with an opt-out is simpler for data volume but weaker on consent. | Product owner |
| OI-2 | Closed for the pilot. The consent wording and the "acceptance required" model are covered by the legal pack and the privacy risk assessment. | Product owner |
| OI-3 | Before any public, commercial or wider launch, have a professional review the legal pack, the consent model, the scraping position and the name. | Product owner |
| OI-4 | Whether participant data may be used to improve the recommendation engine after the pilot. That would be a new purpose and needs a new notice and acceptance (BR-28; FDD FR-5). Until decided, the engine does not learn from participants. | Product owner |

## 16. Glossary

| Term | Meaning |
| --- | --- |
| Segment | A combination such as category + colour family + fit (+ size or season) used for aggregates. |
| Seed catalogue | The starting catalogue of popular items from public storefront data. |
| Gap | A segment with high wishlist demand and low ownership (BR-31). Its gap score is distinct wishlist users divided by distinct owning users, shown as "no visible ownership" when the owning count is zero or suppressed, as defined in the FDD (FR-81). |
| Vendor | A brand, manufacturer or retailer receiving aggregate insights. |
| PWA | Progressive web app, a website that installs and behaves like an app. |
| Recommendation engine | The part of the app that proposes outfits: style rules decide what is allowed, a ranking step orders it (section 7.5; FDD section 14). |
| Garment model | A small image model, trained on the public Fashion-MNIST dataset, that guesses what kind of garment a photo shows (FDD section 14.3). |
| Fashion-MNIST | A public dataset from Zalando Research of 70,000 greyscale 28 by 28 pixel pictures in ten garment types, used here to train the garment model. |
