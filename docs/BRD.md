# Sparta: Business Requirements Document (BRD)

| Field | Value |
| --- | --- |
| Document | Business Requirements Document |
| Version | 1.0 (final, approved by the Product Owner) |
| Date | 2026-10-20 |
| Product owner | Ambarish Sengupta |
| Status | Final |
| Related documents | FDD, HLD, LLD (to follow); ANCP D1 project charter (`docs/ANCP_TM_D1_v1.pdf`) |

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

## 4. Scope

### 4.1 In scope (pilot, 3 months)

- Consumer web app (responsive, installable as a PWA), English only, multi-currency price display.
- Seed catalogue built from publicly available storefront data (attributes such as category, colour, size, style, price), plus user-added items.
- Wardrobe: view, organise and edit everything the user owns.
- Item entry by manual form, photo upload with background removal, receipt scan with OCR, and catalogue or barcode lookup.
- Outfit builder and a small rule-based menswear recommendation set (season, occasion, colour and layering).
- Purchase history with receipts, wishlist and outfit/purchase planning.
- Accounts (email or Google sign-in; Apple sign-in after the pilot), 18+ self-declaration, a first-login pilot notice that users must accept to join the pilot, data export and deletion.
- Vendor portal: read-only aggregate dashboard, gap and demand insights report, product feed upload.
- Open-source release of the codebase under GPL-3.0.

### 4.2 Out of scope (pilot)

- Native iOS and Android apps.
- ML or paid AI features: AI outfit recommendations, inspiration matching, style chat assistant.
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
| Style specialist (Arpan Shah) | Owns the menswear taxonomy, outfit rules and style quality. |
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

Priority uses MoSCoW: Must, Should, Could. Every requirement is testable in the FDD.

### 7.1 Consumer

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-01 | Users can sign up and sign in with email or Google, and declare they are 18 or over. Apple sign-in is planned after the pilot. | Must |
| BR-02 | Users can see and organise their whole wardrobe: browse, filter and sort by any attribute, custom tags and collections, favourites, a user-set "never worn" flag, and archive status (sold or donated). | Must |
| BR-03 | Users can add items from a seed catalogue of popular items, so a new user is not facing an empty wardrobe. | Must |
| BR-04 | Users can add items that are not in the catalogue by manual entry. | Must |
| BR-05 | Users can add an item by photo upload, with automatic background removal. | Should |
| BR-06 | Users can add purchases from a receipt scan, with OCR extracting items, price, date and store. | Should |
| BR-07 | Users can look up an item by barcode or catalogue search. | Could |
| BR-08 | Users can record when, where and for how much they bought an item, and attach receipts. | Must |
| BR-09 | Users can keep a wishlist and plan future purchases. | Must |
| BR-10 | Users can build, save and plan outfits from items they own. | Must |
| BR-11 | Users receive outfit suggestions from a small rule set based on season, occasion, colour and layering. | Should |
| BR-12 | Prices display in the original currency, with display conversion where available. | Should |
| BR-13 | The app is usable on a phone browser and installable as a PWA. | Must |
| BR-14 | Users can rate each item's condition themselves on a 0 to 100 scale (0 = brand new, 100 = falling apart). Vendors see condition as a spectrum of bands, not raw scores. | Should |
| BR-15 | Logging "what I wore today" is available but completely optional. The app never prompts, reminds or rewards it, and no wear counts are kept or aggregated, because a log is not a reliable measure of wear. | Could |

### 7.2 Privacy and consent

The pilot and the shipped product use different consent settings. The pilot needs every user's anonymised data to prove the concept. The shipped product will not assume that.

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-20 | **Pilot:** on first login each user sees a pop-up explaining that anonymised, aggregated data is used to make the pilot work. The user must accept it to use the app. | Must |
| BR-21 | **Pilot:** the pop-up states plainly what is collected, what vendors can and cannot see, how long the pilot lasts (3 months), and how to leave. The acceptance is recorded with a timestamp and the notice version. | Must |
| BR-22 | **Pilot:** the sharing setting is visible in settings but greyed out and locked on, with an info tooltip explaining that the pilot needs anonymised user data and that the shipped product will let users disable sharing. A user can leave at any time by deleting their account, which removes their data from future aggregates. | Must |
| BR-23 | **Shipped product:** users can disable sharing of anonymised data in settings. The default state (on or off) is decided before launch; see open item OI-1. | Must |
| BR-24 | Users can export their data and delete their account and data at any time, in both the pilot and the shipped product. | Must |
| BR-25 | Vendors never see individual users, wardrobes, receipts or purchase records. | Must |
| BR-26 | Vendor outputs show a segment only when at least 10 contributing users are in it during the pilot. | Must |
| BR-27 | The system collects only the personal data it needs, and keeps images and receipts out of any shared dataset. | Must |

### 7.3 Vendor

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-30 | A vendor can sign in to a read-only aggregate dashboard showing the ownership mix by category, colour, fit and brand, plus purchase and wishlist trends over time. | Must |
| BR-31 | A vendor can see gaps (segments with high wishlist demand and low ownership) and receive a gap and demand insights report. A monthly report is acceptable for the pilot. | Must |
| BR-34 | Vendor views can be filtered by size, season, price band and region, where group sizes allow. | Should |
| BR-32 | A vendor can upload a product feed so their items appear in the catalogue. | Should |
| BR-33 | Vendor data views respect the minimum group size and use only data from users covered by BR-20 or BR-23. | Must |

### 7.4 Platform and data

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-40 | All wardrobe data uses one fixed taxonomy (category, colour, fit, material, brand, size) so aggregates are consistent. | Must |
| BR-41 | The seed catalogue is built from public storefront data under the data-sourcing rules in section 9. | Must |
| BR-42 | The system runs within a free or very low-cost hosting budget (see section 8). | Must |
| BR-43 | The codebase is open source under GPL-3.0, with no secrets or personal data in the repository. | Must |
| BR-44 | The pilot records usage events needed to measure the success criteria in section 11. | Must |

