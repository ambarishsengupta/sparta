# WO-0098 mutation proof (R7a, Release 0)

Method: every mutant is one textual change to a committed file (migration 1, migration 2 or the generated lookups seed), applied to a scratch copy of the SQL
outside the repository (the scratch folder was removed afterwards). Each run is one transaction on the local stack: `begin; create extension pgtap;` the two WO-0098
migrations (mutated), `supabase/seed/lookups.sql` (mutated for M51 to M53), then `supabase/tests/database/015_wo0098_facts.test.sql` with helpers.inc inlined; the test
file's own `rollback` ends the transaction, so nothing is left in the database and no committed file was edited. A mutant counts as killed when at least one assertion fails
(`not ok`) or the run aborts on a database error. The unmutated run first gave 131 of 131 `ok`.

Result: **55 mutants, 54 killed, 1 survivor (M54, equivalent, explained below)**. The work order asks for at least 20.

| id | mutant | result | first failing assertion | detail |
| --- | --- | --- | --- | --- |
| M01 | unlock entries not excluded from wishlist_open | killed | test 57: wishlist_open: Jeans and Joggers | 1 failing |
| M02 | unlock entries not excluded from wishlist | killed | test 56: wishlist: Jeans, Chinos and Joggers (the two unlock entries add nothing) | 1 failing |
| M03 | archived items kept in owned | killed | test 48: owned: the two active items only (the archived one adds nothing) | 2 failing |
| M04 | consent check dropped (ops.is_eligible removed) | killed | test 40: a consumer without consent adds no row | 3 failing |
| M05 | eligibility reduced to a consent row (deleting and country ignored) | killed | test 32: build_facts names only items, profiles, purchases and wishlist_entries of the app schema | 3 failing |
| M06 | role check dropped (vendors and admins counted) | killed | test 43: a vendor adds no row | 2 failing |
| M07 | brand matched case-sensitively | killed | test 82: brand: upper case, no space matches too | 1 failing |
| M08 | brand spaces not ignored | killed | test 81: brand: the label matches ignoring case and spaces and the code is stored | 2 failing |
| M09 | blank brand not Unknown | killed | test 84: brand: no brand is Unknown | 3 failing |
| M10 | typed brand text leaks into facts | killed | test 67: no typed name, note, store, brand or address reaches the facts | 4 failing |
| M11 | unmatched brand is Unknown instead of Other | killed | test 83: brand: a typed brand not in the list is Other | 2 failing |
| M12 | size systems merge (join ignores the system) | killed | test 47: an active item adds an owned row | 9 failing |
| M13 | size stored without its system | killed | test 71: every grouped value is a lookup code or one of Other, Unknown, Multi-season | 5 failing |
| M14 | size matched case-sensitively | killed | test 88: size: matched ignoring spaces | 2 failing |
| M15 | blank size not Unknown | killed | test 93: size: no size is Unknown | 3 failing |
| M16 | season depends on stored order (All year only when first) | killed | test 99: season: All year among others is All year | 1 failing |
| M17 | repeated season counted as two | killed | test 100: season: a repeated season is one season | 1 failing |
| M18 | no season is not All year | killed | test 98: season: none set is All year | 3 failing |
| M19 | price converted with the oldest rate | killed | test 113: price: Boots 2000 INR is <25 | 1 failing |
| M20 | price band lower bound exclusive at 25 | killed | test 106: price: Cardigan 25 USD is 25-50 | 2 failing |
| M21 | price band upper edge wrong at 200 | killed | test 111: price: Sneakers 200 USD is 200+ | 1 failing |
| M22 | USD converted through its fx row | killed | test 102: price: a purchase uses its own price (300 USD), not the item's (10 USD) | 10 failing |
| M23 | missing rate treated as 1 | killed | test 115: price: Watch 500 ZZZ is Unknown | 1 failing |
| M24 | purchase price taken from the item | killed | test 102: price: a purchase uses its own price (300 USD), not the item's (10 USD) | 2 failing |
| M25 | purchase month ignores purchase_date | killed | test 61: purchase period is the purchase month | 1 failing |
| M26 | wishlist period is the current month | killed | test 54: a bought user entry is in wishlist, by the month created | 2 failing |
| M27 | wishlist_open period is the month created | killed | test 52: wishlist_open period is the current month, not the month created | 1 failing |
| M28 | region always Unknown | killed | test 121: region: IN maps to South Asia | 1 failing |
| M29 | unmapped country falls back to a real region | killed | test 120: region: a country with no mapping is Unknown | 1 failing |
| M30 | condition upper edge exclusive (100 has no band) | killed | test 127: condition Bag is Worn | 2 failing |
| M31 | purchases of archived items dropped | killed | test 60: a purchase of an archived item adds a purchase row with the item's attributes | 6 failing |
| M32 | salt ignored in the hash | killed | test 39: an eligible consumer adds rows | 70 failing |
| M33 | facts not truncated before a rebuild | killed | test 47: an active item adds an owned row | 70 failing |
| M34 | hash is md5, not sha256 | killed | aborted by a database error: new row for relation "facts" violates check constraint "facts_user_hash_check" | run aborted |
| M35 | empty salt accepted | killed | test 77: a null salt is refused | 2 failing |
| M36 | search_path left open | killed | test 26: build_facts pins search_path to the empty path | 1 failing |
| M37 | not security definer | killed | test 25: build_facts is security definer | 1 failing |
| M38 | execute left with public | killed | test 28: execute on build_facts is revoked from anon, authenticated and service_role | 2 failing |
| M39 | execute granted to service_role | killed | test 28: execute on build_facts is revoked from anon, authenticated and service_role | 1 failing |
| M40 | RLS not forced on facts | killed | test 16: RLS is enabled and forced on all four tables | 1 failing |
| M41 | RLS not forced on cube | killed | test 16: RLS is enabled and forced on all four tables | 1 failing |
| M42 | anon given usage on analytics | killed | test 22: usage on schema analytics: authenticated only | 1 failing |
| M43 | authenticated given usage on analytics_private | killed | test 23: no client role has usage on analytics_private | 1 failing |
| M44 | service_role can read the cube | killed | test 18: anon, authenticated and service_role hold no privilege on the four tables | 1 failing |
| M45 | authenticated can read facts | killed | test 18: anon, authenticated and service_role hold no privilege on the four tables | 1 failing |
| M46 | a policy opens the cube to everyone | killed | test 17: the four tables have no policy | 1 failing |
| M47 | facts gains a free-text column | killed | test 11: facts has exactly the columns of LLD 5.1 step 4 | 3 failing |
| M48 | cube gains the raw user count | killed | test 13: cube holds the rounded values and users_floor only (no users, no events) | 1 failing |
| M49 | facts brand may be null | killed | test 15: only condition_band can be null in facts | 1 failing |
| M50 | run status unchecked | killed | test 36: status is running, ok or error | 1 failing |
| M51 | seed adds a second country to the region map | killed | test 3: country_region maps IN to South Asia and nothing else | 1 failing |
| M52 | seed renames the top price band | killed | test 1: lk_price_band holds exactly the six codes | 2 failing |
| M53 | seed drops the Unknown price band | killed | test 1: lk_price_band holds exactly the six codes | 2 failing |
| M54 | deleting check dropped on its own (is_eligible still excludes it: expected equivalent) | SURVIVED | none |  |
| M55 | bought entries counted as wishlist_open | killed | test 53: a bought entry is not wishlist_open | 2 failing |

Survivor M54: dropping `not p.deleting` from build_facts on its own changes nothing, because `ops.is_eligible` (WO-0060) already returns false for a user with
`deleting = true`; the explicit check is kept as defence in depth, as the work order lists `deleting` as a separate eligibility rule. The behaviour is still pinned: M05 (eligibility
reduced to a consent row) fails the `deleting = true adds no row` assertion, and so does M04.

Killed by a database error rather than an assertion: M34 (an md5 hash is 32 characters, the `facts.user_hash` check refuses it, so the run aborts before the test that names the sha256 formula); the test
`user_hash is the sha256 of user id and salt` would fail for any other hash of the right length (M32 shows the salt is part of it).

Mutants the work order names: unlock not excluded (M01, M02), archived item kept (M03), consent check dropped (M04, M05), `deleting` ignored (M05; M54 is the equivalent single-line form), brand matched
case-sensitively (M07), season order-dependent (M16), price converted with the oldest rate (M19).
