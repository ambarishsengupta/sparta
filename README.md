# Sparta

**Your wardrobe, digitised, with a privacy-first insights layer for the brands and retailers who make and sell clothes.**

Sparta is a free web app (installable as a PWA) where men catalogue their clothes and accessories, build outfits, record what they bought and where, and plan future purchases. Anonymised, aggregated data from pilot users gives brands and retailers a demand signal for planning ranges and stock, instead of relying on gut feeling.

This is an open-source, academic proof of concept. The current phase is a **3-month pilot** that builds a real dataset from organic app use and tests whether it produces vendor insights worth having. The pilot aims for about 100 users and at least one vendor; these are indicative, not hard targets.

## Who it is for

| Audience | What they get |
| --- | --- |
| **Consumers** (men, 18 and over, English only for now) | A free digital wardrobe with outfit building, outfit suggestions from a recommendation engine, purchase history with receipts, a wishlist and planning. The pilot is by invitation, in the countries where it is open (initially India). |
| **Vendors** (brands, manufacturers and retailers) | Aggregate dashboards, gap and demand insights, and product feed upload. Invited by the team, read-only. |

## Consumer features (pilot)

- **See and organise everything you own:** browse, filter by any attribute and sort by the main ones, custom tags and collections, favourites, a "never worn" flag, archive (sold, donated, discarded, lost).
- **Four ways to add items:** a seed catalogue of popular items; a manual form; photo upload with automatic background removal and a suggested category from a small image model; receipt scan with OCR (always shown as an editable draft).
- **Full colour spectrum:** pick any colour; Sparta derives a colour family so that near-identical shades group together.
- **Condition rating:** rate each item from 0 (brand new) to 100 (falling apart).
- **Outfits:** a slot-based builder, up to three suggestions for an occasion and season from the recommendation engine (style rules plus ranking), each with a one-line reason and a most-similar-first swap list, and a planning calendar. Logging "what I wore" is optional and never prompted.
- **Purchases and wishlist:** record when, where and for how much you bought something, attach receipts, keep a wishlist and plan purchases by month and budget. Prices keep their original currency.
- **Your data, your control:** export all of your data and delete your account at any time.

## Vendor features (pilot)

- **Dashboard:** ownership mix by category, colour family, fit and brand; purchase and wishlist trends over time; gaps (high wishlist demand, low ownership); a condition spectrum that hints at replacement demand; filters by size, season, price band and region.
- **Gap and demand report:** a monthly report reviewed by the team before the vendor sees it.
- **Product feed upload:** vendors can upload their catalogue so their items appear in the app.

## Privacy

Vendor insights depend on trust, so privacy rules are built into the design and enforced in the database.

1. **The pilot is a study, and sharing is part of taking part.** On first login each user sees a plain-language notice explaining that the pilot is a free 3-month study run by a student team and that anonymised group figures are shared with vendors, and must accept it to use the app. The sharing setting is visible but locked on during the pilot, with an explanation. A **Leave the pilot** button deletes the account and data at any time, with no reason needed. No data is used to train AI models.
2. **The shipped product will differ.** Users will be able to disable sharing. The default state is still to be decided before any wider launch.
3. **Aggregated only.** Vendors never see individual users, wardrobes, photos, receipts, notes or purchase records.
4. **Minimum group size.** A segment is shown only when at least 10 users contribute during the pilot (50 in production). Counts are rounded to the nearest 5, and neighbouring segments are hidden where needed to stop figures being worked out by subtraction.
5. **Minimal data.** Only the fields the app needs are collected. Images and receipts are never part of any shared dataset.
6. **Seed catalogue data.** Product attributes only, from sources that allow collection (checked against `robots.txt` and terms), collected politely and with links back to the source. Product images are not copied.

The pilot is invitation-only, adults only, and limited to supported countries. The privacy and legal documents in [`legal`](legal) were drafted without a lawyer for this academic proof of concept; they are not legal advice, and a professional review is required before any public or commercial launch.

## How it is built

```
 Web app (Next.js PWA on Vercel)   consumer, vendor and admin areas
          |
          v
 Supabase: Postgres, Auth, Storage, row-level security, scheduled jobs
          ^
          |  polls jobs (outbound only)
 Python worker (Docker, self-hosted): background removal, receipt OCR
 GitHub Actions: catalogue collector, exchange rates, keep-alive
```

- **Free or near-free hosting:** Supabase and Vercel free tiers, GitHub Actions, and a self-hosted worker container.
- **Privacy in the database:** row-level security on every user table, consent checks, vendor access only through functions that apply the group-size rules.
- **Python where it counts:** a Python worker from the start, which also runs the small garment model behind photo suggestions.
- **A recommendation engine built before there is data:** style rules and ranking run in the browser; the garment model is trained once, offline, on the public Fashion-MNIST dataset (kept out of the repository, see [`data/recommendation-engine`](data/recommendation-engine)). Nothing is trained on participants.

Full detail is in the design documents below.

## Documents

| Document | Purpose |
| --- | --- |
| [Business Requirements (BRD)](docs/BRD.md) | What the business needs and why; scope, requirements, risks |
| [Functional Design (FDD)](docs/FDD.md) | What the system does, screen by screen and rule by rule |
| [High-Level Design (HLD)](docs/HLD.md) | Architecture, components, security, deployment |
| [Low-Level Design (LLD)](docs/LLD.md) | Tables, policies, functions, worker, API routes, tests, operations |
| [Legal and privacy pack](legal/README.md) | Privacy policy, terms of use, vendor pilot agreement, incident plan, privacy risk assessment, data sourcing policy, privacy contact address and review log (pilot drafts, not legal advice) |
| [ANCP D1 project charter](docs/ANCP_TM_D1_v1.pdf) | The course charter that frames this project (Group M) |

## Out of scope for the pilot

Native iOS and Android apps; paid AI features, inspiration matching and a style chat assistant; training, tuning or personalising any model on participant data; outfit inspiration from photos, links or feeds, and wishlist suggestions to complete a look; womenswear and other audiences; payments, affiliate links, sponsored promotions and vendor billing; email or inbox-based receipt import; and languages other than English. Some of these may follow after the pilot (see BRD section 4.2).

## Status

The design documents (BRD, FDD, HLD, LLD) are final; each lists its remaining open items. The legal and privacy pack is a set of pilot drafts and is not legal advice. The charter is the course document already submitted. Implementation has not started, so there is no application code in this repository yet. The recommendation engine was added to the pilot design on 2026-10-29 (BRD section 7.5, FDD section 14). Build order and milestones are in section 14 of the LLD.

## Contributing

Open an issue or pull request. Do not commit secrets or personal data. Changes to security policies or vendor-facing functions need a database test and a review.

## Licence

Licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
