# Sparta Pilot: Data Sourcing Policy

| Field | Value |
| --- | --- |
| Version | 0.1 (draft for the academic pilot) |
| Date | 2026-10-20 |
| Applies to | The seed catalogue, the collector (`jobs/collector`) and vendor product feeds |
| Review status | Written by the project team with AI assistance. **Not reviewed by a lawyer.** |

## 1. Why this policy exists

The pilot needs a starting catalogue of popular menswear items, or users have nothing to add. The team's position is that product attributes that storefronts show publicly (category, colour, size, style, price) are facts, that the pilot is an academic proof of concept, and that the code is open source. This policy adds working rules, because "publicly visible" is not the same as "permitted". Site terms, database rights and the law of the place can still restrict collection, and "not commercial" will not stay true if vendors pay later.

## 2. Principles

1. **Ask first where we can.** Prefer sources that offer a product feed, an API, or open data, or that agree when asked.
2. **Collect facts, not creative content.** Take product attributes and a link back. Do not take product photographs, marketing descriptions, reviews or editorial text.
3. **Be a polite visitor.** Follow `robots.txt`, limit the request rate, and identify ourselves.
4. **Keep records.** Know what we took, from where, when, and under what terms.
5. **Take it down quickly** when a source asks.
6. **Collect nothing about people.** No reviewer names, no customer data.

## 3. What may be collected

| Collect | Do not collect |
| --- | --- |
| Product name, brand, category, sub-type | Product photographs or image files |
| Colour (as a name or code), sizes offered, material, fit, pattern | Long product descriptions and marketing copy |
| Price and currency, product page URL, SKU or identifier | Reviews, ratings text, reviewer details |
| The date collected | Any personal data, any page behind a login or a paywall |

## 4. Adding a source (checklist)

A source is added to `catalog.sources` only after all of these are done and recorded:

- [ ] **Look for a feed, API or open dataset** and use it instead of page collection if one exists.
- [ ] **Read the terms of use** for rules on automated access or data extraction. If they forbid it, do not collect; instead ask for permission or choose another source.
- [ ] **Check `robots.txt`.** If the product pages are disallowed for our user agent, do not collect.
- [ ] **Check the site is public** (no login, no paywall, no access control being bypassed).
- [ ] **Ask for permission** using the template in section 6 where the terms are unclear, or the site is a small business. Record the answer, even a non-answer.
- [ ] **Record** the source name, address, date of the check, outcome of `robots.txt`, a short note on the terms, and a contact.
- [ ] Set `allowed = true` only when the above are satisfied.

## 5. Conduct of the collector

| Rule | Detail |
| --- | --- |
| Identification | User agent `SpartaPilotBot/0.1` with a link to the project repository |
| Rate | At most one request every 2 seconds per site; honour `Retry-After`; back off on errors |
| Scope | Only the product listing and product pages that `robots.txt` allows |
| Frequency | Weekly during the pilot; no more than needed |
| Stop conditions | Any `robots.txt` change that disallows us; any request from the site to stop; repeated errors suggesting we are a burden |
| Storage | Attributes and the product URL only; images are never downloaded |
| Display | Catalogue items show a tinted category illustration and a link to the source page |

## 6. Permission request template

> **Subject: Request to list basic product details in an academic pilot**
>
> Hello,
>
> We are three students building Sparta, a free digital wardrobe, as an academic proof of concept (Analytics Capstone Project, 2026). The code is open source. To help pilot participants add items quickly, we would like to list the basic details of your menswear products in our catalogue: name, brand, category, colour, sizes, price, and a link back to your product page. We would not copy your photos or descriptions.
>
> We would collect the details no more than once a week, following your `robots.txt`, with a clear user agent. If you prefer to send us a feed, or would rather we did not collect, please tell us and we will respect that straight away.
>
> Could you let us know whether this is acceptable? Thank you for your time.
>
> The Sparta project team

## 7. Takedown procedure

1. A source or rights holder asks us to remove its data, by any route.
2. Within **2 working days**: set `allowed = false`, stop the collector for that source, and delete its rows with the admin function (FR-103).
3. Reply to confirm. Record the request and our action.
4. Check whether any user's item still points to the removed catalogue entry; it stays, as the user's own entry, with the catalogue link removed.

## 8. Vendor feeds

- The vendor confirms that it has the right to supply the feed (Vendor Pilot Agreement, section 6).
- The vendor supplies attributes and links. `image_url` is accepted but not fetched or stored.
- The vendor may update or withdraw items at any time.

## 9. Users' own entries

Items users add themselves are their own content. They are not scraped and carry no sourcing issue. They are handled under the Privacy Policy and Terms of Use.

## 10. When this policy must be revisited

Before any public launch; before any paid vendor tier; if a source objects; if the pilot is extended beyond about 3 months; or if the type of data collected changes.
