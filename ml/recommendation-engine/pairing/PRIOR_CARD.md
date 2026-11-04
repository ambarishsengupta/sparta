# Pairing prior card: pairing-prior-v1

**Verdict: `ships`.** Overall AUC 0.6078 (95% interval 0.6012 to 0.6149); the bar is 0.60 (LLD 7.9, FDD 14.4).

A pass would mean only that the prior predicts what H&M customers bought together better than chance. It does not show that the outfits are stylish; the style review (FDD 14.4) remains.

| Field | Value |
| --- | --- |
| Built | 2026-11-04 by `build_prior.py` (pandas 2.3.1, numpy 2.3.1); run time 0.3 minutes |
| Source files | the three H&M files named below, read in full, nothing written back; the prior holds no row, article, customer, basket or date |
| Prior written | `pairing-prior-v1.json`, fitted on all baskets; SHA-256 `092df98f7d6d3615a4348c0c9b1cf117c860414dc7053b2faa9c66d3672e5231` |
| Unlock list written | `unlock-candidates.json`, 40 entries; SHA-256 `676432dc07e23aff3dc9847ced33cadd56a6228d1d13ff3066cf6b170809a229` |
| Both files | in the git-ignored artifact folder (`SPARTA_ARTIFACT_DIR`), never committed; `models.manifest.json` keeps them marked not built |

## Source files (SHA-256)

| File | SHA-256 |
| --- | --- |
| `articles.csv` | `25f21882053517f7684ea43f524225a9481a7bb9aab9cf0abfc7fe8c4576a72b` |
| `customers.csv` | `abf3450c37ee1c16124e0d3379371153f5371148742efdcfe44c97c0445df6b2` |
| `transactions_train.csv` | `fff5e3b35c1b26016aa0bf2231be9525bc766eed32c94f1653420b465aef84fa` |

## How it was built

- Lines: `transactions_train.csv` read in chunks (three columns, ids as text), kept when the article is in the Menswear index group, fills a top, bottom, layer or footwear slot through `garment_v2/type_map.json`, has a Sparta colour family through `garment_v2/colour_map.json`, and the customer is not under 18 (missing age is kept). Duplicate lines collapse into a quantity; a pair is counted once per basket whatever the quantity.
- Slots for pairs: Layer is Jacket, Blazer, Coat or Cardigan; Top is T-shirt, Polo, Shirt, Sweater or Hoodie; Bottom is Trousers, Jeans or Shorts; Footwear is Sneakers or Boots. Four slot pairs are scored, the four the outfit score uses: Top+Bottom, Top+Footwear, Bottom+Footwear and Layer+Top.
- Basket: one customer's lines on one date, kept with at least two usable Menswear articles. Pair: two distinct articles of a basket in different slots of one slot pair.
- Score: `lift = (n_ab + 5) / (E_ab + 5)` with `E_ab = n_a n_b / N` inside the slot pair; colour pairs the same way on colour families inside the slot pair; a type pair or colour pair seen in fewer than 30 baskets is neutral (ln lift 0); ln lift is clipped to -2..2. The file stores `sigmoid(clipped ln lift)` per table (0.5 neutral); a pair of items scores `sigmoid(logit(type value) + logit(colour value))`. Neutral entries are not listed.
- Evaluation: fit on all baskets on or before 2020-07-28, test on baskets from 2020-07-29 to 2020-09-22 (the last eight weeks of the data, 56 days). Every real test pair is compared with a pair of the same two slots in which the second item is replaced by a (sub-type, colour family) drawn by test-week Menswear purchase frequency in that slot (fixed seed). Ties get the mid-rank. The interval is a bootstrap of 1000 resamples of customers (all baskets of one customer together), percentile 2.5 to 97.5.
- Not tuned: smoothing 5, floor 30, clip 2 and the 0.60 bar are the values of LLD 7.9; nothing was changed after seeing a result.

## Overall result and per slot pair

| Slot pair | AUC | 95% interval (customer bootstrap) | Test pairs |
| --- | --- | --- | --- |
| **Overall** | **0.6078** | 0.6012 to 0.6149 | 28,651 |
| Top+Bottom | 0.6108 | 0.6033 to 0.6183 | 24,393 |
| Top+Footwear | 0.5815 | 0.5421 to 0.6122 | 516 |
| Bottom+Footwear | 0.5478 | 0.4853 to 0.5986 | 306 |
| Layer+Top | 0.5965 | 0.5786 to 0.6145 | 3,436 |

