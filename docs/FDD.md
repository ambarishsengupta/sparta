# Sparta: Functional Design Document (FDD)

| Field | Value |
| --- | --- |
| Document | Functional Design Document |
| Version | 1.3 (final; amended after the full document review) |
| Date | 2026-10-22 |
| Product owner | Ambarish Sengupta |
| Taxonomy and outfit rules | Arpan Shah (style specialist) |
| Technical review | C. Prashanth (SA) |
| Traces to | BRD v1.2 (requirement IDs BR-xx) |
| Status | Final |

## 1. Purpose and how to read this document

This document says what the system does, screen by screen and rule by rule, so that it can be built and tested. It does not choose technology; the HLD and LLD do that. Each functional requirement (FR) names the business requirement (BR) it satisfies. "Must", "Should" and "Could" follow the BRD.

## 2. Users and permissions

| Role | Who | Can do |
| --- | --- | --- |
| Consumer | Pilot user, male, 18 or over | Everything in sections 4 to 9 for their own data only. |
| Vendor | Invited brand or retailer user | Sign in, view the aggregate dashboard and reports, upload a product feed. No access to any user-level data. |
| Admin | Delivery team | Invite vendors and users, manage the seed catalogue (sources, review queue, takedown), run and monitor the aggregation job and the worker, view the vendor query log, change the supported countries, handle deletion and export requests received by email, suspend accounts, end a vendor's access, switch maintenance mode on and off, and run the end of the pilot (FR-69). |

Vendor and admin accounts are created by invitation only. Consumers sign up themselves, but only with an email address on the invitation list kept by the admin (FR-8), and the app stays blocked unless the country they give at onboarding is on the supported list, initially India (FR-9).

## 3. Navigation and screen list

Consumer app (mobile-first, installable PWA), bottom navigation:

| Tab | Screens |
| --- | --- |
| Wardrobe | Wardrobe grid and list, filters, item detail, add item (4 methods), collections, archive |
| Outfits | Outfit builder, saved outfits, suggestions, calendar |
| Wishlist | Wishlist, plan purchases |
| Purchases | Purchase history, receipt scan, receipt detail |
| Me | Settings, privacy and sharing, export, delete account, about the pilot |

Other consumer screens: sign-in and sign-up, first-login age and Terms screen (FR-2, FR-68), pilot notice, onboarding, and a page offering only export and Leave the pilot to users who have not joined the pilot or are not eligible (FR-4, FR-5, FR-9).

Vendor portal (desktop-first web): sign in, dashboard, gaps, reports, product feed upload, account.

Admin console (internal, minimal): invitations, catalogue sources and review queue, aggregation runs, deletion queue, user and vendor actions (delete, export, suspend, end access), settings (supported countries, maintenance mode), worker status and vendor query log, end of the pilot (FR-69).

## 4. Account, onboarding and consent

