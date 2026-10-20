# Sparta: Functional Design Document (FDD)

| Field | Value |
| --- | --- |
| Document | Functional Design Document |
| Version | 1.1 (final; FR-1 amended to drop Apple sign-in for the pilot) |
| Date | 2026-10-20 |
| Product owner | Ambarish Sengupta |
| Taxonomy and outfit rules | Arpan Shah (style specialist) |
| Technical review | C. Prashanth (SA) |
| Traces to | BRD v0.4 (requirement IDs BR-xx) |
| Status | Final |

## 1. Purpose and how to read this document

This document says what the system does, screen by screen and rule by rule, so that it can be built and tested. It does not choose technology; the HLD and LLD do that. Each functional requirement (FR) names the business requirement (BR) it satisfies. "Must", "Should" and "Could" follow the BRD.

## 2. Users and permissions

| Role | Who | Can do |
| --- | --- | --- |
| Consumer | Pilot user, male, 18 or over | Everything in sections 4 to 9 for their own data only. |
| Vendor | Invited brand or retailer user | Sign in, view the aggregate dashboard and reports, upload a product feed. No access to any user-level data. |
| Admin | Delivery team | Invite vendors, manage the seed catalogue, run and monitor the aggregation job, handle deletion requests. |

Vendor and admin accounts are created by invitation only. Consumers sign up themselves.

## 3. Navigation and screen list

Consumer app (mobile-first, installable PWA), bottom navigation:

| Tab | Screens |
| --- | --- |
| Wardrobe | Wardrobe grid and list, filters, item detail, add item (4 methods), collections, archive |
| Outfits | Outfit builder, saved outfits, suggestions, calendar |
| Wishlist | Wishlist, plan purchases |
| Purchases | Purchase history, receipt scan, receipt detail |
| Me | Settings, privacy and sharing, export, delete account, about the pilot |

Other consumer screens: sign-in and sign-up, first-login pilot notice, onboarding.

Vendor portal (desktop-first web): sign in, dashboard, gaps, reports, product feed upload, account.

Admin console (internal, minimal): invitations, catalogue sources, aggregation runs, deletion queue.

## 4. Account, onboarding and consent

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-1 | A user can sign up and sign in with email and password or Google. Apple sign-in is deferred until after the pilot. Email is verified before the first login completes. | BR-01 | Must |
| FR-2 | At sign-up the user declares they are 18 or over by an explicit tick. Without it, sign-up cannot be completed. | BR-01 | Must |
| FR-3 | On the first login a blocking pop-up appears: "Sparta is a 3-month pilot. To make it work, anonymised and aggregated information about what you own, buy and wish for is used to build insights for brands and retailers." It states what is collected, that no individual user, photo or receipt is ever shown to vendors, the pilot length, and how to leave. | BR-20, BR-21 | Must |
| FR-4 | The user must tap "I understand and join the pilot" to continue. Closing the pop-up without accepting returns to the sign-in screen. The app cannot be used without accepting. | BR-20 | Must |
| FR-5 | Acceptance is stored with the user, a timestamp and the notice version. A new notice version triggers the pop-up again at next login. | BR-21 | Must |
| FR-6 | After acceptance, a short onboarding asks for hemisphere or country (for season), preferred currency and, optionally, the occasions the user dresses for most. All are editable later. | BR-11, BR-12 | Should |
| FR-7 | Onboarding offers "start from popular items" (opens the catalogue picker) or "add my own". It can be skipped. | BR-03 | Must |

## 5. Wardrobe

