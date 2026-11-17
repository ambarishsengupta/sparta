# Goal: the catalogue keeps its guarantees (active rows only, take-down keeps users' items, no external images, illustrations meet 3:1)
Predicate: `npx vitest run apps/web/lib/catalogue.test.ts apps/web/components/ui/illustrations/illustrations.test.ts apps/web/components/catalogue/a11y.test.ts >/dev/null 2>&1 && grep -q "take_down_source" supabase/migrations/20261107110000_wo0083_catalog_tables.sql`
Completed: 2026-11-12
Triggered by: release R6b (catalogue tables, illustrations, picker)
Status: holding
Last pass: 2026-11-12
On violation: do not ship; check consumers see active rows only, a taken-down source never removes users' items, no component renders an external image, and every illustration outline keeps 3:1 against the tile.
Retire when: Release 1 hardening replaces it.