Sign-up and the first login run in this order: sign-up with an invited email address (FR-1, FR-8); at the first sign-in, one screen with the 18-or-over tick and the Terms of Use and Privacy Policy tick (FR-2, FR-68); the pilot notice (FR-3 to FR-5); then onboarding, which asks for the country and checks it (FR-6, FR-7, FR-9).

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-1 | A user can sign up and sign in with email and password or Google. Apple sign-in is deferred until after the pilot. Email is verified before the first login completes. | BR-01 | Must |
| FR-2 | At sign-up the user declares they are 18 or over by an explicit tick, on a screen shown at the first sign-in before the pilot notice (so it also covers Google sign-in). Without it, sign-up cannot be completed and the app cannot be used. | BR-01 | Must |
| FR-3 | On the first login a blocking pop-up appears with the short notice in the Privacy Policy (`legal/PRIVACY-POLICY.md`, section 13): the pilot is a free 3-month study run by a student team; anonymised, grouped information from all participants is shared with brands and retailers, who never see the participant, photos, receipts or wardrobe and never see a group of fewer than 10 people; sharing is part of taking part and cannot be switched off during the pilot; **Leave the pilot** deletes the account and data at any time; no data is used to train AI models; participants must be 18 or over. The pop-up links to the full Privacy Policy and Terms of Use. | BR-20, BR-21 | Must |
| FR-4 | The user must tap "I understand and join the pilot" to continue. Tapping "No thanks" or closing the pop-up does not join the pilot. The user then sees only a page offering Export my data, Leave the pilot (the deletion in FR-66) and Sign out, and the notice is shown again at the next login. The app cannot otherwise be used without accepting. | BR-20 | Must |
| FR-5 | Acceptance is stored with the user, a timestamp and the notice version. A new notice version, or a new Terms or Privacy Policy version, triggers acceptance again at the next login, on the same screen as the first time (FR-3 or FR-68); a user who declines can only export their data or leave the pilot. | BR-21, BR-28 | Must |
| FR-6 | After the pilot notice is accepted, a short onboarding asks for the user's country (required and checked as in FR-9), hemisphere (for season; pre-filled from the country), preferred currency and, optionally, the occasions the user dresses for most. All are editable later. | BR-11, BR-12 | Should |
| FR-7 | Onboarding offers "start from popular items" (opens the catalogue picker) or "add my own". This choice can be skipped; the country question (FR-9) cannot. | BR-03 | Must |
| FR-8 | **Invitation only.** Sign-up (email or Google) succeeds only for an email address on the invitation list kept by the admin. Any other address is refused with the message "Sparta is invitation-only during the pilot." The sign-up screen lists the supported countries (the same list as the About page, FR-67). | BR-16 | Must |
| FR-9 | **Supported countries.** Onboarding asks for the user's country. If it is not on the supported list (initially India), the account is blocked from the app with the message "The pilot is not open in your country yet" and the user can only export their data (FR-62) or leave the pilot (FR-66). The list is a setting that admins can change. | BR-16 | Must |

## 5. Wardrobe

### 5.1 Seeing and organising (the primary outcome)

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-10 | The Wardrobe tab shows all active items as a grid with a list toggle, newest first by default. Each tile shows the image (or illustration, see FR-24), name, colour and a favourite marker. | BR-02 | Must |
| FR-11 | Users can filter by category, sub-type, colour family, fit, material, pattern, size, brand, season, occasion, price range, tag, collection, favourite and archived, and combine filters. Users can also pick a colour on the spectrum and see items with a similar colour. | BR-02 | Must |
| FR-12 | Users can sort by date added, price, brand, category, colour and condition. | BR-02 | Must |
| FR-13 | Users can create custom tags and collections (for example "Gym" or "Wedding season") and assign items to any number of them. | BR-02 | Must |
| FR-14 | Users can mark an item as a favourite and, separately, flag it "never worn". The flag is set by the user. An item whose condition rating is 0 is treated the same as a flagged item, so the "never worn" filter returns both. Nothing is derived from any outfit log, and no wear counts exist. | BR-02, BR-14 | Must |
| FR-15 | Users can archive an item with a reason (sold, donated, discarded, lost). Archived items leave the active wardrobe, remain in purchase history and stay out of outfit suggestions. Archive can be undone. | BR-02 | Must |
| FR-16 | Users can edit any attribute of an item, and delete an item permanently after a confirmation. | BR-02 | Must |
| FR-17 | A wardrobe summary strip shows item count and a breakdown by category. | BR-02 | Could |

### 5.2 Item condition

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-18 | Each item has an optional condition rating, set by the user with a slider from 0 (brand new) to 100 (falling apart). It is empty until the user sets it. | BR-14 | Should |
| FR-19 | The app shows the rating as a band label next to the slider. Bands (confirmed by the style specialist, FOI-1): Brand new 0-9, Like new 10-29, Good 30-59, Worn 60-84, Falling apart 85-100. | BR-14 | Should |
| FR-20 | Condition can be sorted and filtered. It is never shown to vendors as a raw number, only as band shares (see FR-76 and FR-84). | BR-14 | Should |