### 5.1 Seeing and organising (the primary outcome)

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-10 | The Wardrobe tab shows all active items as a grid with a list toggle, newest first by default. Each tile shows the image (or illustration, see FR-24), name, colour and a favourite marker. | BR-02 | Must |
| FR-11 | Users can filter by category, sub-type, colour family, fit, material, pattern, size, brand, season, occasion, price range, tag, collection, favourite and archived, and combine filters. Users can also pick a colour on the spectrum and see items with a similar colour. | BR-02 | Must |
| FR-12 | Users can sort by date added, price, brand, category, colour and condition. | BR-02 | Must |
| FR-13 | Users can create custom tags and collections (for example "Gym" or "Wedding season") and assign items to any number of them. | BR-02 | Must |
| FR-14 | Users can mark an item as a favourite and, separately, flag it "never worn". The flag is set by the user. An item whose condition rating is 0 is treated the same as a flagged item, so the "never worn" filter returns both. Nothing is derived from any outfit log, and no wear counts exist. | BR-02, BR-14 | Should |
| FR-15 | Users can archive an item with a reason (sold, donated, discarded, lost). Archived items leave the active wardrobe, remain in purchase history and stay out of outfit suggestions. Archive can be undone. | BR-02 | Must |
| FR-16 | Users can edit any attribute of an item, and delete an item permanently after a confirmation. | BR-02 | Must |
| FR-17 | A wardrobe summary strip shows item count and a breakdown by category. | BR-02 | Could |

### 5.2 Item condition

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-18 | Each item has an optional condition rating, set by the user with a slider from 0 (brand new) to 100 (falling apart). It is empty until the user sets it. | BR-14 | Should |
| FR-19 | The app shows the rating as a band label next to the slider. Draft bands (to be confirmed by the style specialist): Brand new 0-9, Like new 10-29, Good 30-59, Worn 60-84, Falling apart 85-100. | BR-14 | Should |
| FR-20 | Condition can be sorted and filtered. It is never shown to vendors as a raw number, only as band shares (see section 9). | BR-14 | Should |

### 5.3 Adding items

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-21 | **Catalogue picker.** The user searches or browses the seed catalogue by category, brand, colour and style, selects an item, then adjusts details (size, colour variant, price paid, date, store, condition) and saves. | BR-03 | Must |
| FR-22 | **Manual entry.** A form lets the user create an item that is not in the catalogue. Required: category, sub-type, primary colour. Optional: all other attributes in section 10. Dropdowns use the fixed taxonomy; brand and store accept free text with suggestions. Colour uses the spectrum picker (FR-29). | BR-04, BR-40 | Must |
| FR-23 | **Photo.** The user takes or uploads a photo. The system removes the background and shows a preview; the user can accept the cut-out or keep the original. The user then completes the attributes, which the system may pre-fill (for example a suggested colour) and the user confirms. | BR-05 | Should |
| FR-24 | Catalogue items from public storefronts show a category illustration tinted in the item's exact stored colour, plus a link to the source page. Source images are not copied or stored by default. | BR-41 | Must |
| FR-25 | **Receipt.** See section 7. | BR-06 | Should |
| FR-26 | **Barcode or catalogue lookup.** The user scans a barcode with the device camera or types it. If it matches a catalogue entry, the item form is pre-filled. If not, the user is offered manual entry with the barcode saved on the item. | BR-07 | Could |
| FR-27 | Before saving, the system checks for a likely duplicate (same category, sub-type, colour and brand) and asks "You already have something similar. Add anyway?" | BR-02 | Should |
| FR-28 | Every item records its origin: catalogue, manual, photo, receipt or vendor feed. | BR-40 | Must |
| FR-29 | **Colour picker.** Primary colour (required) and secondary colour (optional) are chosen on a full colour spectrum: a hue slider with a saturation and lightness area, a hex input, and quick swatches for common colours. For photo items an eyedropper can sample the colour from the cut-out, which starts at the most dominant colour. The chosen value is stored as RGB. | BR-04, BR-40 | Must |
| FR-29a | The system derives a **colour family** from every stored colour (section 13) and shows its name next to the swatch (for example "Navy"). The user can see it but not edit it. | BR-40 | Must |

## 6. Purchases and wishlist

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-30 | An item can have a purchase record: date, store, price, currency, quantity and notes. Purchase records can also exist for items later archived. | BR-08 | Must |
| FR-31 | The Purchases tab lists purchases newest first with total spend for a chosen period, by currency. Filter by store, brand, category and date range. | BR-08 | Must |
| FR-32 | Users can attach one or more receipt images or PDFs to a purchase. Receipts are private to the user. | BR-08 | Must |
| FR-33 | Prices are stored in the original currency. The user's preferred currency is shown alongside where a rate is available, labelled with the rate date. | BR-12 | Should |
| FR-34 | The wishlist holds items from the catalogue or manual entries, with target price, priority (low, medium, high), and notes. | BR-09 | Must |
| FR-35 | A wishlist item can be marked "bought", which opens the purchase form and moves the item into the wardrobe. | BR-09 | Must |
| FR-36 | "Plan purchases" lets the user attach a planned month and budget to wishlist items and shows the total per month. | BR-09 | Should |