Test customers 6,730; test baskets with a pair 7,079.

Draw check: the replacement draw uses a fixed seed (the AUC above). With 4 other fixed seeds (1 to 4) the overall AUC is 0.6049 to 0.6067. This is a check on the draw, not a choice of seed; the seed above was fixed before the first run.

## How narrow the margin is, and which pair is weak

- The margin over the 0.60 bar is narrow: with other negative-draw seeds the overall AUC ranges from 0.6036 to 0.6110 over 50 seeds.
- The interval above holds the negatives fixed (it resamples customers only); a bootstrap that also redraws the negatives gives about [0.5995, 0.6129], which includes values below the bar.
- The Bottom+Footwear interval [0.485, 0.599] includes 0.5, so that pair should be treated as weak: its table is not evidence that those pairs go together.

## Counts

| What | Count |
| --- | --- |
| Transaction lines read | 31,788,324 (2018-09-20 to 2020-09-22) |
| Lines of Menswear articles | 1,771,053 |
| Lines usable (slot, sub-type and colour family) | 1,388,362 |
| Usable lines of customers under 18, dropped | 2,031 |
| Usable lines with a customer not in customers.csv, dropped | 0 |
| Lines after collapsing duplicates (customer, date, article) | 1,244,042 (1,386,331 units) |
| Baskets with a usable article | 604,434 |
| Baskets kept (two or more usable articles) | 295,014 |
| Baskets with at least one pair | 102,211 |
| Pairs, all | 462,944 |
| Pairs, training part / test part | 434,293 / 28,651 |
| Baskets with a pair, training part / test part | 95,132 / 7,079 |
| Menswear articles / usable articles | 12,553 / 9,172 |
| Menswear articles with no top, bottom, layer or footwear slot (accessories, underwear, swimwear and others, and Other shoe) | 2,970 |
| Menswear articles with no colour family (Metal, Mole, Unknown, undefined) | 236 |
| Customers / customers under 18 | 1,371,980 / 9,553 |

| Slot pair | Pairs, all | Training | Test |
| --- | --- | --- | --- |
| Top+Bottom | 390,215 | 365,822 | 24,393 |
| Top+Footwear | 12,187 | 11,671 | 516 |
| Bottom+Footwear | 7,166 | 6,860 | 306 |
| Layer+Top | 53,376 | 49,940 | 3,436 |

## Tables written

Non-neutral entries in `pairing-prior-v1.json` (a pair seen in at least 30 baskets): 51 type pairs and 523 colour pairs. A missing entry is neutral (0.5).

Stability: across the 51 type pairs above the floor in both fits, the ln lift of the fit on the training part and of the fit on all baskets (the file written) correlate at 0.999.

## The 20 highest scoring type pairs (fit on all baskets)

| Rank | Slot pair | Type pair | Score | ln lift | Baskets |
| --- | --- | --- | --- | --- | --- |
| 1 | Layer+Top | Blazer + Shirt | 0.668 | +0.700 | 4,355 |
| 2 | Layer+Top | Coat + Sweater | 0.622 | +0.496 | 963 |
| 3 | Layer+Top | Jacket + Hoodie | 0.615 | +0.466 | 2,593 |
| 4 | Top+Bottom | Sweater + Jeans | 0.609 | +0.443 | 9,739 |
| 5 | Top+Footwear | Sweater + Boots | 0.608 | +0.440 | 611 |
| 6 | Top+Bottom | Hoodie + Jeans | 0.592 | +0.374 | 4,248 |
| 7 | Top+Bottom | Polo + Shorts | 0.592 | +0.370 | 8,053 |
| 8 | Layer+Top | Cardigan + Sweater | 0.591 | +0.367 | 2,200 |
| 9 | Top+Bottom | T-shirt + Shorts | 0.589 | +0.360 | 20,978 |
| 10 | Bottom+Footwear | Trousers + Boots | 0.582 | +0.329 | 576 |
| 11 | Top+Bottom | Sweater + Trousers | 0.581 | +0.326 | 16,704 |
| 12 | Top+Bottom | Hoodie + Trousers | 0.570 | +0.281 | 7,753 |
| 13 | Layer+Top | Jacket + T-shirt | 0.558 | +0.232 | 3,314 |
| 14 | Top+Footwear | Shirt + Boots | 0.556 | +0.224 | 508 |
| 15 | Top+Bottom | Shirt + Trousers | 0.554 | +0.219 | 17,470 |
| 16 | Top+Footwear | Polo + Sneakers | 0.552 | +0.207 | 642 |
| 17 | Bottom+Footwear | Shorts + Sneakers | 0.546 | +0.186 | 877 |
| 18 | Bottom+Footwear | Jeans + Boots | 0.532 | +0.127 | 285 |
| 19 | Top+Footwear | T-shirt + Sneakers | 0.531 | +0.123 | 1,307 |
| 20 | Layer+Top | Cardigan + Polo | 0.525 | +0.100 | 458 |