### 5.3 Adding items

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-21 | **Catalogue picker.** The user searches or browses the seed catalogue by category, brand, colour and style, selects an item, then adjusts details (size, colour variant, price paid, date, store, condition) and saves. | BR-03 | Must |
| FR-22 | **Manual entry.** A form lets the user create an item that is not in the catalogue. Required: category, sub-type, primary colour. The name is filled in automatically and can be edited (section 13). Optional: all other attributes in section 13. Dropdowns use the fixed taxonomy; brand and store accept free text with suggestions. Colour uses the spectrum picker (FR-29). | BR-04, BR-40 | Must |
| FR-23 | **Photo.** The user takes or uploads a photo. The system removes the background and shows a preview; the user can accept the cut-out or keep the original. The user then completes the attributes, which the system may pre-fill (for example a suggested colour) and the user confirms. | BR-05 | Should |
| FR-24 | Catalogue items from public storefronts show a category illustration tinted in the item's exact stored colour, plus a link to the source page. Source images are not copied or stored. | BR-41 | Must |
| FR-25 | **Receipt.** See section 7. | BR-06 | Should |
| FR-26 | **Barcode or catalogue lookup.** The user scans a barcode with the device camera or types it. If it matches the barcode number (GTIN) of a catalogue entry, the item form is pre-filled; if several entries match, the user picks one. If not, the user is offered manual entry with the barcode saved on the item. | BR-07 | Could |
| FR-27 | Before saving, the system checks for a likely duplicate (same category, sub-type, colour family (FR-29a) and brand) and asks "You already have something similar. Add anyway?" | BR-02 | Should |
| FR-28 | Every item records its origin: catalogue, manual, photo, receipt or vendor feed. | BR-40 | Must |
| FR-29 | **Colour picker.** Primary colour (required) and secondary colour (optional) are chosen on a full colour spectrum: a hue slider with a saturation and brightness area, a hex input, and quick swatches for common colours. For photo items an eyedropper can sample the colour from the cut-out, which starts at the most dominant colour. The chosen value is stored as RGB. | BR-04, BR-40 | Must |
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
| FR-47 | Before draft lines are saved, the system masks anything that looks like a card number, email address, phone number or loyalty or membership number, and drops address lines, keeping only the store name, date, currency and item lines. The raw text from the scan is never stored. Reading results are deleted after 7 days; the receipt image stays until the user deletes it. | BR-29 | Must |

## 8. Outfits

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-50 | **Builder.** The user composes an outfit by picking items into slots: top, bottom, layer or outerwear, footwear, accessories. A slot can be empty. An outfit has a name, occasion tags, season tags and notes. | BR-10 | Must |
| FR-51 | Only active items can be added to an outfit. Archiving an item marks outfits containing it as "needs attention" without deleting them. | BR-10 | Must |
| FR-52 | **Suggestions.** The user picks an occasion and the system proposes up to three outfits from their own wardrobe using the rules in section 14, for the current season. Each suggestion shows a one-line reason ("Layer works for cool weather; navy and grey are neutral"). | BR-11 | Should |
| FR-53 | The user can accept a suggestion (saves it as an outfit), swap any item for another valid item, or reject it. Rejections are recorded for rule tuning. | BR-11 | Should |
| FR-54 | If the wardrobe is too thin for a suggestion, the system says what is missing ("You need a bottom for this occasion") and links to the catalogue or wishlist. | BR-11 | Should |
| FR-55 | **Calendar.** The user can assign a saved outfit to a date or an event label. The calendar is a planning aid and is private. | BR-10 | Should |
| FR-56 | **Optional log.** From an outfit or the calendar, the user can mark "I wore this today". The app never prompts, reminds, sends a notification about, or rewards logging. There are no streaks or counters. | BR-15 | Could |
| FR-57 | Logged outfits are stored only for the user's own history. They are not used to compute wear counts, and they are excluded from every vendor aggregate. | BR-15 | Could |