## 7. Receipt scan

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-40 | The user takes or uploads a receipt image. | BR-06 | Should |
| FR-41 | The system extracts store, date, currency and line items (description, quantity, price). | BR-06 | Should |
| FR-42 | The extraction is shown as an editable draft. Each line can be matched to a catalogue item, turned into a new item, or skipped. Nothing is saved until the user confirms. | BR-06 | Should |
| FR-43 | Lines that do not look like clothing (for example grocery lines) are pre-skipped but can be added back. | BR-06 | Could |
| FR-44 | On confirmation, the system creates the items and their purchase records and attaches the receipt image to them. | BR-06, BR-08 | Should |
| FR-45 | If extraction fails or is unreadable, the user is told and offered manual entry. | BR-06 | Should |
| FR-46 | Receipt images and the extracted text are visible only to the user and are never part of any aggregate. | BR-27 | Must |

## 8. Outfits

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-50 | **Builder.** The user composes an outfit by picking items into slots: top, bottom, layer or outerwear, footwear, accessories. A slot can be empty. An outfit has a name, occasion tags, season tags and notes. | BR-10 | Must |
| FR-51 | Only active items can be added to an outfit. Archiving an item marks outfits containing it as "needs attention" without deleting them. | BR-10 | Must |
| FR-52 | **Suggestions.** The user picks an occasion and the system proposes up to three outfits from their own wardrobe using the rules in section 11, for the current season. Each suggestion shows a one-line reason ("Layer works for cool weather; navy and grey are neutral"). | BR-11 | Should |
| FR-53 | The user can accept a suggestion (saves it as an outfit), swap any item for another valid item, or reject it. Rejections are recorded for rule tuning. | BR-11 | Should |
| FR-54 | If the wardrobe is too thin for a suggestion, the system says what is missing ("You need a bottom for this occasion") and links to the catalogue or wishlist. | BR-11 | Should |
| FR-55 | **Calendar.** The user can assign a saved outfit to a date or an event label. The calendar is a planning aid and is private. | BR-10 | Should |
| FR-56 | **Optional log.** From an outfit or the calendar, the user can mark "I wore this today". The app never prompts, reminds, sends a notification about, or rewards logging. There are no streaks or counters. | BR-15 | Could |
| FR-57 | Logged outfits are stored only for the user's own history. They are not used to compute wear counts, and they are excluded from every vendor aggregate. | BR-15 | Could |

## 9. Settings, privacy and data rights

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-60 | Settings include profile, hemisphere or country, preferred currency, notifications (email only, transactional), and the pilot sharing setting. | BR-20 | Must |
| FR-61 | **Pilot sharing setting.** The setting is visible but greyed out and locked on. Tapping the information icon shows a tooltip: "The pilot needs anonymised data from its users to work. The full version of Sparta will let you turn this off." | BR-22 | Must |
| FR-62 | **Export.** The user can request an export of all their data as a downloadable archive (JSON for data, original files for images and receipts). It is ready within 24 hours and delivered in the app and by email. | BR-24 | Must |
| FR-63 | **Delete account.** The user can delete the account after re-entering their password or re-authenticating. Deletion removes profile, items, images, receipts, outfits and wishlist, and excludes the user from every future aggregate run. Confirmation is shown in the app and by email. | BR-22, BR-24 | Must |
| FR-64 | Deletion completes within 7 days. Aggregates already published are not recomputed retroactively, but cannot be linked back to the user. | BR-24 | Must |
| FR-65 | A "How the pilot uses your data" page restates the notice from FR-3 and lists what vendors see. | BR-21 | Must |

## 10. Vendor portal

### 10.1 Access

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-70 | Vendors sign in with an invited email and password. There is no self-sign-up. | BR-30 | Must |
| FR-71 | Vendors are read-only except for product feed upload. They cannot query raw tables. | BR-25, BR-30 | Must |

