# WO-0092 mutation proof (R6a fix loop 1)

Method: scratch harness OUTSIDE the repository (session scratchpad, not committed). For each mutant, ONE transaction on the local stack: `create extension pgtap` (inside the transaction), the mutation (a `create or replace function` built from the committed migration text with one substitution, or a grant, constraint or trigger change), then pgTAP file 012 with `\ir helpers.inc` inlined, ending in its own `rollback`. Nothing was committed to the database. Baseline (no mutation, after `supabase db reset` with the new migration): 216 of 216 pass. K08 and K10 are the checker's names for the two survivors of WO-0080; W01 to W15 are new (W06 and W10 were not used).

Result: 15 mutants, 14 killed, 1 survived (W14, an equivalent mutant, explained below).

| Mutant | Change | Result | Caught by |
| --- | --- | --- | --- |
| K08 | purge measures coalesce(finished_at, created_at) | KILLED | 2 failing lines in 012; first: not ok 167 - the purge deletes exactly the one job that finished more than 7 days ago |
| K10 | confirm_receipt catches others and raises invalid_lines | KILLED | 1 failing lines in 012; first: not ok 170 - a permission error passes through: 42501, not invalid_lines |
| W01 | write-once trigger dropped | KILLED | 9 failing lines in 012; first: not ok 179 - the owner cannot clear confirmed_at |
| W02 | trigger guards confirmed_at only (job_id changes allowed) | KILLED | 3 failing lines in 012; first: not ok 181 - nor point job_id at another of their own receipt jobs |
| W03 | trigger refuses every update of a confirmed receipt | KILLED | 2 failing lines in 012; first: not ok 185 - writing the same values, or other columns, on a confirmed receipt is still allowed |
| W04 | insert_purchase_from_json: no finite check (NaN passes the builder) | KILLED | 7 failing lines in 012; first: not ok 197 - the purchase builder refuses a NaN price with the fixed code |
| W05 | price CHECK dropped | KILLED | 11 failing lines in 012; first: not ok 191 - the price check exists and is validated |
| W07 | price CHECK refuses zero (price > 0) | KILLED | 1 failing lines in 012; first: not ok 195 - a price of 0 is fine |
| W08 | confirm_receipt: skip lines not checked for unknown keys | KILLED | 5 failing lines in 012; first: not ok 174 - a skip line with an unknown key is refused |
| W09 | confirm_receipt: skip keys exclude text | KILLED | the test file aborts (104 errors) at the first confirmation; first: ERROR:  invalid input syntax for type json |
| W11 | price CHECK left NOT VALID | KILLED | 1 failing lines in 012; first: not ok 191 - the price check exists and is validated |
| W12 | write-once trigger function executable by authenticated | KILLED | 1 failing lines in 012; first: not ok 190 - the write-once trigger is enabled, BEFORE UPDATE, per row, and its function is not callable by authenticated |
| W13 | trigger disabled | KILLED | 9 failing lines in 012; first: not ok 179 - the owner cannot clear confirmed_at |
| W14 | confirm_receipt: no finite check on amount (defensive; unreachable through jsonb) | SURVIVED | 0 failing lines in 012; first:  |
| W15 | trigger lets confirmed_at be cleared (only changes to another value refused) | KILLED | 4 failing lines in 012; first: not ok 179 - the owner cannot clear confirmed_at |

K08 (`coalesce(finished_at, created_at)` in the purge) is killed by the new queued and running receipt jobs created 30 days ago: the purge must return 1 and leave both. K10 (confirm_receipt catching `others` and raising invalid_lines) is killed by the rolled-back revoke of insert on purchase_receipts: the call must raise `42501: permission denied for table purchase_receipts`.

W14 survives and is equivalent: the amount of a line must be a JSON number (`jsonb_typeof = 'number'`, checked just before), and a jsonb number can never be NaN or infinite, so the new `>= Infinity` test on the amount cannot be reached by any input. It is kept as the defensive check the work order asks for; the same value is checked again in `insert_purchase_from_json` (W04, killed) and by the table CHECK (W05, killed). The test with the text `"NaN"` as an amount passes through the earlier typeof check.