## 9. Settings, privacy and data rights

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-60 | Settings include profile, country and hemisphere (a change of country is checked as in FR-9), preferred currency, notifications (email only, transactional), and the pilot sharing setting. | BR-20 | Must |
| FR-61 | **Pilot sharing setting.** The setting is visible but greyed out and locked on. Tapping the information icon shows a tooltip: "The pilot is a study that needs anonymised data from its participants to work, so sharing is on for everyone taking part. You can leave any time with Leave the pilot. The full version of Sparta is planned to let you turn this off." | BR-22 | Must |
| FR-62 | **Export.** The user can request an export of all their data as a downloadable archive (JSON for data, original files for images and receipts). It is ready within 24 hours and delivered in the app and by email. The download link and the file expire after 7 days. | BR-24 | Must |
| FR-63 | **Delete account.** The user can delete the account after re-entering their password or re-authenticating. Deletion removes every record linked to the account (profile, items, images, purchases, receipts, outfits, wishlist and plans, consent and acceptance records, and the invitation entry), and excludes the user from every future aggregate run. Confirmation is shown in the app and by email. | BR-22, BR-24 | Must |
| FR-64 | Deletion completes within 7 days. Aggregates already published (for example, an issued monthly report) are not recomputed retroactively; they contain no user-level rows and were produced under the rules in section 11. | BR-24 | Must |
| FR-65 | A "How the pilot uses your data" page restates the notice from FR-3, links the Privacy Policy, and lists what vendors see and how long data is kept. | BR-21 | Must |
| FR-66 | **Leave the pilot.** Settings has a prominent "Leave the pilot" button. After one confirmation step, in which the user re-enters their password or re-authenticates, it runs the same deletion as FR-63, with no reason asked, and the confirmation says that data is deleted within 7 days and from backups within 30 days. | BR-22, BR-24 | Must |
| FR-67 | **About the pilot.** A page shows who runs the pilot, the privacy contact address (a required configuration value), the hosting region, the supported countries, the plan for the end of the pilot (FR-69), and links to the Privacy Policy, Terms of Use and notice. | BR-21 | Must |
| FR-68 | At sign-up, on the same screen as the age tick (FR-2), the user ticks agreement to the Terms of Use and Privacy Policy, separately from the pilot notice. Acceptance is recorded with the version and time. | BR-17 | Must |
| FR-69 | **End of the pilot.** The admin sets the end date. At least 14 days before it, a banner in the app and an email tell every participant what will happen and how to export their data (FR-62). If the pilot is to continue, the new notice (FR-5) is shown in the same period. On the end date, one admin action runs the FR-63 deletion for every participant who has not accepted a new notice (for everyone, if the pilot closes). If the pilot closes, vendor access also stops and the vendor query log is deleted. No data of a deleted participant, including usage events and backups, remains 30 days after the end date. | BR-24, BR-45 | Must |

## 10. Vendor portal

### 10.1 Access

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-70 | Vendors sign in with an invited email and password. There is no self-sign-up. | BR-30 | Must |
| FR-71 | Vendors are read-only except for product feed upload. They cannot query raw tables. | BR-25, BR-30 | Must |
| FR-95 | The vendor portal Account page shows the privacy contact address (the same `CONTACT_EMAIL` value as FR-67), so vendors can reach the team (Vendor Pilot Agreement sections 12 and 14). | BR-36 | Must |

### 10.2 Dashboard

All figures use only users covered by the pilot notice and only segments with 10 or more contributing users (FR-80). Ownership mix, the ownership side of gaps and the condition spectrum count items that are active in the wardrobe at the time of the run. Purchase trends count every purchase record by purchase month, including purchases of items archived later (FR-30). Wishlist trends and the wishlist side of gaps count open wishlist entries by the month they were added.