### 10.2 Dashboard

All figures use only users covered by the pilot notice, only items that are active in the wardrobe at the time of the run, and only segments with 10 or more contributing users (FR-80).

| ID | View | What it shows | Traces to |
| --- | --- | --- | --- |
| FR-72 | Ownership mix | Share of users owning at least one item in each category, colour family, fit and brand. Bar charts with a segment selector. | BR-30 |
| FR-73 | Purchase trend | Number of purchases over time (monthly, and weekly once there is enough data), by category and brand. | BR-30 |
| FR-74 | Wishlist trend | Number of users adding wishlist items over time, by category and brand. | BR-30 |
| FR-75 | Gaps | Segments where wishlist demand is high and ownership is low, ranked by gap score (FR-81), with the contributing user counts. | BR-31 |
| FR-76 | Condition spectrum | For each category, the share of owned items in each condition band. A high share in the worn bands points to replacement demand. | BR-14 |
| FR-77 | Filters | Size, season, price band and region. A filter that makes any segment fall under 10 users hides that segment and shows "Not enough users to display". | BR-34 |

### 10.3 Gap and demand report

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-78 | The system produces a monthly report (PDF or on-screen) with the top gaps, the top rising wishlist segments and the condition spectrum, with notes on the number of contributing users and the pilot period. | BR-31 | Must |
| FR-79 | The admin can generate the report on demand and mark it as reviewed before the vendor sees it. | BR-31 | Should |

### 10.4 Product feed upload

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-90 | A vendor uploads a CSV or JSON file following a published template (section 10.5). | BR-32 | Should |
| FR-91 | The system validates each row against the taxonomy, shows errors row by row, and lets the vendor fix and re-upload. Nothing is published until the vendor confirms. | BR-32 | Should |
| FR-92 | Published vendor items appear in the consumer catalogue marked with the vendor name. A vendor can update or withdraw its items. | BR-32 | Should |
| FR-93 | A vendor sees only its own feed, never another vendor's. | BR-32 | Must |

### 10.5 Product feed template (draft)

`sku, name, brand, category, sub_type, primary_colour (hex or colour name), secondary_colour (hex or colour name), fit, material, pattern, sizes_available, price, currency, season, occasion_tags, product_url, image_url`

Required: `sku, name, brand, category, sub_type, primary_colour, price, currency, product_url`.

## 11. Aggregation and privacy rules (applies to all vendor outputs)

| ID | Rule | Traces to |
| --- | --- | --- |
| FR-80 | A segment (a combination of category, colour, fit, brand, size and so on) is shown only if at least 10 contributing users are in it. Otherwise it is suppressed. | BR-26 |
| FR-81 | **Gap score** for a segment = wishlist users divided by owning users, where each is the number of distinct contributing users with at least one active item in that segment. If there are no owning users the score is shown as "no ownership" and the segment still needs 10 wishlist users. | BR-31 |
| FR-82 | Counts are rounded to the nearest 5 before display (confirmed by the product owner), and totals are computed from the unrounded values. Differences between filtered views that could reveal a small group are suppressed. | BR-26 |
| FR-83 | Aggregates are computed by a scheduled job on an anonymised copy of the data that contains no names, emails, images, receipts or free-text notes. The job runs nightly during the pilot (confirmed by the product owner). | BR-25, BR-27 |
| FR-84 | Condition is aggregated as band shares only, and wear logs are excluded. | BR-14, BR-15 |
| FR-85 | Region is derived from the user's country or hemisphere setting and shown only at a level where FR-80 holds. | BR-34 |
| FR-86 | Every aggregate run records the date, the number of users and items included, and the number of suppressed segments, for audit. | BR-44 |
| FR-87 | Vendor views and segments use the colour family, never the raw RGB value, so that near-identical shades fall into one segment. | BR-26, BR-40 |

