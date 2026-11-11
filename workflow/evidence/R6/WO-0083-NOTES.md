# WO-0083 notes (R6b, Release 0: catalogue tables, take-down, audit log, collector and worker grants)

New migrations only (nothing old edited): `20261107110000_wo0083_catalog_tables.sql` and `20261107110100_wo0083_audit_log_collector_worker.sql`. Tests: new `013_wo0083_catalogue.test.sql` (186 assertions) and three one-line extensions of existing files (see "Existing tests touched"). Script: `supabase/scripts/seed-demo-catalog.sh` (+ `seed-demo-catalog.test.ts`, 11 tests) and the git-ignored `supabase/scripts/set-collector-password.sh`. Mutation proof: `WO-0083-mutation.md` (37 mutants, all killed). Release 0 re-cut applies: no dedicated security review; the gate, Spec QC and the mutation proof stand.

## What exists now
- `catalog.sources`, `catalog.vendors`, `catalog.vendor_members`, `catalog.catalog_items` as LLD 4.8: gtin `^[0-9]{14}$`, status check, active rows need category and sub-type, source xor vendor, `unique nulls not distinct (source_id, vendor_id, sku)`, the colour trigger `catalog.set_colour_fields()` on catalog_items, the four indexes of LLD 4.7 (trigram on name and brand, `(category, colour_family)`, partial `gtin`). RLS enabled and forced on all four.
- Deferred keys: `app.items.catalog_item_id` and `app.wishlist_entries.catalog_item_id` now reference `catalog.catalog_items` `on delete set null` (validated).
- Consumers: `select` for `authenticated` with `status = 'active'` and the consumer role and consent (same pattern as every consumer policy). Vendors, admins and users without consent see nothing through it. No client grant of any kind on sources, vendors, vendor_members; `service_role` holds all on the four tables (LLD 4.1). `vendor_members` has no client policy yet (the vendor portal, R7, adds "select own rows").
- `catalog.take_down_source(p_source int, p_note text) returns int` (security definer, search_path empty, execute: authenticated only). Raises `forbidden` (42501) unless `app.current_role() = 'admin'`, `invalid_note` (22023) for a note over 500 characters, `source_not_found` (P0002). Locks the source row, sets `allowed = false`, `takedown_at = now()`, `takedown_note`, deletes the source's items, returns the number deleted. The source row is kept. A failing delete rolls the source update back (tested with a failing trigger). Users' items and wishlist entries keep their attributes and lose the link (tested on real rows).
- `ops.admin_audit_log (id identity always, admin_id, action, target, at)`, no grant for anyone (service_role included: LLD 4.1 reaches `ops` through `app` functions, which WO-0088 adds). CHECKs keep `target` to a row id or a count (`^[A-Za-z0-9_:+-]{1,64}$`: no at sign, no space, no free text) and `action` to `^[a-z0-9_.:-]{1,64}$`.
- `collector_role`: LOGIN, no password in any migration, connection limit 3, timeouts, member of no role, no bypassrls. Usage on `catalog` only; select on sources, update of `last_collected_at` only; select, insert, update on catalog_items where `source_id is not null` (no delete); select on every `lk_*` and `colour_family_ref`, each with a policy; execute on the four colour functions the trigger calls as the caller. It cannot see vendor rows, vendors, vendor_members, app, ops, auth or storage.
- `worker_role`: select on catalog_items with the policy `status = 'active'`; the similarity query runs on active rows, never on review or withdrawn rows, and `app.items` stays unreadable.