| ID | View | What it shows | Traces to |
| --- | --- | --- | --- |
| FR-72 | Ownership mix | Share of users owning at least one item in each category, colour family, fit and brand. Bar charts with a segment selector. | BR-30 |
| FR-73 | Purchase trend | Number of purchases per month, by category and brand. A weekly view is deferred until after the pilot, because weeks inside a month would need their own suppression rules. | BR-30 |
| FR-74 | Wishlist trend | Number of users adding wishlist items over time, by category and brand. | BR-30 |
| FR-75 | Gaps | Segments where wishlist demand is high and ownership is low, ranked by gap score (FR-81), with the contributing user counts. | BR-31 |
| FR-76 | Condition spectrum | For each category, the share of owned items in each condition band. A high share in the worn bands points to replacement demand. Each band is a segment under FR-80: a band with fewer than 10 users shows "Not enough users to display" (never 0%), shares are computed over the bands shown, and items without a condition rating are left out. | BR-14 |
| FR-77 | Filters | Size, season, price band or region, one filter at a time; choosing a second filter replaces the first. A filter that makes any segment fall under 10 users hides that segment and shows "Not enough users to display". | BR-34 |

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
| FR-94 | A vendor user must accept the Vendor Pilot Agreement before the portal opens, and again whenever its version changes. Acceptance is recorded with the vendor, user, version and time. | BR-36 | Must |

### 10.5 Product feed template (draft)

`sku, gtin, name, brand, category, sub_type, primary_colour (hex or colour name), secondary_colour (hex or colour name), fit, material, pattern, sizes_available, price, currency, season, occasion_tags, product_url, image_url`

Required: `sku, name, brand, category, sub_type, primary_colour, price, currency, product_url`.

`gtin` is optional: the product's barcode number (EAN, UPC or other GTIN, 8 to 14 digits). It lets users find the item by scanning (FR-26).

## 11. Aggregation and privacy rules (applies to all vendor outputs)

| ID | Rule | Traces to |
| --- | --- | --- |
| FR-80 | A segment (a combination of category, colour family, fit, brand, size and so on) is shown only if at least 10 contributing users are in it. Otherwise it is suppressed. | BR-26, BR-33 |
| FR-81 | **Gap score** for a segment = wishlist users divided by owning users. Wishlist users are the distinct contributing users with at least one open wishlist entry in the segment; owning users are the distinct contributing users with at least one active item in it. The score uses only the rounded counts that pass FR-80 and FR-82, never a suppressed value. If the owning count is zero or suppressed, no score is shown and the segment is labelled "no visible ownership"; it is shown only if its wishlist count meets FR-80. | BR-31 |
| FR-82 | Counts are rounded to the nearest 5 before display (confirmed by the product owner), and totals are computed from the unrounded values. Differences between filtered views that could reveal a small group are suppressed. | BR-26 |
| FR-83 | Aggregates are computed by a scheduled job on an anonymised copy of the data that contains no names, emails, images, receipts or free-text notes. The job runs nightly during the pilot (confirmed by the product owner). | BR-25, BR-27, BR-33 |
| FR-84 | Condition is aggregated as band shares only, and wear logs are excluded. | BR-14, BR-15 |
| FR-85 | Region is derived from the user's country (FR-9) and shown only at a level where FR-80 holds. | BR-34 |
| FR-86 | Every aggregate run records the date, the number of users and items included, and the number of suppressed segments, for audit. | BR-44 |
| FR-87 | Vendor views and segments use the colour family, never the raw RGB value, so that near-identical shades fall into one segment. | BR-26, BR-40 |
| FR-88 | Every answered vendor query is logged (vendor, vendor user, function, parameters, time), and a vendor is refused after 200 calls in an hour, counting all its users together. Refused calls are not logged. Admins can view the log. | BR-35 |