## The 20 lowest scoring type pairs (fit on all baskets)

| Rank | Slot pair | Type pair | Score | ln lift | Baskets |
| --- | --- | --- | --- | --- | --- |
| 1 | Layer+Top | Blazer + Hoodie | 0.213 | -1.309 | 261 |
| 2 | Top+Bottom | Sweater + Shorts | 0.233 | -1.189 | 3,686 |
| 3 | Top+Footwear | Polo + Boots | 0.263 | -1.033 | 91 |
| 4 | Bottom+Footwear | Shorts + Boots | 0.263 | -1.028 | 87 |
| 5 | Top+Bottom | Hoodie + Shorts | 0.297 | -0.859 | 2,258 |
| 6 | Layer+Top | Coat + Polo | 0.324 | -0.734 | 67 |
| 7 | Layer+Top | Coat + T-shirt | 0.360 | -0.573 | 247 |
| 8 | Layer+Top | Blazer + Sweater | 0.368 | -0.541 | 1,308 |
| 9 | Layer+Top | Blazer + T-shirt | 0.379 | -0.492 | 1,026 |
| 10 | Layer+Top | Cardigan + Shirt | 0.381 | -0.484 | 1,025 |
| 11 | Layer+Top | Cardigan + Hoodie | 0.385 | -0.468 | 489 |
| 12 | Layer+Top | Jacket + Shirt | 0.387 | -0.460 | 2,587 |
| 13 | Top+Footwear | T-shirt + Boots | 0.387 | -0.458 | 288 |
| 14 | Top+Bottom | T-shirt + Trousers | 0.408 | -0.371 | 14,628 |
| 15 | Top+Bottom | Polo + Trousers | 0.410 | -0.364 | 4,864 |
| 16 | Top+Bottom | Polo + Jeans | 0.426 | -0.297 | 2,802 |
| 17 | Top+Bottom | T-shirt + Jeans | 0.438 | -0.250 | 8,347 |
| 18 | Top+Footwear | Sweater + Sneakers | 0.445 | -0.219 | 884 |
| 19 | Top+Bottom | Shirt + Shorts | 0.451 | -0.198 | 9,763 |
| 20 | Layer+Top | Coat + Hoodie | 0.451 | -0.196 | 207 |

## Colour and type map notes for the style specialist (FOI-11)

- Maroon: the work order says Dark Red, LLD 7.8 says Red with perceived colour value Dark. Menswear articles with master Red: 385 in colour group Dark Red (used), 394 with value Dark, 360 in both.
- Navy: Blue with perceived colour value Dark is used (1,885 Menswear articles); FDD FOI-11 words it as Dark Blue, the colour group, which would be 2,228.
- Other shoe has no Sparta sub-type (FDD 14.3), so it is not in the prior although LLD 7.9 lists it under Footwear. Cardigan is Layer as in LLD 7.9 (the slot map allows Top or Layer). Sandals, Formal shoes, Chinos and Joggers cannot be expressed by the H&M types and are not in the prior; the committed fallback list covers them.

## Known limits

- Same-day purchases by one online customer are a weak sign of an outfit: people buy for others, buy several colours of one product, and buy only part of what they wear. The bootstrap interval covers sampling variation, not these.
- The data are H&M purchases from 2018-09-20 to 2020-09-22 by customers whose country the files do not state; they are not purchases by Indian men, and the pilot does not assume the prior transfers.
- H&M's Menswear range is small in footwear and layers, so the Bottom+Footwear and Layer+Top tables rest on fewer baskets than Top+Bottom.
- Popularity is controlled for in the test by drawing replacements by purchase frequency, but a real pair can be replaced by a combination that was in fact also bought together.
- The prior is a nudge of weight 0.15 on outfits that already pass R1 and R2; it never admits an outfit. Licence status: models and tables from these files may enter the pilot only after BRD OI-5 is closed.

