# WO-0080 mutation proof (R6a)

Method: scratch harness OUTSIDE the repository (`mutate.py` in the session scratchpad; not committed). For each mutant, ONE transaction on the local stack: `create extension pgtap` (inside the transaction), the mutation (a `create or replace function` built from the migration text with one substitution, or a grant, policy, constraint or role change), then the pgTAP files 012, 003, 004, 005, 008 and 009 run in that same transaction with their own `begin` removed, then `rollback`. Nothing was committed to the database; the stack was not reset by the harness. Each mutation is also checked to apply cleanly on its own before the run (a mutant that fails to apply is not counted). The baseline (no mutation) passes with zero failing lines in all six files. A mutant is killed when at least one assertion fails or a test file aborts with an error.

Result: 40 mutants, 40 killed, 0 survived. M03 survived on the first run (the explicit owner filter in the job query is a second layer behind RLS); a test was added that runs the function in an RLS-bypassing session as B (`even without RLS (owner session) B's identity cannot reach A's job`) and M03 is now killed. M08 is killed by a test-file abort (the skip line reaches the item builder and the fixture script errors), which counts as killed.

| Mutant | Change | Result | Caught by |
| --- | --- | --- | --- |
| M01 | confirm_receipt: a confirmed receipt can be confirmed again | KILLED | 4 failing lines in 012; first: not ok 149 - a second call is refused |
| M02 | confirm_receipt: a job that is not done can be confirmed | KILLED | 6 failing lines in 012; first: not ok 114 - a queued job cannot be confirmed |
| M03 | confirm_receipt: job query drops the explicit owner filter (RLS still hides other users: expected equivalent) | KILLED | 1 failing line in 012 (after the added test); first: not ok 155 - even without RLS (owner session) B's identity cannot reach A's job. First run: SURVIVED, see note |
| M04 | confirm_receipt: a photo job is accepted as a receipt job | KILLED | 2 failing lines in 012; first: not ok 116 - a photo job is not a receipt job |
| M05 | confirm_receipt: receipt chosen without matching the job input path | KILLED | 12 failing lines in 012; first: not ok 119 - a done job with no receipt row is refused |
| M06 | confirm_receipt: purchase price is the line amount, not amount / qty | KILLED | 2 failing lines in 012; first: not ok 146 - purchases hold the unit price (amount / qty), the quantity, and the header values or the line's own |
| M07 | confirm_receipt: receipt total is not accumulated | KILLED | 2 failing lines in 012; first: not ok 148 - the receipt carries store, date, currency, the sum of the amounts, its job and the confirmation time |
| M08 | confirm_receipt: skip lines are not skipped | KILLED | 42 failing lines in 012; first: ERROR:  invalid input syntax for type json |
| M09 | confirm_receipt: created items get origin manual | KILLED | 2 failing lines in 012; first: not ok 145 - items have origin receipt; the matched one keeps its catalogue id |
| M10 | confirm_receipt: a matched line loses its catalogue id | KILLED | 2 failing lines in 012; first: not ok 145 - items have origin receipt; the matched one keeps its catalogue id |
| M11 | confirm_receipt: no purchase_receipts link is written | KILLED | 5 failing lines in 012; first: not ok 144 - two items, two purchases, two links and one confirmed receipt were added |
| M12 | confirm_receipt: confirmed_at is never set | KILLED | 7 failing lines in 012; first: not ok 144 - two items, two purchases, two links and one confirmed receipt were added |
| M13 | confirm_receipt: data errors are not caught (raw database text escapes) | KILLED | 9 failing lines in 012; first: not ok 129 - refused with a fixed code: a catalogue id that is not a uuid |
| M14 | insert_item_from_json: unknown keys are accepted | KILLED | 17 failing lines in 012; first: not ok 104 - an item key outside the list (user_id) is refused |
| M15 | insert_purchase_from_json: currency format is not checked | KILLED | 10 failing lines in 012; first: not ok 102 - a currency that is not three capitals is refused |
| M16 | insert_purchase_from_json: negative price accepted | KILLED | 11 failing lines in 012; first: not ok 101 - a negative price is refused |
| M17 | wishlist_bought: an entry can be bought twice | KILLED | 2 failing lines in 012; first: not ok 92 - a second call for the same entry is refused |
| M18 | wishlist_bought: made SECURITY DEFINER and without the owner filter | KILLED | 16 failing lines in 012; first: not ok 93 - another user's entry is refused as not found |
| M19 | wishlist_bought: item origin is always manual | KILLED | 2 failing lines in 012; first: not ok 98 - an entry from the catalogue gives an item with origin catalogue and the same catalogue id; p_item overrides the entry |
| M20 | wishlist_bought: the entry is not marked bought | KILLED | 3 failing lines in 012; first: not ok 89 - the entry is marked bought |
| M21 | wishlist_bought: entry attributes override p_item (overlay reversed) | KILLED | 15 failing lines in 012; first: not ok 98 - an entry from the catalogue gives an item with origin catalogue and the same catalogue id; p_item overrides the entry |
| M22 | receipts path check allows a nested folder | KILLED | 2 failing lines in 012; first: not ok 19 - storage path: a nested file |
| M23 | receipts path check drops the no-two-dots rule | KILLED | 2 failing lines in 012; first: not ok 17 - storage path: dots in the name |
| M24 | authenticated may delete receipts | KILLED | 14 failing lines in 012,003,004,005; first: not ok 3 - authenticated has no delete on receipts (LLD 4.6) |
| M25 | purchase_receipts: composite owner keys replaced by plain keys | KILLED | 6 failing lines in 012; first: not ok 39 - a link from A's purchase to B's receipt is refused by the key (even for a role that bypasses RLS) |
| M26 | receipts update policy without the job ownership check | KILLED | 3 failing lines in 012; first: not ok 48 - a receipt cannot point at another user's job |
| M27 | receipts select policy without the consent gate | KILLED | 4 failing lines in 003,005; first: not ok 29 - every gated app policy calls has_consent |
| M28 | latest_fx_rates returns the oldest row per currency | KILLED | 2 failing lines in 012; first: not ok 85 - latest_fx_rates returns the newest row per currency |
| M29 | latest_fx_rates executable by anon | KILLED | 5 failing lines in 012,003; first: not ok 83 - app.latest_fx_rates is executable by authenticated only |
| M30 | fx_role can read app.items | KILLED | 8 failing lines in 012,003; first: not ok 56 - fx_role has usage on ops (and the open public schema) and on no other schema |
| M31 | fx_role may log in | KILLED | 2 failing lines in 012; first: not ok 52 - fx_role: NOLOGIN and no privileged attribute |
| M32 | authenticated can read ops.fx_rates (grant and policy) | KILLED | 8 failing lines in 012,003; first: not ok 59 - one policy per operation, all for fx_role |
| M33 | purge keeps jobs for 1 day only | KILLED | 2 failing lines in 012; first: not ok 159 - old finished receipt jobs are gone; a young one, a queued one and an old photo job stay |
| M34 | purge also deletes photo jobs | KILLED | 2 failing lines in 012; first: not ok 159 - old finished receipt jobs are gone; a young one, a queued one and an old photo job stay |
| M35 | purge schedule missing | KILLED | 2 failing lines in 012; first: not ok 163 - pg_cron runs the purge daily |
| M36 | purge measures from created_at | KILLED | 3 failing lines in 012; first: not ok 159 - old finished receipt jobs are gone; a young one, a queued one and an old photo job stay |
| M37 | authenticated may insert confirmed_at on receipts | KILLED | 2 failing lines in 012; first: not ok 4 - authenticated inserts only the upload's own facts |
| M38 | receipts no longer cascade from the profile | KILLED | 73 failing lines in 012,004,008; first: not ok 10 - receipts cascades from the profile |
| M39 | export skips the receipts table | KILLED | 8 failing lines in 012,008; first: not ok 165 - the export holds receipts and purchase_receipts without raising export_uncovered_table |
| M40 | purge is executable by authenticated | KILLED | 4 failing lines in 012,003; first: not ok 164 - only the owner can run the purge; it is a definer function |