## 12. Seed catalogue management (admin)

| ID | Requirement | Traces to | Priority |
| --- | --- | --- | --- |
| FR-100 | The admin keeps a list of catalogue sources: site, `robots.txt` outcome, terms check, date collected and contact. | BR-41 | Must |
| FR-101 | A collection job fetches product attributes only from sources marked as allowed, at a limited rate, with an identifying user agent. | BR-41 | Must |
| FR-102 | Collected items are mapped to the fixed taxonomy. Items that cannot be mapped go to a review queue. | BR-40 | Must |
| FR-103 | The admin can remove all items from a source in one action. | BR-41 | Must |
| FR-104 | Each catalogue item stores the source link and collection date. | BR-41 | Must |

## 13. Data dictionary: item attributes (confirmed by the style specialist, FOI-1)

| Attribute | Type | Required | Values |
| --- | --- | --- | --- |
| Name | Text | Yes (filled automatically) | Items picked from the catalogue keep the catalogue name. Otherwise it defaults to the colour family plus the sub-type (for example "Navy Shirt"). The user can edit it. |
| Category | Single choice | Yes | Tops, Bottoms, Outerwear, Footwear, Accessories, Underwear and socks, Activewear, Ethnic wear, Occasion wear |
| Sub-type | Single choice (depends on category) | Yes | e.g. Tops: T-shirt, Shirt, Polo, Sweater, Cardigan, Hoodie; Bottoms: Jeans, Chinos, Trousers, Shorts, Joggers; Outerwear: Jacket, Blazer, Coat; Footwear: Sneakers, Formal shoes, Boots, Sandals; Accessories: Watch, Belt, Tie, Cap, Scarf, Bag; Underwear and socks: Briefs, Boxers, Vest, Socks; Activewear: Sports T-shirt, Track pants, Sports shorts, Track jacket; Ethnic wear: Kurta, Sherwani, Nehru jacket, Pyjama, Dhoti; Occasion wear: Suit, Tuxedo, Waistcoat. The Ethnic wear, Occasion wear, Underwear and socks, and Activewear sub-types are drafts (FOI-1). |
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
| Favourite | Yes/no flag | No | Set by the user (FR-14) |
| Never worn | Yes/no flag | No | Set by the user. Items with condition 0 are treated the same, so the "never worn" filter returns both (FR-14). |
| Barcode | Text (digits) | No | EAN, UPC or other GTIN, saved from a barcode scan or typed in (FR-26). Used only for catalogue lookup |
| Status | System field | Yes | Active or Archived. An archived item also records a reason: sold, donated, discarded or lost (FR-15). |
| Origin | System field | Yes | Catalogue, Manual, Photo, Receipt, Vendor feed |

## 14. Outfit rules (v1, accepted by the style specialist, FOI-2)

Rules work on item attributes and never on photos. A suggestion needs at least one top, one bottom and footwear. Each sub-type fills the outfit slots in the slot map below (draft, for the style specialist to confirm, FOI-8). An item that fills two slots at once (Suit, Tuxedo) fills both in the same outfit, and no item is used twice in one outfit.

| Sub-types | Slot |
| --- | --- |
| Tops: T-shirt, Shirt, Polo; Ethnic wear: Kurta; Activewear: Sports T-shirt | Top |
| Tops: Sweater, Cardigan, Hoodie | Top or Layer (one of them in a given outfit) |
| Bottoms (all); Ethnic wear: Pyjama, Dhoti; Activewear: Track pants, Sports shorts | Bottom |
| Outerwear (all); Ethnic wear: Sherwani, Nehru jacket; Occasion wear: Waistcoat; Activewear: Track jacket | Layer |
| Occasion wear: Suit, Tuxedo | Layer and Bottom (one item fills both) |
| Footwear (all) | Footwear |
| Accessories (all) | Accessory in the builder; suggestions add only the best-matching belt, if there is one, so that R6 can apply |
| Underwear and socks | Never suggested |