## Demo catalogue (Release 0)
`bash supabase/scripts/seed-demo-catalog.sh` (local database only; never a gate step, never in config.toml). One source named `demo` (allowed = false, robots_allowed = false, site `http://127.0.0.1/`, terms note "SYNTHETIC DEMO DATA ...") and 40 active items: 8 templates x 5 colours, sku `DEMO-0001..0040`, product links `http://127.0.0.1/demo/DEMO-nnnn` (so no "View at source" link shows: https only), 8 INVENTED brands (Zorvane, Quillibrook, Pemberlow, Wexmarrow, Ostrelle, Brindlewick, Fenwrath, Tallowmere), invented GTINs with the GS1 prefix 290 (in-store range, never a real product) and a valid check digit, price in INR. "Flagged `source` = demo" is the source row's name; every item reaches the picker through that source. Transcript on the local stack:
```
$ bash supabase/scripts/seed-demo-catalog.sh
demo catalogue (SYNTHETIC): 40 active items from the source named demo
$ bash supabase/scripts/seed-demo-catalog.sh          # second run: still 40, 8 brands, 40 distinct gtins, 5 colour families, all gtins 14 digits
demo catalogue (SYNTHETIC): 40 active items from the source named demo
$ bash supabase/scripts/seed-demo-catalog.sh postgresql://postgres:postgres@db.example.com:5432/postgres       -> refusing to run ... exit 2
$ bash supabase/scripts/seed-demo-catalog.sh 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=evil.com' -> refusing to run ... exit 2
$ bash supabase/scripts/seed-demo-catalog.sh 'postgresql://x@evil.com@127.0.0.1/postgres'                      -> refusing to run ... exit 2
$ bash supabase/scripts/seed-demo-catalog.sh --remove  deletes the demo source and its items again.
```
No psql exists on this machine, so the script falls back to `docker exec` into the local stack's database container (the URL is still validated first). CC13 check: none of the strings the CC13 scan forbids appears in any new file (grep over migrations, test, script: no match; also asserted by the vitest file).

## Existing tests touched (extended, never loosened)
- 003: `catalog.take_down_source` added to the exact list of functions `authenticated` can execute (plan count unchanged: it is inside one assertion).
- 009: the worker's reachable relations now include `catalog.catalog_items` (exact array, label says why).
- 008 line 35: the exact list of `ops` tables gains `admin_audit_log` (label says why).
- 012: the keys are real now, so the two catalogue ids that the WO-0080 test uses (`dddddddd-0000-4000-8000-00000000000{1,2}`) must exist: four lines insert a fixture source and two catalogue items before first use. No assertion changed.

## Decisions to check (added beyond the bare list, all small)
1. `sources_allowed_ck`: `allowed` needs `robots_allowed`, a non-blank terms note and no `takedown_at` (Data Sourcing Policy sections 4 and 7 in the database, not only in the WO-0088 route). Consequence for WO-0088: re-allowing a taken-down source must clear `takedown_at` in the same update (the policy says it must not be collected again, so the owner decides that; the check refuses it silently otherwise).
2. CHECKs on catalog_items: `price` finite and not negative (NaN refused; Infinity is refused by the column type), `secondary_colour_hex` a hex code (LLD 4.3 says "checked as a hex code"); on sources `site_url` http(s) and `takedown_note` at most 500 characters; audit log `action` and `target` patterns above.
3. `take_down_source` returns the deleted count (the LLD gives no return type).
4. The audit log is written by nobody yet: WO-0088 must add the `app.` definer function for `service_role` (and update the 008 zero-argument-function list if it has no arguments).
5. Collector insert policy is exactly "source_id is not null" (LLD 4.5). It does NOT stop an insert for a source that is taken down; WO-0087 must never select such a source (CC8). A stricter policy (the source must be allowed and not taken down) would be a change to LLD 4.5 and is left for the SA.

## Not done / not verified
- No hosted project. No password was set for collector_role anywhere (the script exists, git-ignored, reads `SPARTA_COLLECTOR_DB_PASSWORD`, never run). The role's connection was not exercised over a socket: its rights are tested through `set local role` as for worker_role.
- `seed-demo-catalog.test.ts` is NOT collected by the gate: vitest.config.ts only includes certain folders and the collection point is `workflow/gates/db_tests.test.ts` (outside this work order's scope), which needs one line `import '../../supabase/scripts/seed-demo-catalog.test';` after the existing seed import. It was run on its own with a scratch config (11 passed).
- The concurrency effect of the `for update` lock in take_down_source is not testable in one pgTAP session.
