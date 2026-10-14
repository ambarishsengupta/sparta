# Sparta

**Your wardrobe, digitized, with a privacy-first insights layer for the brands and retailers who make and sell clothes.**

Sparta is a free app (mobile and web) where men catalog their clothes and accessories, build outfits, track what they bought and where, and plan future purchases. With each user's opt-in consent, anonymized and aggregated wardrobe data gives brands and retailers a demand signal for planning inventory, stocking and operations, instead of relying on gut feeling.

## Who it's for

| Audience | What they get | How they pay |
| --- | --- | --- |
| **Consumers** (men only at launch) | A free digital wardrobe with outfit building, rule-based recommendations, purchase history, receipts, wishlist and planning | Free. Optional paid AI features. Voluntary donations. |
| **Vendors** (brands/manufacturers and retailers) | Aggregated trend dashboards, demand forecasts, wardrobe-gap analysis, and the ability to publish catalogs and sponsored promotions | Subscriptions for analytics and sponsored promotions. This is the primary revenue. |

## Consumer features

### Wardrobe
- Add items by:
  - **Photo upload** with automatic background removal.
  - **Manual entry form.**
  - **Receipt scan**, where OCR extracts the items.
  - **Catalog or barcode lookup**, which pulls items from vendor product feeds.
- Every item uses a fixed taxonomy (category, colour, fit, material, brand, size) so data stays clean and comparable.

### Outfits and recommendations
- **Outfit builder:** combine items into outfits and save them.
- **Rule-based recommendations (free):** menswear rules driven by season and occasion.
- **Outfit inspiration:** add inspiration by
  - uploading a photo of an outfit,
  - pasting a link (Pinterest, Instagram, retailer), or
  - picking from an in-app inspiration feed.

  Sparta recommends how to recreate the look from items you already own. It can also suggest wishlist items that complete the look.

### Purchases, receipts and planning
- Record when you bought each item and from where, and attach receipts.
- Keep a **wishlist** and **plan** outfits and future purchases.

### Optional paid AI features
- AI outfit recommendations beyond the free rule-based set.
- AI inspiration matching.
- AI style assistant (chat) that knows your wardrobe.

## Vendor features

- **Aggregate trend dashboards:** what is owned, bought and wishlisted, by category, colour, size, brand and region.
- **Demand forecasts:** predicted demand by region, season and product type.
- **Gaps and under-served items:** wardrobe gaps users have that a vendor could fill.
- **Catalogs and promotions:** vendors publish product feeds, so users can find, wishlist and buy their items. Vendors can also run sponsored promotions.

## Privacy principles

Vendor insights depend on user trust, so privacy is part of the design.

1. **Opt-in only.** Users choose whether their anonymized data contributes to vendor insights. Declining never limits app features.
2. **Aggregated only.** Vendors never see individual users, wardrobes or purchase records.
3. **Minimum group sizes.** Any segment below a minimum number of users (initial target: 50) is suppressed.
4. **Revocable.** Users can withdraw consent at any time in settings. Withdrawn data stops contributing to future aggregates.
5. **Global from day one.** The consent model and data handling must satisfy GDPR, UK GDPR, CCPA/CPRA, India's DPDP Act and similar regimes.

## Architecture (planned)

One backend serves every client.

```
 Mobile app (iOS/Android)  ─┐
 Consumer web app          ─┼──►  API (Python)  ──►  Postgres + object storage
 Vendor web dashboard      ─┘            │
                                         ├──► Analytics / aggregation pipeline (privacy thresholds)
                                         └──► ML services (recommendations, inspiration matching, forecasting)
```

- **Backend:** Python (e.g. FastAPI), chosen so the ML work lives in the same ecosystem.
- **Clients:** a mobile app, a consumer web app and a vendor web dashboard, all talking to the same API.
- **Aggregation layer:** the only path from user data to vendor dashboards. It enforces consent and minimum group sizes.
- **Image processing:** background removal for item photos, and OCR for receipts.

Specific frameworks and hosting are not final.

## MVP scope

The first release includes:
- Wardrobe catalog (manual and photo entry).
- Outfit builder with rule-based recommendations for men.
- Purchase history, receipt upload with OCR, and wishlist.
- Basic vendor dashboard with trend data.

Planned after the MVP:
- Outfit inspiration (photo, link, feed).
- Paid AI features (recommendations, inspiration matching, style assistant).
- Vendor product feeds, catalog lookup, and sponsored promotions.
- Demand forecasts and gap analysis.
- Email-based receipt import.
- Womenswear and other audiences.

## Open questions

- Final minimum group-size threshold, and the anonymization method (k-anonymity, differential privacy, or both).
- Mobile framework (React Native or Flutter) and web framework.
- Regional launch order for retailer and brand onboarding, given the global launch.
- Pricing for vendor tiers and for the paid AI features.
- Where outfit-inspiration content comes from, and how link imports respect third-party terms of service.

## Status

Early planning. This repository currently holds the product definition. No application code yet.

## License

See [LICENSE](LICENSE).