| Rule | Description |
| --- | --- |
| R1 Occasion filter | Casual: any tops and bottoms except formal shoes with shorts. Work: shirt or polo, chinos or trousers, closed shoes. Formal: shirt, tailored trousers, formal shoes, blazer if available. Party: dark or statement tops, jeans or trousers, clean sneakers or boots. Sport: activewear for the top and bottom, sneakers for footwear. Date and Travel have no rule of their own yet and use the Casual rule until the style specialist sets one. |
| R2 Season filter | Items tagged for the current season or All year, or with no season set. Summer: no coats or heavy knits. Winter: add a layer. Season comes from the date and the user's hemisphere. |
| R3 Colour harmony | At most three non-neutral colour families per outfit. Neutrals (families Black, White, Grey, Navy, Beige, Khaki, Olive, Brown, and any colour with very low chroma) go with anything. A bold colour is a vivid one, meaning high chroma; pale and dark shades are not bold. At most one bold colour per outfit. Rules use the colour family and the stored RGB value converted to CIELAB (the same conversion as the colour family), where chroma measures how vivid a colour is. |
| R4 Pattern | At most one patterned item (any pattern other than Solid); solids may be paired with any single pattern. |
| R5 Layering | Cool seasons: base top plus a mid or outer layer. A layer's colour family should differ from the top's. |
| R6 Footwear | Match footwear to occasion (R1). Belt and shoe colour should be in the same family when both are present. |
| R7 Variety | Do not suggest the same item in all three suggestions where an alternative exists. |
| R8 Explanation | Every suggestion states the rules that led to it, in one line. |

## 15. Non-functional requirements (functional view)

NFR-1 and NFR-2 satisfy BR-13.

| ID | Requirement |
| --- | --- |
| NFR-1 | Works on the current and previous major versions of Chrome, Safari, Firefox and Edge, on phones and desktops. |
| NFR-2 | Installable as a PWA. Previously viewed wardrobe pages open without a connection; changes sync when the connection returns. Data kept on the device for offline use belongs to the signed-in user only and is cleared on sign-out, Leave the pilot or account deletion. |
| NFR-3 | Main screens load in under 3 seconds on a typical mobile connection with up to 500 items. |
| NFR-4 | Meets WCAG 2.1 AA for contrast, labels and keyboard use on the main flows. |
| NFR-5 | All text is English, stored in a way that allows translation later. Prices show in their original currency. |
| NFR-6 | All traffic is encrypted. Each user's data is accessible only to that user, enforced at the data layer. |
| NFR-7 | The system supports at least 500 registered users and 50,000 items without a design change. |
| NFR-8 | Weekly encrypted backups, kept for 30 days, with a restore tested once before the pilot starts. |

## 16. Analytics events (BR-44, for the success measures in BRD section 11)

Events carry a pseudonymous user ID and no free text. They are recorded only for consumers who have joined the pilot (notice accepted and onboarding complete) and for vendors. Examples: `app_opened` (sent at most once per user per day), `item_added` (with origin), `wishlist_added`, `purchase_recorded`, `receipt_scanned`, `outfit_saved`, `outfit_suggestion_accepted`, `outfit_suggestion_rejected`, `export_requested`, `vendor_dashboard_viewed`, `vendor_report_opened`, `feed_uploaded`. Sign-ups and account deletions are counted as daily totals with no user ID, and notice acceptance is read from the consent records. No event is generated for outfit logging beyond the log record itself. A user counts as active in a week if they have at least one event in that week; `app_opened` makes sure users who only view their wardrobe are counted. Weekly active share = active users in the week / registered users who have accepted the pilot notice and completed onboarding.

## 17. Acceptance criteria (selected)