## 8. Constraints

- **Timeline:** a 3-month pilot, running alongside the ANCP course deadlines.
- **Team:** three people.
- **Budget:** free tiers wherever possible (for example Supabase and Vercel). If needed, self-host or pay no more than about $20 a month in total.
- **Scale:** about 100 pilot users, which is a good outcome and not a hard limit. Hosting must handle growth beyond that without redesign.
- **Platform:** web first (PWA). Native apps come after the pilot.
- **Audience:** men only, adults only, English only.
- **Technology decisions** (backend, hosting split, OCR and image tooling) are delegated by the product owner to the architecture documents, which C. Prashanth (SA) will review.

## 9. Data sourcing and legal position

- The seed catalogue comes from publicly available product information (category, colour, size, style, price) from storefronts that allow data collection.
- The product owner's position is that this is low risk because the data is public, the project is academic proof of concept, nothing is commercialised, and the code is open source under GPL-3.0.
- User-added items are entered by the users themselves, so there is no scraping question for them.
- **Business rules the project will follow regardless, to keep that position strong:**
  - Collect only from sites whose `robots.txt` and terms allow it, and keep a record of each source and its terms.
  - Rate-limit requests and identify the collector.
  - Store product attributes and a link back to the source. Do not copy or redistribute product images by default.
  - Remove a source's data quickly if the source asks.
- A pilot that is open to the public and offers vendor insights could be read as commercial use. The SA or a legal adviser should confirm the position before any paid vendor tier. This is noted as risk RK-3.

## 10. Assumptions and dependencies

- Enough men can be recruited through the team's networks to reach about 100 users.
- At least one vendor is willing to receive the dashboard and report and to give feedback.
- Several storefronts allow data collection, and their product pages expose the attributes the taxonomy needs.
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

## 12. Pilot timeline (relative)

| Weeks | Focus |
| --- | --- |
| 1-2 | Requirements, architecture, seed catalogue collection, core app (accounts, catalogue, wardrobe). |
| 3-4 | Item entry methods, purchases, wishlist, outfit builder, consent flow. Start recruiting. |
| 5-6 | Rule-based outfits, receipt OCR, aggregation pipeline, vendor dashboard. Pilot opens. |
| 7-10 | Pilot running, vendor onboarding, fixes, feedback. |
| 11-12 | Vendor review, evaluation against section 11, write-up, decisions for the next phase. |

Dates will be fixed in the delivery plan, aligned with the ANCP deadlines.

## 13. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| RK-1 | Not enough users or vendors in 3 months. | Recruit early; keep onboarding to a few minutes; the seed catalogue means users can start at once. |
| RK-2 | Users find manual entry too much effort. | Seed catalogue, photo and receipt entry, and quick add from the catalogue. |
| RK-3 | Scraping or commercial-use concerns. | Follow the rules in section 9; confirm with an adviser before any paid tier. |
| RK-4 | Privacy or consent failure with real users. Making acceptance a condition of the pilot weakens the claim that consent is freely given. | Clear first-login notice with recorded acceptance, leave-any-time by deleting the account, minimal data, anonymised aggregation only, no personal data in the repository. Confirm the pilot consent wording with an adviser before launch. |
| RK-5 | Free tiers or the team's capacity limit the build. | Keep scope fixed to section 4; defer native apps and AI; review the plan weekly. |
| RK-6 | Small pilot makes aggregates thin. | Minimum group size of 10; report coverage clearly; do not over-claim. |

## 14. Decisions log

| Decision | Source |
| --- | --- |
| Men only, adults only, English only, global | Product owner |
| Web app (PWA) first | Product owner |
| Pilot: acceptance of the first-login anonymised-data notice is required to use the app; sharing can be turned off after the 3-month pilot | Product owner |
| Pilot: sharing setting shown greyed out and locked on, with explanatory tooltip; leaving is by deleting the account | Product owner |
| Shipped product: users can disable sharing; default state still open (OI-1) | Product owner |
| Aggregation only; minimum group of 10 in the pilot | Product owner |
| Seed catalogue from public storefront data, plus user-added items | Product owner |
| Vendor pilot receives dashboard, gap report and feed upload | Product owner |
| Rule-based outfits from a small team-curated set | Product owner |
| Free or under about $20 a month hosting | Product owner |
| Technology choices delegated to the architecture documents; C. Prashanth is the SA | Product owner |
| Arpan Shah is the style specialist (taxonomy and outfit rules) | Product owner |
| No hard numeric targets; about 100 users and 1 vendor is the aim | Product owner |

### Difference from the ANCP D1 charter

The charter says 150 or more users and describes a Python backend. This BRD treats user numbers as indicative, and leaves backend choices to the HLD. The charter's text may need a small update later.

## 15. Open items

| ID | Item | Owner |
| --- | --- | --- |
| OI-1 | Default sharing state in the shipped product. Off by default is the safest under GDPR and similar laws. On by default with an opt-out is simpler for data volume but weaker on consent. | Product owner |
| OI-2 | Confirm the pilot consent wording and the "acceptance required" model with an adviser before launch. | Product owner |

## 16. Glossary

| Term | Meaning |
| --- | --- |
| Segment | A combination such as category + colour + fit (+ size or season) used for aggregates. |
| Seed catalogue | The starting catalogue of popular items from public storefront data. |
| Gap | A segment where users own little but want or buy more. |
| Vendor | A brand, manufacturer or retailer receiving aggregate insights. |
| PWA | Progressive web app, a website that installs and behaves like an app. |
