# Change request CR-001: womenswear, and men and women as the audience

| | |
| --- | --- |
| Date | 2026-11-15 |
| Requested by | Product owner (Ambarish Sengupta), 2026-11-12 and 2026-11-15 |
| Status | **Draft, waiting for the product owner's yes.** No work order below starts before that. |
| Changes | BRD 4.1, 4.2, 5, 7.5, 9, 13; FDD 4, 5, 8, 10, 13, 14; HLD and LLD sections that name menswear; legal pack (privacy policy, pilot notice, privacy risk assessment) |
| Work orders | WO-0131 to WO-0147 in `workflow/work-orders/Womenswear.md` (17) |
| Size | About 30% on top of the Release 0 build. One to one and a half weeks of build at the Release 0 pace; two to three weeks elapsed with the style review. |

## 1. What changes

Today the BRD says "men only" and lists "womenswear and other audiences" as out of scope. After this change the consumer app serves adults who keep a menswear wardrobe, a womenswear wardrobe, or both. Vendors see the same aggregates, with the wardrobe type as one more dimension.

## 2. Decisions proposed (the owner confirms or changes each)

| # | Decision | Proposal | Why |
| --- | --- | --- | --- |
| D1 | What the app asks the person | One question at onboarding and in Settings: **"Which clothes do you keep here?"** with the answers Menswear, Womenswear, Both. Stored as `profiles.wardrobe`. It is not a gender field and the app never asks for gender. | The app needs to know which garment types and which outfit rules to offer, nothing more (minimal data, BRD privacy rule 5). |
| D2 | Taxonomy | Categories stay. Each sub-type gets an audience tag (men, women, both). About 35 to 45 new sub-types (draft list in WO-0132), including a new category for one-piece garments. | Most sub-types are shared (T-shirt, jeans, sneakers); only the tag decides what a person sees. |
| D3 | One-piece garments | A dress, jumpsuit or saree fills the Top and Bottom slots together, the way a suit fills Layer and Bottom today. | The engine already supports one item in two slots; this extends it instead of rewriting it. |
| D4 | Outfit rules | A second rule set for womenswear, same structure as today's, selected by the wardrobe type. With "Both", the person picks the rule set on the outfit screen (remembered). | Rules for occasion, footwear and layering differ; mixing them in one set would make both worse. |
| D5 | Who owns the women's rules | A womenswear style specialist named by the owner (item X-STYLE-W). Until then every value is a draft, as the men's values still are. | The men's rules are not signed off yet either; a second unsigned set doubles the review. |
| D6 | Sizes | Add women's numeric sizes (UK, EU, US, IN). Do **not** add bra sizes or other underwear sizes in the pilot. | Underwear is never suggested, and the field is intimate data with no use in the pilot. |
| D7 | Models | Fashion-MNIST already has a Dress class (mapped to "no suggestion" today): map it. The H&M-trained parts (garment model version 2, pairing table, unlock list) are extended to womenswear but stay off until the H&M approval is on record (X-HMOK), as now. | H&M has 54,886 Ladieswear and Divided articles against 12,553 Menswear, so the women's tables rest on more data than the men's. |
| D8 | Indian womenswear | Saree, salwar kameez, kurta set, lehenga and dupatta are in the taxonomy and the rules, with no learned support (neither dataset has them). | Same position as men's ethnic wear today. |
| D9 | Vendor figures | `audience` (menswear, womenswear) becomes a dimension and a filter. The minimum group size and rounding do not change. | Splitting about 100 pilot users by audience hides more segments; the owner should revisit the recruitment target (X-RECRUIT). |
| D10 | Not in this change | Children's wear, maternity, lingerie suggestions, jewellery beyond the existing accessory slot, size conversion between systems, any change to who may join the pilot other than D1. | Keeps the change to what the demo and the pilot need. |

## 3. What it costs

| Slice | Work orders | Content |
| --- | --- | --- |
| W1 Scope and data model | WO-0131 to WO-0133 | Documents and legal text, taxonomy version 2, database migration |
| W2 Engine | WO-0134 to WO-0137 | One-piece slots, the women's rule set, accessories and ethnic wear, fixtures and the review pack |
| W3 App | WO-0138 to WO-0142 | Onboarding and settings, item form and filters, outfit builder, illustrations, wording |
| W4 Models (off by default) | WO-0143, WO-0144 | Garment maps, pairing table and unlock list per audience |
| W5 Vendor, demo, release | WO-0145 to WO-0147 | Audience dimension, demo data and H&M demo catalogue, collector mapping and the release check |

## 4. Risks

| Risk | Handling |
| --- | --- |
| The women's rules ship as unreviewed drafts and suggestions look wrong | G9 style review of 50 women's suggestions before the pilot opens to that audience; the wardrobe type can be limited to Menswear by one setting until then |
| Thin vendor segments | D9; the dashboard already says when a segment is hidden |
| `profiles.wardrobe` read as a gender field | D1 wording in the app, the privacy policy and the vendor agreement; vendors only ever see it aggregated |
| More sub-types make the add-item form longer | Sub-types are filtered by the wardrobe type; "Both" groups them |
| Regenerated engine fixtures hide a regression in the men's rules | WO-0137 keeps the men's baseline fixture byte-for-byte and adds the women's as a second file |

## 5. Items for the owner

| Item | Question |
| --- | --- |
| X-CR1 | Approve CR-001 (decisions D1 to D10)? |
| X-STYLE-W | Who is the womenswear style specialist? |
| X-RECRUIT | New pilot recruitment target with two audiences (about 100 today)? |
| X-HMOK (existing) | The written H&M confirmation also needs to cover womenswear articles and photographs in the demo. |
