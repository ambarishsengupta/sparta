# Goal: purchases and wishlist keep their guarantees (finite non-negative prices, per-currency totals, owner-only rows, write-once confirmation)
Predicate: `npx vitest run apps/web/lib/money.test.ts apps/web/lib/purchases.test.ts apps/web/lib/wishlist-plan.test.ts >/dev/null 2>&1 && grep -q "purchases_price_finite_chk" supabase/migrations/20261107100000_wo0092_receipt_fixes.sql && grep -q "receipts_write_once" supabase/migrations/20261107100000_wo0092_receipt_fixes.sql`
Completed: 2026-11-07
Triggered by: release R6a (purchases, wishlist bought, plan purchases)
Status: holding
Last pass: 2026-11-12
On violation: do not ship; check prices stay finite and non-negative, totals are never summed across currencies, and confirmed receipts stay write-once.
Retire when: R8 or Release 1 hardening replaces it.