## 12. Seed catalogue management (admin)

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-100 | The admin keeps a list of catalogue sources: site, `robots.txt` outcome, terms check, date collected and contact. | BR-41 | Must |
| FR-101 | A collection job fetches product attributes only from sources marked as allowed, at a limited rate, with an identifying user agent. | BR-41 | Must |
| FR-102 | Collected items are mapped to the fixed taxonomy. Items that cannot be mapped go to a review queue. | BR-40 | Must |
| FR-103 | The admin can remove all items from a source in one action. | BR-41 | Must |
| FR-104 | Each catalogue item stores the source link and collection date. | BR-41 | Must |

## 13. Data dictionary: item attributes (draft for the style specialist)

| Attribute | Type | Required | Values (draft) |
| --- | --- | --- | --- |
| Category | Single choice | Yes | Tops, Bottoms, Outerwear, Footwear, Accessories, Underwear and socks, Activewear, Ethnic wear, Occasion wear |
| Sub-type | Single choice (depends on category) | Yes | e.g. Tops: T-shirt, Shirt, Polo, Sweater, Cardigan, Hoodie; Bottoms: Jeans, Chinos, Trousers, Shorts, Joggers; Outerwear: Jacket, Blazer, Coat; Footwear: Sneakers, Formal shoes, Boots, Sandals; Accessories: Watch, Belt, Tie, Cap, Scarf, Bag; Ethnic wear: Kurta, Sherwani, Nehru jacket, Pyjama, Dhoti; Occasion wear: Suit, Tuxedo, Waistcoat |
| Primary colour | RGB value from the spectrum picker (stored as red, green, blue 0-255, plus a hex string) | Yes | Any colour. A colour family is derived from it (below). "Multi" is a separate flag for multicoloured items with no single main colour. |
| Secondary colour | RGB value | No | Same as primary colour |
| Colour family | System-derived, single choice | Yes (derived) | Black, White, Grey, Navy, Blue, Teal, Green, Olive, Khaki, Beige, Brown, Maroon, Red, Orange, Yellow, Pink, Purple, Multi. Derived by nearest match of the stored colour to a reference swatch for each family, measured in a perceptual colour space (CIELAB). Used for filters, outfit rules and all vendor aggregates. |
| Fit | Single choice | No | Slim, Regular, Relaxed, Oversized, Tailored |
| Material | Single choice | No | Cotton, Linen, Wool, Denim, Polyester, Leather, Synthetic blend, Other |
| Pattern | Single choice | No | Solid, Striped, Checked, Printed, Graphic, Other |
| Size | Text from a size system | No | Letter, numeric waist and length, shoe size with system (EU, UK, US, IN) |
| Brand | Text with suggestions | No | Free text, normalised against a brand list |
| Price and currency | Number and ISO code | No | e.g. 49.00 EUR |
| Store | Text with suggestions | No | Free text |
| Season suitability | Multi choice | No | Spring, Summer, Autumn, Winter, All year |
| Occasion tags | Multi choice | No | Casual, Work, Formal, Party, Sport, Date, Travel |
| Condition | Integer 0-100 | No | See FR-18 and FR-19 |
| Notes | Free text | No | Never included in any aggregate |
| Purchase date | Date | No | |
| Origin | System field | Yes | Catalogue, Manual, Photo, Receipt, Vendor feed |

## 14. Outfit rules (draft v1, for the style specialist to refine)

Rules work on item attributes and never on photos. A suggestion needs at least one top, one bottom (or a one-piece item) and footwear.

| Rule | Description |
| --- | --- |
| R1 Occasion filter | Casual: any tops and bottoms except formal shoes with shorts. Work: shirt or polo, chinos or trousers, closed shoes. Formal: shirt, tailored trousers, formal shoes, blazer if available. Party: dark or statement tops, jeans or trousers, clean sneakers or boots. Sport: activewear only. |
| R2 Season filter | Items tagged for the current season or all year. Summer: no coats or heavy knits. Winter: add a layer. Season comes from the date and the user's hemisphere. |
| R3 Colour harmony | At most three main colours. Neutrals (families Black, White, Grey, Navy, Beige, Khaki, Olive, Brown, and any colour with very low saturation) go with anything. A bold colour is one with high saturation. At most one bold colour per outfit. Rules use the stored RGB value (converted to hue, saturation and lightness) as well as the family. |
| R4 Pattern | At most one bold pattern; solids may be paired with any single pattern. |
| R5 Layering | Cool seasons: base top plus a mid or outer layer. A layer's colour should not match the top exactly. |
| R6 Footwear | Match footwear to occasion (R1). Belt and shoe colour should be in the same family when both are present. |
| R7 Variety | Do not suggest the same item in all three suggestions where an alternative exists. |
| R8 Explanation | Every suggestion states the rules that led to it, in one line. |