| For | Given / When / Then |
| --- | --- |
| FR-3, FR-4 | Given a new user logs in for the first time and completes the age and Terms screen (FR-2, FR-68), when the app loads, then the pilot notice is shown, and until "I understand and join the pilot" is tapped the only other screen reachable is the one offering export and Leave the pilot. |
| FR-61 | Given a pilot user opens settings, when they view the sharing setting, then it is shown on and greyed out, and tapping the info icon shows the tooltip text. |
| FR-63, FR-64 | Given a user deletes their account, when the next aggregate run executes, then none of their data is included, within 7 days no personal record of theirs remains in the database or storage, and within 30 days none remains in backups. |
| FR-77 | Given a vendor has a size filter applied, when they choose a season filter, then the size filter is removed and the view is filtered by season only. |
| FR-80 | Given a segment has 9 contributing users, when a vendor opens any view containing it, then the segment is not shown. Given it has 10 and is not suppressed to protect a smaller neighbouring segment (FR-82), then it is shown with a rounded count. |
| FR-42 | Given a receipt is scanned, when the draft appears, then no item or purchase exists until the user confirms. |
| FR-56, FR-57 | Given a user never logs outfits, then no prompt, reminder or counter appears at any time. Given a user logs outfits, then no vendor view or wear count changes. |
| FR-93 | Given two vendors have uploaded feeds, when vendor A opens the feed screen, then only A's rows and items are visible. |
| FR-8, FR-9 | Given an email that is not on the invitation list, when it tries to sign up, then it is refused. Given an invited user declares a country that is not on the supported list, then the app is blocked and only data export and Leave the pilot (account deletion) are offered. |
| FR-66 | Given a user taps Leave the pilot and confirms, then the account is deleted, no reason is asked, and the user can no longer sign in to it. |
| FR-47 | Given a receipt shows a card number, an email and a phone number, when the draft appears, then none of them is shown or stored. |
| FR-88 | Given a vendor (all its users together) makes more than 200 calls in an hour, then further calls are refused until the hour passes, and each answered call appears in the query log (refused calls are not logged; LLD 5.7). |

## 18. Out of scope for this document

Technology choices, data model, API design and deployment are in the HLD and LLD.

## 19. Open items

| ID | Item | Owner |
| --- | --- | --- |
| FOI-1 | Closed. Colours changed to a full spectrum picker with a derived colour family (FR-29, FR-29a, FR-87), which also adds Teal, Khaki and Maroon as families. Cardigan and Tie added; "Ethnic and occasion wear" split into Ethnic wear and Occasion wear. Condition bands confirmed as drafted (60 is the point where an item counts as worn). Sub-types for Ethnic wear, Occasion wear, Underwear and socks, and Activewear are drafts. | Arpan Shah |
| FOI-2 | Closed. Outfit rules R1 to R8 accepted as v1. R1 later corrected so that Sport allows sneakers, and Date and Travel use the Casual rule until Arpan Shah sets their own. | Arpan Shah |
| FOI-3 | Closed. "Never worn" is a user-set flag, and a condition rating of 0 is treated the same (FR-14). | Product owner |
| FOI-4 | Closed. Source images are not copied; catalogue items show tinted category illustrations with a source link (FR-24). | Product owner |
| FOI-5 | Closed. Nightly refresh, counts rounded to the nearest 5 (FR-82, FR-83). | Product owner |
| FOI-6 | Choose the first set of storefront sources for the seed catalogue and confirm their terms. | Delivery team |
| FOI-7 | Region: closed. The production and dev Supabase projects use South Asia (Mumbai, `ap-south-1`) and the web functions run in Mumbai (`bom1`). Contact address: closed. `dunk-volts8c@icloud.com`, shared by the three team members, is the privacy contact address; set `CONTACT_EMAIL` to it before the pilot opens (FR-67; see `legal/CONTACT-ADDRESS.md`). | Delivery team |
| FOI-8 | Confirm the draft slot map in section 14, including the slots for the draft Activewear sub-types (section 13). | Arpan Shah |