## 15. Non-functional requirements (functional view)

| ID | Requirement |
| --- | --- |
| NFR-1 | Works on the current and previous major versions of Chrome, Safari, Firefox and Edge, on phones and desktops. |
| NFR-2 | Installable as a PWA. Previously viewed wardrobe pages open without a connection; changes sync when the connection returns. |
| NFR-3 | Main screens load in under 3 seconds on a typical mobile connection with up to 500 items. |
| NFR-4 | Meets WCAG 2.1 AA for contrast, labels and keyboard use on the main flows. |
| NFR-5 | All text is English, stored in a way that allows translation later. Prices show in their original currency. |
| NFR-6 | All traffic is encrypted. Each user's data is accessible only to that user, enforced at the data layer. |
| NFR-7 | The system supports at least 500 registered users and 50,000 items without a design change. |
| NFR-8 | Daily backups, with a restore tested once before the pilot starts. |

## 16. Analytics events (for the success measures in the BRD)

Events carry a pseudonymous user ID and no free text. Examples: `signup_completed`, `pilot_notice_accepted`, `item_added` (with origin), `wishlist_added`, `purchase_recorded`, `receipt_scanned`, `outfit_saved`, `outfit_suggestion_accepted`, `outfit_suggestion_rejected`, `account_deleted`, `export_requested`, `vendor_dashboard_viewed`, `vendor_report_opened`, `feed_uploaded`. No event is generated for outfit logging beyond the log record itself.

## 17. Acceptance criteria (selected)

| For | Given / When / Then |
| --- | --- |
| FR-3, FR-4 | Given a new user logs in for the first time, when the app loads, then the pilot notice is shown and no other screen is reachable until "I understand and join the pilot" is tapped. |
| FR-61 | Given a pilot user opens settings, when they view the sharing setting, then it is shown on and greyed out, and tapping the info icon shows the tooltip text. |
| FR-63, FR-64 | Given a user deletes their account, when the next aggregate run executes, then none of their data is included, and within 7 days no personal record of theirs remains. |
| FR-80 | Given a segment has 9 contributing users, when a vendor opens any view containing it, then the segment is not shown. Given it has 10, then it is shown with a rounded count. |
| FR-42 | Given a receipt is scanned, when the draft appears, then no item or purchase exists until the user confirms. |
| FR-56, FR-57 | Given a user never logs outfits, then no prompt, reminder or counter appears at any time. Given a user logs outfits, then no vendor view or wear count changes. |
| FR-93 | Given two vendors have uploaded feeds, when vendor A opens the feed screen, then only A's rows and items are visible. |

## 18. Out of scope for this document

Technology choices, data model, API design and deployment are in the HLD and LLD.

## 19. Open items

| ID | Item | Owner |
| --- | --- | --- |
| FOI-1 | Closed. Colours changed to a full spectrum picker with a derived colour family (FR-29, FR-29a, FR-87), which also adds Teal, Khaki and Maroon as families. Cardigan and Tie added; "Ethnic and occasion wear" split into Ethnic wear and Occasion wear. Condition bands confirmed as drafted (60 is the point where an item counts as worn). Sub-types for the two new categories are drafts. | Arpan Shah |
| FOI-2 | Closed. Outfit rules R1 to R8 accepted as v1. | Arpan Shah |
| FOI-3 | Closed. "Never worn" is a user-set flag, and a condition rating of 0 is treated the same (FR-14). | Product owner |
| FOI-4 | Closed. Source images are not copied; catalogue items show tinted category illustrations with a source link (FR-24). | Product owner |
| FOI-5 | Closed. Nightly refresh, counts rounded to the nearest 5 (FR-82, FR-83). | Product owner |
| FOI-6 | Choose the first set of storefront sources for the seed catalogue and confirm their terms. | Delivery team |
