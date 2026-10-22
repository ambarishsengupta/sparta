# Sparta: Low-Level Design (LLD)

| Field | Value |
| --- | --- |
| Document | Low-Level Design |
| Version | 1.2 (final; amended after the full document review) |
| Date | 2026-10-22 |
| Author | Business analyst (drafted for the product owner) |
| Reviewer | C. Prashanth (Solution Architect) |
| Approver | Ambarish Sengupta (Product Owner) |
| Traces to | BRD v1.2, FDD v1.3, HLD v1.2; legal pack in `legal` |
| Status | Final |

## 1. Purpose and how to read this document

This document turns the HLD into buildable detail: tables, security policies, functions, job processing, API routes, the web app's modules, tests and operations. Code shown is design-level SQL and TypeScript or Python pseudocode. It is precise enough to implement from, but each snippet is verified by the tests in section 11 before it is trusted.

Decisions taken in this document, as answered by the SA:

| Topic | Decision |
| --- | --- |
| Web data access | Supabase JS client with generated types; row-level security (RLS) does the security. |
| Job queue | A Postgres `jobs` table, claimed with `FOR UPDATE SKIP LOCKED` polling. |
| UI stack | Tailwind CSS with shadcn/ui components. |
| Document shape | One LLD, with a section per component. |

Section 16 lists where this LLD refines or departs from the HLD. Those points need the SA's explicit agreement.

## 2. Conventions and tooling

| Area | Choice |
| --- | --- |
| Languages | TypeScript (strict) for the web app and shared packages; Python 3.11 for the worker and collector; SQL for the database. |
| Web | Next.js 16 or later (App Router), React, Tailwind CSS, shadcn/ui, TanStack Query, react-hook-form with zod, Recharts, next-intl, a service worker library for the PWA (for example Serwist). |
| Database | Supabase Postgres 15 or later. Extensions: `pgcrypto`, `pg_cron`, `pg_trgm`. |
| Extension objects | `pgcrypto` and `pg_trgm` live in Supabase's `extensions` schema, which the fixed `search_path` of `security definer` functions (section 10) does not include. Always schema-qualify them: `extensions.gen_random_bytes`, `extensions.digest`, `extensions.similarity`, `extensions.gin_trgm_ops`. `gen_random_uuid()` is built in and needs no prefix. |
| Naming | Tables and columns in `snake_case`; IDs are `uuid` (default `gen_random_uuid()`) except job and run IDs, which are `bigint` identities. Function parameters are prefixed `p_` so they never clash with column names. |
| Time | `timestamptz` everywhere, UTC. Dates the user picks (purchase date, plan date) are `date`. |
| Money | `numeric(12,2)` plus an ISO 4217 `char(3)` currency on every amount. |
| Migrations | One SQL file per change in `supabase/migrations`, applied by the Supabase CLI. No manual schema changes in the dashboard. Project settings (exposed schemas, Auth hooks) live in `supabase/config.toml` and are applied with `supabase config push`; only secrets, such as the Auth SMTP password, are entered in the dashboard (12.3). Migration order: schemas and their grants (4.1); lookups (4.2); colour tables and functions (4.3); `app.profiles` and `app.consent_records`; catalogue tables (4.8); the other 4.4 tables; the 4.9 tables, including `ops.settings`; helper functions and policies (4.5); `app.jobs` and its policies (7.2); storage functions and policies (4.6); analytics (section 5); the query log (5.7). |
| Types | `supabase gen types typescript --schema app,catalog,analytics` run in CI; the build fails if the generated file is stale. |
| Lint and format | ESLint, Prettier, `tsc --noEmit`; Ruff and Black for Python; `sqlfluff` for SQL. |
| Commits | Short imperative messages. Pull requests need green CI. |
| Licence headers | GPL-3.0 notice at the top of each source file; `LICENSE` at the root. |
| Secrets | Environment variables only (section 12). A secret scanner runs in CI and as a pre-commit hook. |

## 3. Repository and module structure

```
sparta/
  apps/web/
    app/
      (auth)/                sign-in, sign-up, verify, reset
      (public)/              about, privacy, terms, notice, maintenance
      (consumer)/            accept-terms, pilot-notice, onboarding, not-available, wardrobe, outfits, wishlist, purchases, me
      (vendor)/              agreement, dashboard, gaps, reports, feed, account
      (admin)/               vendors, users, sources, review, settings, runs, deletions, worker status, query log
      api/                   route handlers (section 6)
    components/              ui/ (shadcn), wardrobe/, outfits/, vendor/, shared/
    lib/
      supabase/              browser.ts, server.ts, proxy.ts (session refresh called by the root proxy)
      colour/                convert.ts, family.ts, picker adapters
      image-prep.ts          browser re-encoding of images before upload (9.4)
      season.ts
      i18n/                  messages/en.json
    proxy.ts                 auth, role and consent gating (Next.js 16 name for middleware.ts)
    vercel.json              function region (bom1) and deployment settings (12.1, 12.3)
    public/                  manifest, icons
    sw/                      service worker source
  packages/
    taxonomy/                taxonomy.json, types, validators (TS and Python reads same JSON)
    rules/                   outfit rule engine (pure TypeScript) and tests
  services/worker/
    app/                     main.py, queue.py, heartbeat.py, handlers/{photo,receipt}.py, parse/
    tests/  Dockerfile  compose.yaml
  jobs/collector/
    sources/                 one adapter per storefront
    run.py  mapping/
  supabase/
    migrations/  seed/  tests/ (pgTAP)  config.toml
  .github/workflows/         ci.yml, deploy.yml, collect.yml, fx.yml, keepalive.yml, housekeeping.yml, monitor.yml
  docs/
  legal/                     privacy policy, terms, vendor agreement, incident plan, risk assessment, sourcing policy, review log
```

Rule: anything that must agree across the web app, worker, collector and feed validator (taxonomy values, colour families, size systems) lives in `packages/taxonomy` and is loaded into the database by a seed migration, not retyped.

## 4. Database design

### 4.1 Schemas and exposure

| Schema | Purpose | Exposed through the Supabase API |
| --- | --- | --- |
| `app` | Per-user data | Yes, protected by RLS |
| `catalog` | Taxonomy lookups, catalogue, vendors, sources | Yes, read access by policy |
| `analytics` | Vendor-facing aggregate tables and functions | Functions only; tables have no grants |
| `analytics_private` | Anonymised fact table; cube staging table (raw counts, emptied every run) | **No** (not in the exposed schemas list) |
| `ops` | Settings, runs, audit, FX rates, worker heartbeat | No |

The exposed list is set in `supabase/config.toml` as `[api] schemas = ["app", "catalog", "analytics"]` and applied to the dev and production projects with `supabase config push`, so the dashboard is not edited by hand. The first migration creates the schemas (`create schema app; create schema catalog; create schema ops; create schema analytics; create schema analytics_private;`). A migration grants `usage` on these three schemas to `authenticated` and `service_role`, and on `app` only to `anon`, which can call nothing there except `app.supported_countries()` (4.5). Table and function grants are as in 4.5 and section 10. The secret-key client used by the server routes acts as the `service_role` Postgres role, which bypasses RLS but still needs grants, so it is granted all privileges on the tables in `app` and `catalog`. `analytics_private` and `ops` get no usage grant for `anon`, `authenticated` or `service_role`. Because the API reaches only the exposed schemas, server routes read and write `ops` tables (invitations, settings, deletion log, daily counts, admin audit log, monitoring data) only through `security definer` functions in `app` whose execute is granted to `service_role` alone.

### 4.2 Lookup tables (`catalog`)

One small table per taxonomy list, all with `code text primary key`, `label text`, `sort int` and `active boolean`: `lk_category`, `lk_sub_type` (adds `category` referencing `lk_category`; its primary key is `(category, code)` instead of `code`, so a sub-type belongs to one category and can be the target of a composite foreign key), `lk_colour_family`, `lk_fit`, `lk_material`, `lk_pattern`, `lk_season`, `lk_occasion`, `lk_size_system`, `lk_size` (adds `size_system` FK; key `(size_system, code)`; the allowed values for each size system), `lk_brand` (the brand list used for suggestions and to normalise typed brands, FDD section 13), `lk_condition_band` (adds `min_score`, `max_score`), `lk_price_band`, `lk_region`, `country_region(country char(2) primary key, region text)`.

Single-value taxonomy columns in `app` tables reference these with foreign keys. `category` and `sub_type` use a composite foreign key to `lk_sub_type (category, code)`; `fit`, `material`, `pattern` and `size_system` reference their own tables; `wishlist_entries` does the same for the attributes it copies. Array columns (`seasons`, `occasions` on `items`, `wishlist_entries` and `outfits`, and `occasions` on `profiles`) cannot carry foreign keys, so a `before insert or update` trigger `app.check_taxonomy_arrays()` rejects any value not in `lk_season` or `lk_occasion`. The colour family columns are not foreign keys: only the colour trigger (4.3) sets them, from the swatch table. `catalog.catalog_items` has no foreign keys to the lookups, because unmapped collector rows are kept with `status = 'review'` (8.1). Its rows are checked against the taxonomy on import (8.1, 8.2), and only active rows are visible to consumers.

```sql
create table catalog.lk_category (code text primary key, label text not null,
  sort int not null default 0, active boolean not null default true);
-- lk_colour_family, lk_fit, lk_material, lk_pattern, lk_season, lk_occasion, lk_size_system,
-- lk_brand, lk_price_band and lk_region have the same shape as lk_category
create table catalog.lk_sub_type (category text not null references catalog.lk_category(code),
  code text not null, label text not null, sort int not null default 0,
  active boolean not null default true, primary key (category, code));
create table catalog.lk_size (size_system text not null references catalog.lk_size_system(code),
  code text not null, label text not null, sort int not null default 0,
  active boolean not null default true, primary key (size_system, code));
create table catalog.lk_condition_band (code text primary key, label text not null,
  sort int not null default 0, active boolean not null default true,
  min_score smallint not null, max_score smallint not null);
create table catalog.country_region (country char(2) primary key, region text not null);
```

`lk_condition_band` seed: Brand new 0-9, Like new 10-29, Good 30-59, Worn 60-84, Falling apart 85-100.

### 4.3 Colour handling

```sql
create table catalog.colour_family_ref (
  id serial primary key,
  family text not null references catalog.lk_colour_family(code),
  hex char(7) not null,
  l float8 not null, a float8 not null, b float8 not null   -- CIELAB, filled by the seed
);
-- seed (draft, to be tuned by the style specialist)
-- Black 000000; White FFFFFF; Grey 808080, A9A9A9, 4D4D4D, D3D3D3; Navy 1F2A44, 000080, 191970;
-- Blue 1E5AA8, 6FA8DC, 0000FF, 4169E1, ADD8E6; Teal 008080; Green 2E8B57; Olive 6B6B2F;
-- Khaki C3B091, F0E68C, BDB76B; Beige E8DCC2, D9C7A0; Brown 5C4033, 8B5A2B; Maroon 800000, 7B1E3A, 5A1F2E;
-- Red D62828; Orange F28C28; Yellow F7D038; Pink F4A6C0; Purple 6A3D9A.
-- "Multi" has no swatch: it is assigned only when is_multicolour is true.

create function catalog.srgb_lin(p_c float8) returns float8 language sql immutable as $$
  select case when p_c <= 0.04045 then p_c/12.92 else power((p_c+0.055)/1.055, 2.4) end $$;

create function catalog.rgb_to_lab(p_r int, p_g int, p_b int) returns float8[]
language plpgsql immutable strict as $$
declare rl float8 := catalog.srgb_lin(p_r/255.0); gl float8 := catalog.srgb_lin(p_g/255.0); bl float8 := catalog.srgb_lin(p_b/255.0);
        x float8; y float8; z float8; fx float8; fy float8; fz float8;
begin
  x := (0.4124564*rl + 0.3575761*gl + 0.1804375*bl) / 0.95047;
  y :=  0.2126729*rl + 0.7151522*gl + 0.0721750*bl;
  z := (0.0193339*rl + 0.1191920*gl + 0.9503041*bl) / 1.08883;
  fx := case when x > 0.008856 then cbrt(x) else 7.787*x + 16.0/116 end;
  fy := case when y > 0.008856 then cbrt(y) else 7.787*y + 16.0/116 end;
  fz := case when z > 0.008856 then cbrt(z) else 7.787*z + 16.0/116 end;
  return array[116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
end $$;

create function catalog.colour_family(p_r int, p_g int, p_b int) returns text
language sql stable strict as $$
  with q as (select catalog.rgb_to_lab(p_r, p_g, p_b) as lab)
  select c.family from catalog.colour_family_ref c, q
  order by power(c.l - q.lab[1], 2) + power(c.a - q.lab[2], 2) + power(c.b - q.lab[3], 2)
  limit 1 $$;
```

The distance is the CIE76 colour difference. Several swatches per family (for example light and dark grey) make the nearest-match regions closer to how people name colours. A check of an earlier draft against common CSS and retail colour values put navy `#000080` and blue `#0000FF` in Purple, khaki `#F0E68C` in Yellow, light grey `#D3D3D3` in Beige and light blue `#ADD8E6` in Grey; the extra Navy, Blue, Khaki and Grey swatches above correct this. The golden vectors in section 11 use colours that are not swatches themselves, so they test the nearest-match regions. LOI-2 retunes the swatches against real items.

Every table with colours (`app.items`, `app.wishlist_entries`, `catalog.catalog_items`) has `colour_r`, `colour_g`, `colour_b` (`smallint`, each with a `check` of 0 to 255), `colour_hex`, `colour_family`, `is_multicolour`, and for items a secondary set (`colour2_r`, `colour2_g`, `colour2_b`, with the same checks, either all set or all null). A `before insert or update` trigger `catalog.set_colour_fields()`:

- recomputes `colour_hex` from RGB;
- sets `colour_family = 'Multi'` when `is_multicolour`, otherwise `catalog.colour_family(r, g, b)` (null when the RGB values are null, for example a catalogue row held for review);
- on `app.items` only (the trigger checks `tg_table_name = 'items'`), does the same for the secondary colour when `colour2_r`, `colour2_g` and `colour2_b` are given, and otherwise sets `colour2_hex` and `colour2_family` to null. `app.wishlist_entries` and `catalog.catalog_items` have no secondary RGB columns; `catalog.catalog_items.secondary_colour_hex` is stored as supplied by the collector or a vendor feed, checked as a hex code (8.1, 8.2), and is used for display only.

Clients cannot set `colour_hex` or `colour_family` (or the secondary colour's) directly: the trigger fires on every insert and update and overwrites any supplied value. A column-level `revoke` is not used, because Postgres ignores it while the table-level `update` that owners need is granted. The trigger runs as the caller, so every role that writes these tables can read `catalog.colour_family_ref` (4.5).

### 4.4 Core tables (`app`)

Columns shown are the design. Common to all: `id`, `created_at`, and `updated_at` where users edit rows (kept by a trigger).

```sql
create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'consumer' check (role in ('consumer','vendor','admin')),
  display_name text, country char(2), hemisphere text check (hemisphere in ('north','south')),
  currency char(3) not null default 'USD',
  occasions text[] not null default '{}',     -- optional preferred occasions (FR-6); default for the suggestion picker
  age_confirmed boolean not null default false,
  deleting boolean not null default false,
  deletion_requested_at timestamptz,          -- set with deleting by /api/account/delete
  created_at timestamptz not null default now()
);

create table app.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  notice_version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, notice_version)
);

create table app.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  catalog_item_id uuid references catalog.catalog_items(id) on delete set null,
  name text not null,
  category text not null references catalog.lk_category(code),
  sub_type text not null,                      -- composite FK below
  colour_r smallint not null check (colour_r between 0 and 255), colour_g smallint not null check (colour_g between 0 and 255),
  colour_b smallint not null check (colour_b between 0 and 255),
  colour_hex char(7), colour_family text, is_multicolour boolean not null default false,
  colour2_r smallint check (colour2_r between 0 and 255), colour2_g smallint check (colour2_g between 0 and 255),
  colour2_b smallint check (colour2_b between 0 and 255), colour2_hex char(7), colour2_family text,
  check (num_nulls(colour2_r, colour2_g, colour2_b) in (0, 3)),
  fit text references catalog.lk_fit(code), material text references catalog.lk_material(code),
  pattern text references catalog.lk_pattern(code),
  size_system text references catalog.lk_size_system(code), size_value text,
  brand text, store text,
  price numeric(12,2), currency char(3), purchase_date date,
  seasons text[] not null default '{}', occasions text[] not null default '{}',
  condition smallint check (condition between 0 and 100),
  never_worn boolean not null default false,
  is_never_worn boolean generated always as (never_worn or coalesce(condition = 0, false)) stored,
  favourite boolean not null default false,
  notes text, barcode text,
  image_path text, image_thumb_path text,
  origin text not null check (origin in ('catalogue','manual','photo','receipt','vendor_feed')),
  status text not null default 'active' check (status in ('active','archived')),
  archive_reason text check (archive_reason in ('sold','donated','discarded','lost')),
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (category, sub_type) references catalog.lk_sub_type(category, code)
);
```

Other tables, all with `user_id` referencing `app.profiles` `on delete cascade` and the owner-only RLS policy in 4.5 (except `jobs`, whose narrower policy is in 7.2, and `analytics_events`, whose insert-only policy is in 4.5):

| Table | Key columns |
| --- | --- |
| `purchases` | `item_id` (cascade), `purchase_date`, `store`, `price`, `currency`, `quantity`, `notes` |
| `receipts` | `storage_path`, `store`, `receipt_date`, `currency`, `total`, `created_at` |
| `purchase_receipts` | `purchase_id`, `receipt_id` (primary key on both) |
| `wishlist_entries` | `catalog_item_id` (nullable, references `catalog.catalog_items` `on delete set null`), copy of attributes (`name`, `category`, `sub_type`, colour fields, `fit`, `brand`, `size_system`, `size_value`, seasons; with the same composite `(category, sub_type)` foreign key as `items`, `fit` referencing `lk_fit` and `size_system` referencing `lk_size_system`), `target_price`, `currency`, `priority` (`low`,`medium`,`high`), `planned_month`, `budget`, `notes`, `status` (`open`,`bought`) |
| `collections`, `item_collections` | user collections and the many-to-many link |
| `tags`, `item_tags` | free tags and the link |
| `outfits` | `name`, `occasions[]`, `seasons[]`, `notes`, `needs_attention` |
| `outfit_items` | `outfit_id`, `item_id`, `slot` (`top`,`bottom`,`layer`,`footwear`,`accessory`) |
| `outfit_plans` | `outfit_id`, `plan_date`, `label` |
| `outfit_logs` | `outfit_id`, `logged_on`; never read by any aggregate or counter |
| `suggestion_feedback` | `occasion`, `rule_ids[]`, `accepted` (for rule tuning; no item IDs) |
| `jobs` | section 7.2 (users insert and select only; no update or delete) |
| `analytics_events` | `event`, `props jsonb` (no free text), `created_at`. Uses its own insert-only policy (4.5), not the owner policy |

Wishlist entries copy their attributes so that a wishlist can be aggregated without joining to the catalogue, and so that an entry survives a catalogue item being withdrawn.

Cross-table rules enforced by triggers:
- Archiving an item sets `needs_attention` on outfits that contain it (FR-51).
- Items with `status = 'archived'` are excluded from `outfit_items` inserts.
- Deleting an item cascades to its purchases and outfit links.

### 4.5 Row-level security

Helper functions, `security definer` with a fixed `search_path`:

```sql
create function app.current_role() returns text language sql stable security definer set search_path = app as $$
  select role from app.profiles where id = (select auth.uid()) $$;

-- the eligibility test for any user (extended in 4.9); not callable through the API, because ops is not exposed
create function ops.is_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = app, ops as $$
  select exists (
    select 1 from app.consent_records c
    where c.user_id = p_user
      and c.notice_version = (select value from ops.settings where key = 'current_notice_version')) $$;
revoke execute on function ops.is_eligible(uuid) from public, anon, authenticated;

-- policies need this, so every signed-in user can call it; it answers only for the caller,
-- and is false for everyone while maintenance mode is on (9.1)
create function app.has_consent() returns boolean
language sql stable security definer set search_path = app, ops as $$
  select ops.is_eligible((select auth.uid()))
     and coalesce((select value from ops.settings where key = 'maintenance'), 'off') <> 'on' $$;
```

`ops` is not exposed through the API, so a signed-in user can check only their own eligibility; the aggregation job calls `ops.is_eligible` directly (section 5.1).

Policy pattern for every owner table (`items` shown). `auth.uid()` and the helper functions are each wrapped in `(select ...)` so Postgres evaluates them once per query, not once per row; every other policy that calls them (including `catalog.catalog_items`) wraps them the same way:

```sql
alter table app.items enable row level security;
alter table app.items force row level security;

create policy items_owner on app.items for all to authenticated
  using      (user_id = (select auth.uid()) and (select app.current_role()) = 'consumer' and (select app.has_consent()))
  with check (user_id = (select auth.uid()) and (select app.current_role()) = 'consumer' and (select app.has_consent()));
```

Other policies:

| Table | Policy |
| --- | --- |
| `app.profiles` | Select and update own row, with no consent gate. `authenticated` gets no table-level `insert` or `update`, only `grant update (display_name, country, hemisphere, currency, occasions) on app.profiles to authenticated`, because a column `revoke` has no effect while a table-level grant exists. So a user cannot change `role` (service role only), `age_confirmed` (set by `app.accept_documents`, 4.9) or `deleting` and `deletion_requested_at` (set by `/api/account/delete`). A changed `country` is still checked by `app.has_consent()`. Insert by the sign-up trigger only. `supabase_auth_admin` may select `id` and `role` for the access-token hook (section 10). |
| `app.consent_records` | Insert and select own rows with no consent gate (a user must be able to accept). The insert check also requires `notice_version = (select app.public_setting('current_notice_version'))`, read through a `security definer` helper (below) because `ops` has no grants. No update, no delete (deletion is by cascade). |
| `app.document_acceptances` | Select own rows with no consent gate. No insert, update or delete policy: rows are written only by `app.accept_documents` (4.9). Deletion is by cascade. |
| `app.analytics_events` | Insert only, with `user_id = (select auth.uid())` and either `(select app.current_role()) = 'consumer' and (select app.has_consent())` or `(select app.current_role()) = 'vendor'`. No select, update or delete for clients. Rows are removed with the account by cascade, and when the pilot ends. |
| `catalog.vendor_agreement_acceptances` | Select own rows. Insert own row only: `user_id = (select auth.uid())`, the caller is a member of `vendor_id` (a vendor user can select their own `catalog.vendor_members` rows), and `version = (select app.public_setting('current_vendor_agreement_version'))`. No update, no delete (deletion is by cascade). |
| `catalog.vendor_members` | `select` for `authenticated` on own rows only (`grant select on catalog.vendor_members to authenticated`; policy `using (user_id = (select auth.uid()))`), which the acceptance policy above relies on. No writes; memberships are managed by server routes. `catalog.vendors` has no client grants. |
| `catalog.catalog_items` | `select` for `authenticated` consumers with consent, where `status = 'active'`. Vendors and admins manage their own rows through server routes only. |
| `catalog.lk_*`, `catalog.colour_family_ref` | `select` for `authenticated`; no writes. The colour trigger in 4.3 runs as the caller, so it needs to read the swatch table. |
| `catalog.sources`, `catalog.feed_uploads`, `ops.*` | No policies or grants for `anon` or `authenticated`. Reached by the service role in server routes (for `ops`, through the `app` functions described in 4.1), by admin-only functions such as `catalog.take_down_source` (4.8), by the read-only functions below, and by the limited roles in the next row. The one other exception is `ops.invitations`, which `supabase_auth_admin` may select for the sign-up hook (4.9). |
| Limited roles `worker_role`, `collector_role`, `fx_role`, `backup_role` | These roles are not `authenticated`, so the policies above do not apply to them, and RLS would show them no rows. Each role gets `usage` on the schemas it touches, the grants in 7.1, 8.1, 12.1 and 13.3, and a matching policy on each table. `worker_role`: `select` and `update` on `app.jobs` `using (true)`; `select` on `catalog.lk_*`, and on `catalog.catalog_items` where `status = 'active'`; `select`, `insert` and `update` on `ops.worker_heartbeat`; `usage` on schema `extensions` for `extensions.similarity`. `collector_role`: `select` on `catalog.sources` and `update` of its `last_collected_at` column only; `select` on `catalog.lk_*` and `catalog.colour_family_ref`; `select`, `insert` and `update` on `catalog.catalog_items` where `source_id is not null`. `fx_role`: `select`, `insert` and `update` on `ops.fx_rates`. `backup_role`: `select` on every table, including `auth.users` and `storage.objects`, and the `bypassrls` attribute instead of policies, because `pg_dump` stops at any table whose rows RLS would hide; no write privilege. |
| `analytics`, `analytics_private` | No table grants. Vendors call `security definer` functions (5.4); the report builder is `analytics.build_report` (5.5). |

Example (the worker's claim in 7.2 needs both):

```sql
create policy jobs_worker_select on app.jobs for select to worker_role using (true);
create policy jobs_worker_update on app.jobs for update to worker_role using (true) with check (true);
```

Some `ops` data is needed outside the server routes. Each piece is read through a `security definer` function, with `revoke execute ... from public` and an explicit grant (section 10):

```sql
create table ops.fx_rates (
  currency  char(3) not null,
  rate_date date not null,
  per_usd   numeric(18,8) not null check (per_usd > 0),   -- units of this currency per 1 USD; written daily by fx.yml (12.1)
  primary key (currency, rate_date)
);

-- latest rate per currency, for display conversion (FR-33); granted to authenticated
create function app.latest_fx_rates() returns table (currency char(3), rate_date date, per_usd numeric)
language sql stable security definer set search_path = ops as $$
  select distinct on (f.currency) f.currency, f.rate_date, f.per_usd
  from ops.fx_rates f order by f.currency, f.rate_date desc $$;

-- the supported-country list only (FR-8, FR-9, FR-67); granted to anon and authenticated
create function app.supported_countries() returns text[]
language sql stable security definer set search_path = ops as $$
  select string_to_array(value, ',') from ops.settings where key = 'supported_countries' $$;

-- the non-secret settings that policies, proxy.ts and the gate pages need (4.9, 9.1); granted to authenticated
create function app.public_setting(p_key text) returns text
language sql stable security definer set search_path = ops as $$
  select value from ops.settings
  where key = p_key
    and p_key in ('current_notice_version', 'current_terms_version', 'current_privacy_version',
                  'current_vendor_agreement_version', 'maintenance', 'pilot_end_date', 'pilot_outcome') $$;

-- functions are executable by PUBLIC by default; restrict them
revoke execute on function app.current_role(), app.has_consent(), app.latest_fx_rates(),
  app.public_setting(text), app.supported_countries() from public;
grant execute on function app.current_role(), app.has_consent(), app.latest_fx_rates(),
  app.public_setting(text) to authenticated;
grant execute on function app.supported_countries() to anon, authenticated;
```

Sign-up trigger `app.handle_new_user()` (`security definer`, `after insert` on `auth.users`) inserts a `profiles` row with role `consumer`, sets `accepted_at` on the matching invitation and adds 1 to the day's `signups` count in `ops.daily_counts` (9.6). It never refuses a sign-up; that is done by the hook in 4.9, because an exception raised in this trigger reaches the client only as a generic 500 error. Vendor and admin accounts are created by the server route in section 6 with role set explicitly, and a vendor cannot become a consumer or the reverse.

### 4.6 Storage

Private buckets `item-images`, `receipts`, `exports`. Object path `{user_id}/{uuid}.{ext}`.

```sql
-- bytes the caller already stores in item-images and receipts (4.6 cap)
create function app.storage_used() returns bigint
language sql stable security definer set search_path = storage as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
  where o.bucket_id in ('item-images', 'receipts')
    and (storage.foldername(o.name))[1] = (select auth.uid())::text $$;
revoke execute on function app.storage_used() from public;
grant execute on function app.storage_used() to authenticated;

create policy "own folder read"  on storage.objects for select to authenticated
  using (bucket_id in ('item-images','receipts','exports')
         and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.has_consent()));
create policy "own folder write" on storage.objects for insert to authenticated
  with check (bucket_id in ('item-images','receipts')
         and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.has_consent())
         and (select app.storage_used()) < 8388608);
-- no update or delete policy for users; objects are removed only by the server routes in section 6
-- (account, item, receipt and unused-image deletion)
```

`authenticated` is not granted `delete` on `app.items` or `app.receipts`. An item or receipt can be deleted only through its route in section 6, which deletes its storage objects first (FR-16, FR-47).

Limits set on the buckets: images 5 MB, receipts 8 MB, exports 50 MB (the free-plan maximum per file); allowed types `image/jpeg`, `image/png`, `image/webp`, `application/pdf` for receipts only, and `application/zip` for exports only.

Images are re-encoded in the browser before upload (9.4 `lib/image-prep.ts`): item photos to at most 1,200 pixels and receipt photos to at most 2,000 pixels on the long side. PDF receipts are uploaded as they are. Each user may store about 8 MB across `item-images` and `receipts`: an upload is refused once the caller already stores 8 MB, so the total can exceed 8 MB by at most one file (the policy checks the objects already stored, because the size of the object being uploaded may not be known when the policy runs). The `security definer` function `app.storage_used()` sums `metadata->>'size'` of the caller's objects in those two buckets, and the app explains the limit when an upload is refused.

### 4.7 Indexes

| Index | Reason |
| --- | --- |
| `items (user_id, status, created_at desc)` | Default wardrobe list |
| `items (user_id, category, colour_family)` | Common filters |
| `items (user_id) where is_never_worn` | "Never worn" filter |
| GIN on `items (seasons)`, `items (occasions)` | Array filters |
| `purchases (user_id, purchase_date desc)` | Purchases list |
| `wishlist_entries (user_id, status)` | Wishlist |
| `catalog_items` GIN `extensions.gin_trgm_ops` on `name` and `brand`; btree on `(category, colour_family)` | Catalogue search |
| `catalog_items (gtin)` partial where `gtin is not null` | Barcode lookup (FR-26) |
| `jobs (status, run_after, id)` partial where `status = 'queued'` | Job claim |
| `analytics_events (event, created_at)` | Pilot measures |

### 4.8 Catalogue and vendor tables (`catalog`)

```sql
create table catalog.sources (
  id serial primary key, name text not null, site_url text not null,
  robots_allowed boolean not null, terms_note text not null, allowed boolean not null default false,
  checked_on date not null, contact text, last_collected_at timestamptz, takedown_at timestamptz, takedown_note text
);
create table catalog.vendors (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table catalog.vendor_members (vendor_id uuid references catalog.vendors(id) on delete cascade,
  user_id uuid references app.profiles(id) on delete cascade, primary key (vendor_id, user_id));
create table catalog.catalog_items (
  id uuid primary key default gen_random_uuid(),
  source_id int references catalog.sources(id) on delete cascade,
  vendor_id uuid references catalog.vendors(id) on delete cascade,
  sku text not null, name text not null, brand text,
  gtin text check (gtin ~ '^[0-9]{14}$'),            -- barcode number, left-padded with zeros to 14 digits (FR-26)
  category text, sub_type text,
  colour_r smallint check (colour_r between 0 and 255), colour_g smallint check (colour_g between 0 and 255),
  colour_b smallint check (colour_b between 0 and 255), colour_hex char(7), colour_family text,
  is_multicolour boolean not null default false, secondary_colour_hex char(7),
  fit text, material text, pattern text, sizes_available text[],
  price numeric(12,2), currency char(3), seasons text[], occasions text[],
  product_url text not null, collected_at timestamptz not null default now(), missed_runs smallint not null default 0,
  status text not null default 'active' check (status in ('active','review','withdrawn')),
  check ((source_id is not null) <> (vendor_id is not null)),
  check (status <> 'active' or (category is not null and sub_type is not null)),
  unique nulls not distinct (source_id, vendor_id, sku)
);
create table catalog.feed_uploads (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references catalog.vendors(id) on delete cascade,
  uploaded_by uuid not null references app.profiles(id) on delete cascade,
  rows jsonb not null,                  -- validated rows awaiting the vendor's confirmation
  created_at timestamptz not null default now()
);
```

The colour columns stay nullable, because unmapped collector rows are held for review.

Taking a source down (FR-103, Data Sourcing Policy section 7) uses the admin-only function `catalog.take_down_source(p_source int, p_note text)`. It is `security definer` with a fixed `search_path`; execute is revoked from `public` and granted to `authenticated`. It raises `forbidden` if `app.current_role() is distinct from 'admin'`. Then, in one transaction, it sets `allowed = false`, `takedown_at = now()` and `takedown_note = p_note` on the source, and deletes the source's rows from `catalog.catalog_items`. The source row is never deleted. It stays in the register (FR-100) as the record of the request and as the marker that the source must not be collected again. Users' items and wishlist entries that pointed to a deleted catalogue item keep their own attributes and lose only the link (`on delete set null`).

Validated feed rows wait in `catalog.feed_uploads` until the vendor confirms (FR-91). The publish route deletes the row, and a `pg_cron` job deletes any upload older than 24 hours.

Barcode lookup (FR-26): the app pads the scanned or typed code with zeros to 14 digits and selects active `catalog_items` with that `gtin` (allowed under the existing consumer select policy). `app.items.barcode` stores the code in the same padded form.

### 4.9 Invitations, supported countries and acceptances

These tables implement the legal controls from the legal and privacy review (`legal/LEGAL-REVIEW.md`).

```sql
create table ops.invitations (
  email text primary key check (email = lower(email)),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  note text
);

create table ops.settings (
  key text primary key,
  value text not null
);
-- seeded keys: current_notice_version, current_terms_version, current_privacy_version,
-- current_vendor_agreement_version, supported_countries (comma-separated ISO codes, initially 'IN'),
-- min_group_size ('10' in the pilot, '50' in production), maintenance ('off' by default; see 9.1),
-- pilot_end_date (ISO date, empty until the admin sets it), pilot_outcome ('close' or 'continue'),
-- pilot_end_notice_sent_at (empty until the end-of-pilot email has gone out; FR-69)

create table app.document_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  document text not null check (document in ('terms','privacy_policy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

create table catalog.vendor_agreement_acceptances (
  vendor_id uuid not null references catalog.vendors(id) on delete cascade,
  user_id uuid not null references app.profiles(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (vendor_id, user_id, version)
);
```

- **Invitation-only sign-up (FR-8).** A Supabase Auth Before User Created hook, the Postgres function `ops.check_invitation(event jsonb)`, runs before any account is created, for email sign-up and Google sign-in alike. If `lower(event->'user'->>'email')` is not in `ops.invitations`, it returns `{"error": {"http_code": 403, "message": "Sparta is invitation-only during the pilot."}}`; otherwise it returns `{}`. Auth passes the message to the client, and the sign-in page and the OAuth callback show it. An exception in a trigger on `auth.users` would also block the sign-up, but the client would see only a generic 500 error. The function is not `security definer`. Execute is revoked from `public`, `anon` and `authenticated` and granted only to `supabase_auth_admin`, which is also granted usage on `ops`, select on `ops.invitations` and a select policy on that table. The hook is enabled in `supabase/config.toml` and applied to each hosted project with `supabase config push` (section 2). `app.handle_new_user()` (4.5) then sets `accepted_at`. For vendor and admin invitations, the server route adds the email to the list before it creates the auth user. The admin manages the list through `/api/admin/invitations` (section 6).
- **Age, Terms and Privacy Policy (FR-2, FR-5, FR-68).** At the first sign-in, and again whenever `current_terms_version` or `current_privacy_version` changes, the page `/accept-terms` shows the 18-or-over tick and the Terms of Use and Privacy Policy tick, separately from the pilot notice and before it (9.1). It calls the `security definer` RPC `app.accept_documents(p_terms_version, p_privacy_version, p_age_confirmed)`. The RPC raises `stale_version` unless both versions equal the current `ops.settings` values and raises `age_not_confirmed` unless the tick is set. It then inserts the two `app.document_acceptances` rows (`on conflict do nothing`) and sets `profiles.age_confirmed`. This screen is the last step of sign-up, so it also covers Google sign-in, where the account exists before any form is shown.
- **Onboarding (FR-6, FR-9).** After the pilot notice, the RPC `app.complete_onboarding(p_country, p_hemisphere, p_currency, p_occasions default '{}')` stores the profile fields for the caller's own row and returns `ok`, or `unsupported_country` when the country is not in `supported_countries`. It does not raise, so the declared country is kept and the user is then held at `/not-available` (9.1). Settings uses the same RPC when the country is changed (FR-60).
- **Eligibility.** `ops.is_eligible(p_user)` (section 4.5), and through it `app.has_consent()`, is extended to require, for that user: the pilot notice accepted at the current version; the Terms and Privacy Policy accepted at their current versions (`app.document_acceptances`); `age_confirmed`; and a `profiles.country` in `supported_countries`. The name `app.has_consent()` is kept so existing policies still apply; its meaning is "eligible participant", and it is also false while maintenance mode is on (9.1). A user who fails it can read only their own profile, consent records and acceptances, and can still use the export and delete routes, which run on the server with the secret key (section 6). The aggregation job's eligibility test (section 5.1, step 3) calls `ops.is_eligible(user_id)`, so both apply the same rules.
- **Vendor agreement (FR-94).** A vendor member inserts a row into `catalog.vendor_agreement_acceptances` through an RLS policy limited to their own vendor and user and to the current version (4.5). The vendor functions in section 5.4 and the vendor feed routes in section 6 refuse the call with `agreement_required` unless the caller has accepted the current agreement version (`ops.settings.current_vendor_agreement_version`). `proxy.ts` (section 9.1) sends a vendor who has not accepted it to `/vendor/agreement`, the page where acceptance is recorded.

## 5. Aggregation and vendor functions

### 5.1 Run: `analytics.run_aggregation()`

A `security definer` function owned by a privileged role, scheduled with `pg_cron` daily at 20:30 UTC (02:00 IST; cron `30 20 * * *`). Execute is revoked from `public`, `anon` and `authenticated`, so it cannot be called through the API; only `pg_cron`, or an admin in the SQL editor, runs it. One run does:

1. Insert an `ops.aggregate_runs` row (start time) and take an advisory lock, so two runs cannot overlap.
2. Pick a random salt in memory only (`encode(extensions.gen_random_bytes(16),'hex')`); it is never stored.
3. Truncate `analytics_private.facts` and rebuild it from three sources (items, wishlist entries, purchases) as four fact kinds, each limited to **eligible users**: `role = 'consumer'`, `deleting = false`, and `ops.is_eligible(user_id)`:
   - `owned`: active items; period is the current month.
   - `wishlist_open`: wishlist entries with status `open`; period is the current month. Used by `gaps` (section 5.4).
   - `wishlist`: all wishlist entries, open or bought; period is the month created. Used by the wishlist trend (FR-74).
   - `purchase`: purchases; period is the purchase month.
4. Each fact row holds: `user_hash` (`encode(extensions.digest(user_id::text || salt, 'sha256'), 'hex')`), `kind`, `period`, `category`, `sub_type`, `colour_family`, `fit`, `brand`, `size`, `season`, `price_band`, `condition_band` (owned only), `region`. No names, emails, images, receipts, notes or outfit logs.
   - `price_band` is computed from the row's own price (`items.price` for `owned`, `purchases.price` for `purchase`, `wishlist_entries.target_price` for `wishlist` and `wishlist_open`) in its `currency`, converted to USD with the latest `ops.fx_rates`, then bucketed (below 25, 25 to 50, 50 to 100, 100 to 200, 200 and above). A missing price or rate gives `Unknown`.
   - `region` is `catalog.country_region` for the user's country, or `Unknown`.
   - `season` is the single season when exactly one is set; `All year` when none is set or `All year` is among them; otherwise `Multi-season`. Purchases use the linked item's seasons. The result never depends on the order in which seasons were stored.
   - `brand` is the `catalog.lk_brand` code whose label matches the item's brand (ignoring case and spaces), `Other` if none matches, or `Unknown` if blank. Typed brand text never enters the facts.
   - `size` is `size_system:code` when the item's size system and size value match a `catalog.lk_size` row (ignoring case and spaces), `Other` if they do not, or `Unknown` if blank. Sizes from different systems therefore never merge.
   - The grouped columns (`category`, `colour_family`, `fit`, `brand`, `size`, `season`, `price_band`, `region`) are `not null` in `facts`. An empty value is stored as `Unknown`, as for `region`. `condition_band` is `Unrated` for an owned item with no condition rating, and null for the other kinds.
5. Build the cube (5.2), apply suppression (5.3) and publish to `analytics.cube`.
6. Write the audit row: users included, items included, rows suppressed, duration, success or error.

### 5.2 The cube

`analytics.cube` columns: `run_id`, `kind`, `period`, `d_category`, `d_colour_family`, `d_fit`, `d_brand`, `f_size`, `f_season`, `f_price_band`, `f_region` (all nullable; a null means "all" and comes only from the grouping, because facts never hold nulls in these columns, 5.1), `condition_band` (nullable, used only for the condition spectrum), `users_rounded`, `events_rounded`, and `users_floor` (used only for the second minimum-group check in 5.4, never returned to vendors). The raw counts `users` (distinct `user_hash`) and `events` (rows) exist only in the staging table `analytics_private.cube_stage`. It has the same dimension columns, is emptied at the start of each run and is truncated after publishing (5.3).

Grouping sets, generated programmatically in the function: for each dimension group `D` in {`category`}, {`colour_family`}, {`fit`}, {`brand`}, {`category, colour_family`}, {`category, fit`}, {`category, brand`}, and each filter `F` in {none, `size`, `season`, `price_band`, `region`}, one grouping set `D plus F`. At most one filter applies at once (FR-77). A separate pass builds the condition spectrum: one row per `category` and `condition_band`, using only `owned` facts whose `condition_band` is not `Unrated`. Unrated items are left out, so no row stands for "no band". Section 5.3 applies to these rows as to every other row, and in step 2 the bands of a category count as the children of that category.

```sql
-- illustrative shape: the column list and the grouping sets are generated by the function
insert into analytics_private.cube_stage (...)
select kind, period, category, colour_family, fit, brand, size, season, price_band, region,
       count(distinct user_hash), count(*)
from analytics_private.facts
group by kind, period, grouping sets (<generated list>);
```

### 5.3 Suppression and rounding

1. **Minimum group size.** Mark rows with `users < (select value::int from ops.settings where key = 'min_group_size')` (value 10 in the pilot, 50 in production).
2. **Complementary suppression.** A row's children are the rows with the same `kind`, `period` and values that add exactly one attribute: a filter value (for example `category` = Tops split by `size`) or a finer dimension group (for example `category` = Tops split by `colour_family`). Each added attribute gives a separate set of siblings. For each unmarked parent and each of its sibling sets, if any child is marked and either only one child is marked or the marked children together have fewer than `min_group_size` users, mark the smallest unmarked child in that set (if one remains). Repeat until no new row is marked, then delete every marked row (its `users` and `events` together), so that no hidden value, alone or summed with its hidden siblings, can be recovered by subtracting from the parent.
3. **Rounding.** Set `users_rounded = round(users / 5.0) * 5` and `events_rounded` likewise (nearest 5, as decided). Also set `users_floor = floor(users / 5.0) * 5`. `min_group_size` must be a multiple of 5 (10 in the pilot, 50 in production), so `users_floor >= min_group_size` holds exactly when `users >= min_group_size`; `users_rounded` cannot be used for this, because 8 or 9 users round up to 10.
4. **No zero reveal.** A row that rounds to 0 after step 3 is deleted.
5. **Publish.** Copy the dimension columns, the rounded values and `users_floor` (never `users` or `events`) into `analytics.cube`, replacing the previous run. Then truncate `analytics_private.cube_stage`, so raw counts are never kept between runs.

### 5.4 Vendor functions

All are `security definer`, in schema `analytics`, with `search_path` fixed, executable only by `authenticated`, and begin with `if app.current_role() is distinct from 'vendor' then raise exception 'forbidden'; end if;` (a caller with no profile row has a null role, which `<>` would let through). Each has a hard-coded whitelist of dimension and filter names; the values are passed as parameters and never interpolated into SQL. The functions are declared `volatile` (not `stable`), because each one writes to the query log (section 5.7). After the role check each function also verifies that the vendor user has accepted the current Vendor Pilot Agreement version, written as `if not exists (select 1 from catalog.vendor_agreement_acceptances where user_id = (select auth.uid()) and version = (select value from ops.settings where key = 'current_vendor_agreement_version')) then raise exception 'agreement_required'; end if;` so that a missing row or setting refuses the call, and that maintenance mode (9.1) is off (otherwise it raises `maintenance`). It then calls `analytics.log_and_limit` (section 5.7).

Each function's query is held in an internal function in `analytics_private` that reads only `analytics.cube`, so it sees only rows that passed section 5.3. The function in `analytics` is a thin wrapper that adds the checks above. The report builder (5.5) calls the same internal functions. Every internal function reads only rows with `users_floor >= (select value::int from ops.settings where key = 'min_group_size')` and returns only rounded values. This is the second minimum-group check required by HLD 7 (defence in depth), on top of section 5.3 step 1.

| Function | Returns | Used by |
| --- | --- | --- |
| `analytics.ownership_mix(p_dim text, p_filter_dim text default null, p_filter_value text default null)` | segment, `users_rounded` | FR-72 |
| `analytics.trend(p_kind text, p_dim text, p_period_unit text default 'month', p_filter_dim text default null, p_filter_value text default null)` | period, segment, and `users_rounded` for kind `wishlist` (FR-74) or `events_rounded` for kind `purchase` (FR-73); `p_kind` must be `purchase` or `wishlist` | FR-73, FR-74 |
| `analytics.gaps(p_dim text, p_filter_dim text default null, p_filter_value text default null, p_top_n int default 20)` | segment, `owner_users_rounded`, `wishlist_users_rounded`, `gap_score` | FR-75 |
| `analytics.condition_spectrum(p_category text)` | band, share | FR-76 |
| `analytics.filter_options()` | the filter values that currently have visible rows | FR-77 |
| `analytics.coverage()` | rounded user count of the cohort, last run time | Dashboard header |
| `analytics.reports()` / `analytics.report(p_id)` | reviewed report metadata and content | FR-78 |

`trend`: in the pilot `p_period_unit` accepts only `'month'`, because facts hold a month period only (section 5.1). Any other value raises `unsupported_period`. Weekly periods are deferred, because weeks inside a month would let a suppressed week be recovered by subtracting the visible weeks from the month total, and section 5.3 does not cover that.

`gaps`: for a segment, `gap_score = round(wishlist_users_rounded::numeric / nullif(owner_users_rounded, 0), 1)`, read from the current period's `wishlist_open` row (distinct users with at least one open wishlist entry) and `owned` row (distinct users with at least one active item). A user whose open entries were created in different months therefore counts once. Both counts are the rounded values published in `analytics.cube` after section 5.3, never raw counts, so the score reveals nothing beyond the counts already shown. If the `owned` row is missing or suppressed the function returns the segment with `gap_score` null and the label "no visible ownership" and only if the `wishlist_open` row passed. It never computes a score from a suppressed value.

`condition_spectrum`: reads only the band rows that passed section 5.3, so every band it shows has at least the threshold number of users. Only rated owned items count (`Unrated` is left out). A visible band's share is its `events_rounded` divided by the sum of `events_rounded` over the visible bands of that category, rounded to the nearest 5 percentage points, so a hidden band cannot be worked out as 100% minus the others. The function returns every band in `lk_condition_band`. Hidden and empty bands come back with a null share and are shown as "Not enough users to display", never as 0%. If fewer than two bands are visible, the whole category shows "Not enough users to display".

A pgTAP test (section 11) calls every function as a vendor and as a consumer, and checks that it never returns a row with fewer than the threshold users. For `condition_spectrum` it seeds a category of 40 users that has one band of 9 users, and checks that this band comes back with a null share. A second test inserts a row with `users_rounded` below the threshold straight into `analytics.cube`, skipping the aggregation job, and checks that no vendor function returns it or uses it.

### 5.5 Reports

A report is a stored snapshot: `ops.reports (id, period, generated_at, reviewed_by, reviewed_at, payload jsonb)`. The admin generates one on demand (FR-79) through `/api/admin/reports/generate`, which calls `analytics.build_report(p_period)`. That function is `security definer`, with `search_path` fixed, and is executable only by `service_role` (`revoke execute ... from public, anon, authenticated`). It builds the payload from the internal functions behind section 5.4, so the report contains only what a vendor could see. It does not run the vendor role, agreement or rate-limit checks, which apply only to vendor callers. Vendors read reports through `analytics.reports()` and `analytics.report(p_id)`, which return only rows where `reviewed_at is not null`.

### 5.6 Deletion exclusion and re-runs

Deleted users disappear from `app` by cascade, so the next nightly rebuild excludes them. Facts are rebuilt from scratch each run, so no earlier run's data is retained in `analytics_private`. The published cube is replaced each run; only the audit row is kept (FR-64, FR-86). Reviewed report snapshots (5.5) hold only published, rounded figures and are kept for the pilot (13.4).

### 5.7 Vendor query log and rate limit

```sql
create table ops.vendor_query_log (
  id bigint generated always as identity primary key,
  vendor_id uuid not null,
  user_id uuid not null,
  fn text not null,
  params jsonb,
  called_at timestamptz not null default now()
);
create index on ops.vendor_query_log (vendor_id, called_at);

create function analytics.log_and_limit(p_fn text, p_params jsonb) returns void
language plpgsql security definer set search_path = analytics, ops as $$
declare
  v_vendor uuid := (select vendor_id from catalog.vendor_members where user_id = (select auth.uid()));
begin
  if v_vendor is null then
    raise exception 'forbidden';
  end if;
  -- calls of the same vendor are counted one at a time, so concurrent calls cannot pass 200 together
  perform pg_advisory_xact_lock(hashtextextended('vendor_query_log:' || v_vendor::text, 0));
  if (select count(*) from ops.vendor_query_log
      where vendor_id = v_vendor and called_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;
  insert into ops.vendor_query_log (vendor_id, user_id, fn, params)
    values (v_vendor, (select auth.uid()), p_fn, p_params);
end $$;
revoke execute on function analytics.log_and_limit(text, jsonb) from public, anon, authenticated;  -- reached only from the vendor functions, which run as its owner
```

Every function in section 5.4 calls `analytics.log_and_limit` straight after its role and agreement checks (FR-88). The limit counts the calls of all users of the same vendor together. A caller with no vendor membership, or with more than one, fails the call. A refused call raises `rate_limited` before its log row is written, so the log shows the 200 answered calls that preceded the refusal. Calls refused by the role or agreement check return no data and are not logged. No client role can execute `log_and_limit`; only the vendor functions, which run as their owner, call it (section 10). The admin console lists the log by vendor and function. Parameters never contain participant data, only dimension names and filter values. The log is deleted when the pilot ends.

## 6. Server routes (Next.js route handlers)

Routes that need a secret use the Supabase secret key (`SUPABASE_SECRET_KEY`; it acts as the `service_role` Postgres role and bypasses RLS), which exists only in Vercel's server environment. Every route first verifies the caller's session and role. The vendor feed routes (`/api/vendor/feed/validate` and `/api/vendor/feed/publish`) also refuse with `agreement_required` unless the caller has accepted the current Vendor Pilot Agreement version (FR-94). They write through the secret key, so the checks in section 5.4 do not cover them.

| Route | Method | Caller | What it does |
| --- | --- | --- | --- |
| `/api/account/delete` | POST | Consumer | Re-authenticates (password or fresh OAuth), sets `deleting = true` and `deletion_requested_at = now()`, deletes the user's storage objects (`item-images`, `receipts`, `exports`), writes the user ID and time to `ops.deletion_log` (13.3), adds 1 to the day's `deletions` count in `ops.daily_counts` (9.6), then deletes the user's `ops.invitations` row and the `auth.users` row (cascade removes all `app` rows). Works for a user who is not eligible (4.9). Returns when complete and sends the confirmation email. On failure the flag stays set and the daily housekeeping run (`/api/internal/housekeeping`) retries. |
| `/api/account/export` | POST | Consumer | Builds the export in the route handler with the secret-key client after checking the session, so it also works for a user who fails the consent check (4.9). It deletes the user's previous export, if any (one export per user at a time); reads the user's rows from every `app` table and downloads their item images and receipts; and writes zip parts of at most 45 MB each, because the free plan caps each stored file at 50 MB, to `exports/{user_id}/{export_id}/part-N.zip`. Part 1 holds one JSON file per table and a `README` explaining the files; each part opens on its own. It then sends the export-ready email, which links to the in-app export page. `maxDuration` is set within the Vercel Hobby limit; at pilot sizes (HLD 6.4) an export is about 8 MB plus its JSON files, because of the 8 MB per-user storage cap (4.6). Limited to 3 a day (section 10). The daily housekeeping run deletes export files older than 7 days. |
| `/api/exports/[id]` | GET | Consumer | Returns short-lived signed URLs, created with the secret-key client, one per part of the caller's own export `[id]`. Only objects under `exports/{caller's user ID}/{id}/` in the `exports` bucket are signed; otherwise the route returns 404. Works for a user who is not eligible (4.9). |
| `/api/items/[id]` | DELETE | Consumer | Reads the item with the caller's session (RLS confirms owner and consent), deletes its `image_path` and `image_thumb_path` objects from `item-images` with the secret-key client, then deletes the row (purchases and outfit links cascade) (FR-16). |
| `/api/items/images/cleanup` | POST | Consumer | Deletes the objects of the photo job just saved that the new item does not reference (the image not chosen and its thumbnail), and any other objects in the caller's `item-images` folder that are older than one hour and that no item of theirs references in `image_path` or `image_thumb_path`: abandoned uploads and, if an earlier call was missed, the image not chosen in the photo flow, its thumbnail, and abandoned uploads (FR-23; HLD HR-1). The item form calls it after saving a photo item. |
| `/api/receipts/[id]` | DELETE | Consumer | Reads the receipt with the caller's session, deletes its object from `receipts` with the secret-key client, then deletes its `purchase_receipts` links and the row (FR-47). |
| `/api/admin/vendors/invite` | POST | Admin | Adds the email to `ops.invitations`, then creates the vendor row and the invited auth user with role `vendor`, adds the membership and sends the invitation, which states the pilot's planned end date (the route refuses while `pilot_end_date` is empty). |
| `/api/admin/invitations` | POST, DELETE | Admin | Adds or removes emails on the invitation list (`ops.invitations`), one at a time or from a pasted list. |
| `/api/vendor/feed/validate` | POST | Vendor | Parses a CSV or JSON upload and validates each row (section 8.2); returns row errors and a preview; stores the validated rows in `catalog.feed_uploads` (section 4.8) and returns the upload ID. |
| `/api/vendor/feed/publish` | POST | Vendor | Given an upload ID belonging to the caller's vendor, upserts its validated rows as `catalog.catalog_items` owned by the vendor and deletes the upload row; supports withdraw. |
| `/api/admin/reports/generate` | POST | Admin | Builds a report snapshot with `analytics.build_report` (5.5). |
| `/api/admin/reports/[id]/review` | POST | Admin | Marks a report reviewed. |
| `/api/admin/users/[id]/delete` | POST | Admin | For a deletion request received at the contact address, after the account-owner check in `legal/CONTACT-ADDRESS.md` section 6: runs the same deletion routine as `/api/account/delete` without re-authentication and sends the confirmation email. Also used to retry a pending deletion (13.2). |
| `/api/admin/users/[id]/export` | POST | Admin | After the same check, runs the same export routine as `/api/account/export` for the user; the export-ready email goes only to the account's own email address. |
| `/api/admin/users/[id]/suspend` | POST, DELETE | Admin | Bans or unbans the user in Supabase Auth (`auth.admin.updateUserById` with `ban_duration`), so they cannot sign in or refresh a session; a current access token lapses within its lifetime (1 hour by default). Terms of Use section 6; Incident Response Plan section 4. |
| `/api/admin/vendors/[id]/end` | POST | Admin | Ends a vendor's access (Vendor Pilot Agreement section 12): suspends every member as above and sets the vendor's catalogue items to `withdrawn`, unless the vendor asked to keep them for the rest of the pilot. |
| `/api/admin/sources` | GET, POST, PATCH | Admin | Keeps the source register in `catalog.sources` (FR-100). |
| `/api/admin/sources/[id]/takedown` | POST | Admin | Takes a source down with `catalog.take_down_source` (4.8): its catalogue items are deleted and the source row is kept with `allowed = false` (FR-103; Data Sourcing Policy section 7). |
| `/api/admin/catalog/review` | GET, POST | Admin | Lists catalogue items with `status = 'review'`; the admin maps an item to the taxonomy and sets it `active`, or sets it `withdrawn` (FR-102). |
| `/api/admin/settings` | GET, PATCH | Admin | Reads and changes only whitelisted `ops.settings` keys: `supported_countries` (FR-9), `maintenance` (9.1), and `pilot_end_date` and `pilot_outcome` (FR-69). |
| `/api/admin/pilot/end` | POST | Admin | Ends the pilot (FR-69, BR-45). Refused before `pilot_end_date` and while `pilot_outcome` is unset. Runs the `/api/account/delete` routine for every consumer who has not accepted the current notice version, or for every consumer if `pilot_outcome = 'close'`; usage events go with each account (they cascade from `app.profiles`). In either outcome it also deletes every `ops.invitations` row whose `accepted_at` is null. If the pilot closes it also runs `/api/admin/vendors/[id]/end` for every vendor, deletes `ops.vendor_query_log`, and then deletes the vendor users' `ops.invitations` rows and `auth.users` rows (their profiles, memberships, agreement acceptances and usage events cascade). Runs in batches and can be called again until nothing is left; progress is shown in `/api/admin/ops`. Deleted accounts leave the backups as they expire (13.3), so nothing of theirs remains 30 days after the end date. |
| `/api/admin/ops` | GET | Admin | Returns the console's monitoring data: worker heartbeat, aggregate runs and audit rows, failed jobs, the deletion queue, the date of the latest exchange rates and the vendor query log (FR-88; 13.1). |
| `/api/worker/signed-urls` | POST | Worker | Authenticated by an HMAC-SHA256 signature keyed with `WORKER_SHARED_SECRET` over the request timestamp, method, path and a SHA-256 hash of the body (which carries the job ID); the route rejects a timestamp more than 60 seconds from server time and compares signatures in constant time. A replay inside that window can only fetch fresh URLs for the same `running` job, so no nonce store is kept. Given a job ID in status `running`, returns a signed download URL for each input object and signed upload URLs for each expected output path. Rejects any path outside the job's owner folder. |
| `/api/internal/housekeeping` | POST | Scheduled job (`housekeeping.yml`) | Authenticated by a bearer token compared in constant time with `HOUSEKEEPING_SECRET`, not by a user session. Uses the secret key, because `pg_cron` cannot delete Storage files, to: (1) delete `exports` objects older than 7 days through the Storage API; (2) rerun the delete routine (storage objects, then the `auth.users` row) for every profile with `deleting = true`; (3) delete objects older than 24 hours whose folder belongs to no profile, or, in `item-images` and `receipts`, that no row references; (4) delete `ops.deletion_log` rows older than 30 days (13.3); (5) if `pilot_end_date` is 14 days away or less and `pilot_end_notice_sent_at` is empty, email every participant what will happen at the end of the pilot (close, or continue under a new notice) and how to export their data, then record the time in `pilot_end_notice_sent_at` (FR-69); (6) return counts, including deletion requests whose `deletion_requested_at` is more than 5 days old. Returns an error status if any step fails. |
| `/api/health` | GET | Uptime ping; `monitor.yml` | Checks the database and returns the last aggregate run time. With `?deep=1` and a bearer token equal to `MONITOR_SECRET`, it also checks: worker heartbeat older than 30 minutes; oldest queued job older than 30 minutes; any deletion request older than 5 days; last aggregate run failed or older than 26 hours; database or storage above 80% of the free limit. If any check fails it returns 503 with the codes of the failed checks only (no user data). |

Every `/api/admin/*` route also writes one row to `ops.admin_audit_log (id bigint generated always as identity primary key, admin_id uuid not null, action text not null, target text, at timestamptz not null default now())` in the same request. `target` holds a row ID (vendor, user, source or report), or for invitation changes only the number of addresses added or removed; never an email address or free text. The table has no grants for `authenticated`, and the admin console lists it. Direct database access through the Supabase dashboard is not captured here (PRA P10 and section 4).

Errors use a consistent JSON shape `{ "error": { "code": "...", "message": "..." } }`; no stack traces or SQL text leave the server.

## 7. Worker

### 7.1 Runtime

A Python 3.11 container with a FastAPI app. It exposes only `/health` on the container's local interface (not published); its work is a background loop.

| Component | Detail |
| --- | --- |
| Database access | One long-lived connection through the Supabase connection pooler (Supavisor) in session mode, using a dedicated Postgres role `worker_role` (see section 12.3). Privileges: `usage` on schemas `app`, `catalog`, `ops` and `extensions`; `select`, `update` on `app.jobs` (it writes `status`, `started_at`, `attempts`, `result`, `last_error`, `run_after` and `finished_at`; job results go in `app.jobs.result`); `select` on the `catalog` lookups and `catalog_items` (for receipt matching with `extensions.similarity`); `select`, `insert`, `update` on `ops.worker_heartbeat`, its only `ops` table. Each grant has a matching RLS policy for `worker_role` (4.5). It cannot read any other user table. |
| Storage access | Through the signed URLs from `/api/worker/signed-urls`. The Supabase secret key is never on the worker machine. |
| Concurrency | One job at a time. Background removal and OCR are memory heavy. |
| Memory | About 2 GB; model files are loaded once at start and kept. |
| Restart | `restart: always` in `compose.yaml`; models pre-downloaded in the image build. |

### 7.2 Job table and claim

```sql
create table app.jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.profiles(id) on delete cascade,
  type text not null check (type in ('photo','receipt')),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  input jsonb not null,                 -- storage paths, options
  result jsonb,                         -- draft lines, output paths
  attempts int not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
```

Users can insert jobs for themselves and read their own job rows, and nothing more. `authenticated` has `select` and a column-limited `insert` grant (`grant insert (user_id, type, input) on app.jobs to authenticated`). It has no update or delete grant or policy. So `status`, `result`, `attempts`, `run_after` and the timestamps always take their defaults, and only the worker (7.1) changes a job after it is created. The insert policy checks `user_id = (select auth.uid())`, `(select app.current_role()) = 'consumer'` and `(select app.has_consent())`, and that every input path starts with the user's own ID, and `(select app.recent_job_count()) < 20` (the rate limit in section 10). A subquery on `app.jobs` inside the policy itself would recurse, so the count comes from a `security definer` function:

```sql
create function app.recent_job_count() returns int
language sql stable security definer set search_path = app as $$
  select count(*)::int from app.jobs
  where user_id = (select auth.uid()) and created_at > now() - interval '1 hour' $$;
revoke execute on function app.recent_job_count() from public;
grant execute on function app.recent_job_count() to authenticated;
```

The worker claims one job:

```sql
update app.jobs set status = 'running', started_at = now(), attempts = attempts + 1
where id = (select id from app.jobs
            where status = 'queued' and run_after <= now()
            order by id
            for update skip locked limit 1)
returning id, user_id, type, input, attempts;
```

A job is attempted at most three times (`attempts` goes up by one on each claim). If a handler raises an error, the worker records `last_error` and sets the job back to `queued` with `run_after = now() + interval '30 seconds'` if `attempts < 3`, or to `failed` otherwise. `no_lines` (7.4) is not retried and goes straight to `failed`. A reaper query, run by `pg_cron` every minute, applies the same rule to jobs stuck in `running` for more than five minutes (for example after a worker crash). Every write the worker makes when it finishes a job (result and `done`, `failed` or requeue) adds `and status = 'running' and attempts = <the value returned by the claim>` to its `where` clause. If no row is updated, the job was reaped or claimed again, and the worker discards its result.

The worker polls every 3 seconds when idle, and immediately again after finishing a job. A user's browser follows its job via a Supabase Realtime subscription on its own job row, with a fallback poll every 5 seconds. The migration that creates the table also runs `alter publication supabase_realtime add table app.jobs;`. Realtime applies the same RLS select policy, so a browser receives changes to its own rows only.

### 7.3 Photo handler

1. Get signed URLs (7.1) and download the original.
2. Validate the file (type by content, not extension; maximum 5 MB; maximum 6,000 pixels on the long side).
3. Remove the background with `rembg` (model `u2netp` for lower memory; `isnet-general-use` if quality needs it).
4. Resize to at most 1,200 pixels on the long side; save as WebP quality 80 with transparency. Also make 320-pixel WebP thumbnails of the cut-out and of the original (Supabase image transformations are not on the free plan).
5. Estimate the dominant colour: downsample, drop transparent pixels, k-means with k = 3, choose the largest cluster that is not near-white background; return RGB.
6. Upload the cut-out and both thumbnails to the signed upload URLs and write `result = { "path": "...", "thumb_path": "...", "original_thumb_path": "...", "dominant_rgb": [r,g,b] }`.
7. Delete temporary files. Status `done`.

On save, `image_path` and `image_thumb_path` point to the chosen image (the cut-out or the original) and its thumbnail; the other files are removed by `/api/items/images/cleanup` (section 6).

### 7.4 Receipt handler

1. Download the image (or the first page of a PDF, rendered with `pdf2image`).
2. Preprocess: auto-rotate, deskew, grayscale, contrast normalise.
3. OCR with PaddleOCR (English, text-line detection and recognition), producing lines with bounding boxes and confidence.
4. Parse (rules in `parse/`):

| Field | Method |
| --- | --- |
| Store | Highest-confidence text in the top region that is not a date, address or phone number. |
| Date | Regular expressions for `dd/mm/yyyy`, `dd-mm-yy`, `d Mon yyyy`, `Mon d, yyyy`; pick the first date near the top. |
| Currency | Symbol or code near totals (`$`, `£`, `€`, `₹`, `Rs`, ISO codes); default to `input.currency`, which the web app copies from the user's profile when it creates the job (the worker cannot read `profiles`). |
| Line items | A line whose last token is an amount (`\d+[.,]\d{2}`), with an optional quantity prefix (`2 x`, `2@`) or a quantity column. The text before the amount is the description. |
| Skipped lines | Keywords such as subtotal, total, tax, GST, VAT, change, cash, card, discount, thank you; and lines with no letters. |
| Clothing guess | Description keywords mapped to categories and sub-types (for example `tee`, `shirt`, `jeans`, `chino`, `sneaker`). Lines with no match are marked `unknown` and pre-skipped (FR-43). |
| Catalogue match | `pg_trgm` similarity (`extensions.similarity`) of the description to `catalog_items.name` and brand; return the top three with scores above 0.4. |

5. Write `result` as JSON: `{ store, date, currency, lines: [{ text, qty, amount, guess: {category, sub_type}, matches: [...], confidence, skip }], overall_confidence }`. If no lines were found, set status `failed` with `last_error = 'no_lines'` so the app shows the manual entry fallback (FR-45).
6. Delete temporary files. The raw text from the scan is kept only in memory and is never stored. The job result (the draft lines) is cleared after **7 days** by a `pg_cron` job.

**Redaction (FR-47).** Before the result is written the worker masks the following in every line and in the store name: card-like numbers (13 to 19 digits, with spaces or dashes, replaced by `[card]`); email addresses (`[email]`); phone numbers (`[phone]`); and numbers that follow words such as member, loyalty, rewards, account or customer (`[id]`). Lines that look like street addresses or postcodes are dropped. Only the store name, date, currency and item lines are kept. Redaction runs before catalogue matching, so masked text is never compared against the database.

### 7.5 Exports (not built by the worker)

The worker does not build exports. They are built by `/api/account/export` on Vercel (section 6), so the worker never reads a user's full data and its privileges stay as listed in 7.1. The daily housekeeping run (section 6, 12.1) deletes export files older than 7 days.

### 7.6 Heartbeat

Every 60 seconds the worker upserts `ops.worker_heartbeat(worker_id, seen_at, queue_depth, oldest_queued_age, version)`. The admin console shows the worker as offline if `seen_at` is older than five minutes.

## 8. Collector and feed validation

### 8.1 Collector (`jobs/collector`)

Run on GitHub Actions on a schedule (weekly during the pilot) and on demand.

1. Read allowed sources from `catalog.sources` where `allowed` is true, skipping any source whose `last_collected_at` is within the last 6 days, so a manual run never collects a source twice in a week (Data Sourcing Policy section 6).
2. For each source: fetch and parse `robots.txt` (`urllib.robotparser`); skip any URL it disallows; stop if the check fails.
3. Request pages at most once every 2 seconds, with the user agent `SpartaPilotBot/0.1 (+<repository URL>)`, honouring `Retry-After` and backing off on errors.
4. Extract only product attributes: SKU (the JSON-LD `sku`, or the product URL when there is none), name, brand, category hints, colour, sizes, price, currency, barcode number (JSON-LD `gtin`, `gtin8`, `gtin12`, `gtin13` or `gtin14`, when present, padded to 14 digits), product URL. Prefer structured data (JSON-LD `Product` markup, sitemaps). No product images are downloaded or stored.
5. Map to the taxonomy through the mapping tables in `jobs/collector/mapping` (category and sub-type keywords, colour names to RGB through a colour-name table that maps each family name and common retail synonyms (for example navy, khaki, beige, olive, maroon, burgundy, charcoal, tan, camel) to that family's reference swatch, then CSS colour names, falling back to hex codes; the trigger in 4.3 then derives the family from that RGB). Anything unmapped is stored with `status = 'review'`, leaving `category` or `sub_type` null if they could not be mapped.
6. Upsert on the unique key `(source_id, vendor_id, sku)` (`vendor_id` is null for collected rows), setting `collected_at = now()` and `missed_runs = 0`. When a source's run completes, its rows not seen in that run get `missed_runs = missed_runs + 1`, and rows that reach 2 are marked `withdrawn`. A run that stops early (step 2) does not count as a missed run.
7. Database access through a limited role `collector_role`: select, insert and update on `catalog.catalog_items`, limited by policy to rows with a `source_id`; select on `catalog.sources` and update of its `last_collected_at` column only, which the collector sets when it finishes each source; read on the lookups and on `catalog.colour_family_ref`, which the colour trigger reads. The policies are in 4.5.

### 8.2 Feed validation

Rules for each row (CSV or JSON), implemented once in `packages/taxonomy` and called by the route:

- Required fields present (`sku`, `name`, `brand`, `category`, `sub_type`, `primary_colour`, `price`, `currency`, `product_url`).
- `category` and `sub_type` in the taxonomy; `sub_type` belongs to the category.
- `primary_colour` is a valid hex code or a known colour name; if a name, it is mapped to RGB through the same colour-name table as the collector (8.1, step 5).
- `price` is a positive number; `currency` is a valid ISO 4217 code.
- `product_url` and `image_url` are well-formed `https` URLs. `image_url` is accepted but not fetched or stored.
- `gtin`, if present, is 8, 12, 13 or 14 digits; it is stored padded with zeros to 14 digits.
- `sku` is unique within the file and the vendor.
- Maximum 5,000 rows and 4 MB per upload (Vercel rejects request bodies over 4.5 MB).

Errors are returned per row and column. Nothing is written until the vendor confirms (FR-91).

## 9. Web application

### 9.1 Access control in the app

`proxy.ts` (called `middleware.ts` before Next.js 16) runs on every request. It reads the user's own profile, consent records, acceptances and agreement rows, which its policies allow with no consent gate (4.5), and the current versions through `app.public_setting` (4.5):

1. No session: redirect to sign-in (public routes excepted).
2. Role `consumer` and either no `app.document_acceptances` row for the current `TERMS_VERSION` or `PRIVACY_VERSION`, or `age_confirmed` false: redirect to `/accept-terms` (4.9). This is the first screen after the first sign-in, so it also covers Google sign-in, and it returns whenever either document changes. A user who declines is sent to `/not-available` (FR-2, FR-5, FR-68).
3. Role `consumer` and no consent record for the current notice version: redirect to `/pilot-notice` (the blocking pop-up page); "No thanks" goes to `/not-available` (FR-3 to FR-5).
4. Role `consumer` with `profiles.country` null: redirect to `/onboarding`. This page asks for the country, hemisphere and currency, and optionally the occasions the user dresses for most, then calls `app.complete_onboarding` (4.9) (FR-6, FR-9).
5. Role `consumer` with `profiles.country` not in `app.supported_countries()` (4.5): redirect to `/not-available`, with the message "The pilot is not open in your country yet" (FR-9).
6. Role `vendor` and no row in `catalog.vendor_agreement_acceptances` for the current agreement version: redirect to `/vendor/agreement`; everything else in the vendor area is blocked (FR-94).
7. Role mismatch (for example a vendor opening a consumer route): redirect to the role's home.

Each gate page is exempt from its own redirect. `/not-available` offers only Export my data, Leave the pilot and Sign out. A consumer held at steps 2 to 5 can reach only the current gate page, `/not-available`, the public pages, `/api/account/export`, `/api/exports/[id]` and `/api/account/delete`; everything else is blocked.

The pilot notice page writes the consent record through the browser client (the insert is allowed by its policy) and records the notice version from a constant shipped with the app and equal to `ops.settings.current_notice_version`. If they differ, the insert is rejected by a check in the policy, and the app shows an error asking the user to reload.

These checks only guide the interface. The database policies in 4.5 are the actual enforcement.

**Other pages (FR-66, FR-67, FR-95).** The About page (`/about`), the Privacy Policy, the Terms of Use and the pilot notice are public pages. Settings has a **Leave the pilot** button that calls `/api/account/delete`; `/about` shows the value of `CONTACT_EMAIL` and the list from `app.supported_countries()`, which the sign-up page also shows (FR-8). The vendor portal's Account page also shows `CONTACT_EMAIL` (FR-95).

**Maintenance mode (Incident Response Plan sections 4 and 7).** While `ops.settings.maintenance` is `on` (set through `/api/admin/settings`, or the Supabase SQL editor if the app is down), `app.has_consent()` returns false for every caller (4.5). As a result, no wardrobe, purchase, wishlist, outfit, job or analytics row and no storage object can be read or written through the API (a user can still read their own profile, consent records and acceptances), the vendor functions refuse the call (5.4), and `proxy.ts` sends every non-admin user to a `/maintenance` page. The nightly aggregation calls `ops.is_eligible` and is not affected.

### 9.2 Data layer

- Two Supabase clients: browser (publishable key, user session) and server (cookie session). The secret-key client is created only inside route handlers that need it, never imported elsewhere (enforced by an ESLint rule on the import path).
- TanStack Query for fetching and caching. Query keys are `['items', filters]`, `['catalog', query]`, and so on. Mutations are optimistic where safe.
- Lists use keyset pagination on `(created_at, id)` with 40 rows a page and infinite scroll. Lists and pickers load `image_thumb_path`; the full-size image loads only on the item page.
- Filters are expressed once as a function that turns a filter object into a Supabase query; the same object serialises into the URL so views can be linked and restored.

### 9.3 Offline and PWA (NFR-2)

- Web manifest, icons, `display: standalone`.
- The service worker caches only the app shell and static assets (cache first). It does not cache API responses: the Cache API matches on the URL, and RLS-filtered URLs are the same for every user.
- For offline reading, TanStack Query persists recent wardrobe, outfit and wishlist queries to IndexedDB under a key that includes the user ID.
- Writes made offline (add or edit an item, wishlist changes, outfit saves) go into an IndexedDB queue through TanStack Query's persisted mutations. Each queued change carries the user ID. Changes replay in order when the connection returns, but only while that user is signed in; otherwise they are dropped. Photo and receipt uploads are not queued offline; the app tells the user they need a connection.
- On sign-out, Leave the pilot, account deletion or a sign-in by a different user (Supabase `onAuthStateChange`), the app clears the persisted queries and the queued changes from the device.
- A visible offline banner shows queued changes.

### 9.4 Key modules

| Module | Contents |
| --- | --- |
| `components/wardrobe/ItemForm` | One form for manual, photo, catalogue and receipt-derived items; zod schema generated from the taxonomy; colour picker; condition slider with band label. |
| `components/shared/ColourPicker` | A hue strip with a saturation and brightness (HSV) area (the `react-colorful` library), a hex input, preset swatches, an eyedropper button using the browser `EyeDropper` API with a canvas-sampling fallback, and the derived family name shown live (computed by the same nearest-swatch function in TypeScript, kept identical to the SQL by a shared test vector file). |
| `components/wardrobe/ConditionSlider` | 0 to 100 slider with band label from `lk_condition_band`; optional (can be cleared). |
| `components/wardrobe/FilterBar` | All filters in FR-11; a "similar colour" control that converts the chosen colour to CIELAB and finds items within a distance threshold using the client-side list. |
| `components/outfits/Builder` | Slots, item picker, saves to `outfits` and `outfit_items`. |
| `components/outfits/Suggestions` | Calls the rule engine (9.5) and shows up to three outfits with reasons. |
| `components/outfits/Calendar` | Month view of `outfit_plans`. The optional "I wore this" action writes an `outfit_logs` row and shows no counter, streak or reminder. |
| `components/purchases/ReceiptFlow` | Upload, wait for the job, editable draft, confirm to create items and purchases in one transaction (an RPC `app.confirm_receipt(p_job_id, p_lines jsonb)`). |
| `lib/image-prep.ts` | `prepareImage(file, maxLongSide?)`: decodes the image with its orientation applied, draws it on a canvas and re-encodes it as JPEG (quality 0.85). This drops EXIF and all other metadata, including GPS location. Every image upload goes through it before reaching storage: item photos at most 1,200 pixels on the long side (HLD 5.1), receipt images at most 2,000 pixels (4.6). PDF receipts are stored as uploaded. |
| `components/vendor/*` | Dashboard cards, bar and line charts (Recharts), gap table, filters, "not enough users to display" states. |
| `lib/season.ts` | `seasonFor(date, hemisphere)`: northern hemisphere December to February winter, March to May spring, June to August summer, September to November autumn; southern hemisphere shifted by six months. |

All text comes from `messages/en.json` (NFR-5). Prices are shown with `Intl.NumberFormat` in the stored currency and, if a rate is available, a secondary converted amount in the profile currency (from `app.latest_fx_rates()`, section 4.5) labelled with the rate date.

**End-of-pilot banner (FR-69).** When `app.public_setting('pilot_end_date')` is 14 days away or less, every consumer page shows a banner with the end date, what will happen, and links to Export my data and Leave the pilot. If the pilot continues, the new notice version is set by then, so the gate in 9.1 shows the new notice in the same period.

### 9.5 Outfit rule engine (`packages/rules`)

A pure TypeScript module with no network or database access; the web app passes it the user's active items.

```ts
type Suggestion = { items: Record<Slot, ItemId | null>; score: number; reasons: string[]; ruleIds: string[] };

function suggest(items: Item[], ctx: { occasion: Occasion; date: Date; hemisphere: 'north'|'south' }): Suggestion[]
```

Algorithm:

1. **Eligibility (hard rules R1, R2).** Keep active items whose seasons include the current season (or none set, or `All year`) and whose occasion tags match, or whose category and sub-type are allowed for the occasion by the occasion table in `rules.json`. Summer excludes coats and heavy knits; sport allows activewear for the top and bottom and sneakers for footwear; Date and Travel use the Casual entry in the occasion table until the style specialist adds their own.
2. **Slot candidates.** Place each item in the slots its sub-type can fill, using the slot map in `rules.json` (FDD section 14; underwear and socks are never placed). Group by slot (`top`, `bottom`, `layer`, `footwear`) and keep the best eight per slot by a cheap pre-score (occasion match, condition not in the Falling apart band). Keep eligible belts as a separate list.
3. **Combinations.** Enumerate top x bottom x footwear x optional layer (at most 8 x 8 x 8 x 9, with early pruning of rule violations). An item that fills two slots (Suit, Tuxedo) is placed in both at once, and no item appears twice in a combination. Then put the eligible belt that scores best on R3 and R6, if there is one, in the `accessory` slot.
4. **Score (R3 to R6).**
   - **Colour (R3).** Convert each item's RGB to CIELAB with the same conversion the colour family function uses, and take chroma `C* = sqrt(a*² + b*²)`. Neutral if its colour family is in the neutral set (Black, White, Grey, Navy, Beige, Khaki, Olive, Brown) or C* is below 10. Bold if C* is above 50 and not neutral. Both thresholds are in `rules.json`. Penalise more than three distinct non-neutral families, and more than one bold item.
   - **Pattern (R4).** Penalise more than one non-solid pattern.
   - **Layering (R5).** In cool seasons, require a layer; penalise a layer whose colour family equals the top's.
   - **Footwear (R6).** Allowed footwear sub-types come from the occasion table; add a bonus when belt and shoes share a colour family.
5. **Variety (R7).** Pick the best combination, then penalise reuse of any item already chosen and pick the next, up to three.
6. **Reasons (R8).** Each satisfied rule contributes a fixed sentence template, for example "Layer works for cool weather" or "Navy and grey are neutral".
7. **Thin wardrobe (FR-54).** If no combination passes the hard rules, return the missing slots as a `missing` list.

Rules and occasion tables are data in `packages/rules/rules.json`, so the style specialist can adjust them without touching code. Unit tests cover each rule with fixtures.

### 9.6 Analytics events

A small `track(event, props)` function inserts into `app.analytics_events` under its insert-only policy (4.5), so only eligible consumers and vendors can record events, and only their own. Allowed events and property keys are whitelisted in code for each role; no free text is allowed. Sign-ups and account deletions happen before a user is eligible or after the account is gone, so they are not events. `app.handle_new_user()` and `/api/account/delete` each add 1 to a daily total in `ops.daily_counts (day date, metric text check (metric in ('signups','deletions')), n int not null default 0, primary key (day, metric))`, which holds no user ID. Notice acceptance is read from `app.consent_records`.

## 10. Security details

| Control | Implementation |
| --- | --- |
| Roles | Role stored in `app.profiles.role`, changeable only by the service role. The role is also copied into the JWT for the interface by a Custom Access Token hook (`app.custom_access_token_hook`), but policies read the database value. Like the sign-up hook (4.9), it is executable only by `supabase_auth_admin`, which is granted usage on `app`, select on `app.profiles` and a select policy on it. Without these grants the hook cannot read the role under RLS, and sign-in fails. |
| Consent gate | `app.has_consent()` in every consumer policy (4.5) and storage policy (4.6). |
| Vendor isolation | Vendors authenticate as the same Postgres role (`authenticated`) as consumers, so isolation rests on: (a) every `app` policy requiring `current_role() = 'consumer'`; (b) `analytics_private` and `ops` not being exposed through the API and having no grants for `authenticated`; (c) `analytics` tables having no grants, with only the vendor functions executable; (d) each function checking the role. This replaces the HLD's earlier wording about privileges on schemas (LD-1); HLD 7 now describes these controls. |
| Grants | `revoke all on all tables in schema ... from anon, authenticated` first, then explicit grants. `anon` has no access to any application table. |
| Functions | `security definer` functions have a fixed `search_path`, schema-qualified object names, and `revoke execute ... from public` followed by an explicit grant. |
| Worker | Database role with the minimum grants (7.1); storage only through short-lived signed URLs, so the Supabase secret key never leaves Vercel. Requests to the signing route are authenticated with an HMAC token, rate limited, and tied to a job in `running` status. |
| Uploads | Size and content-type limits at the bucket; content sniffing in the worker; the worker re-encodes its outputs; the browser re-encodes every image before upload (9.4 `lib/image-prep.ts`), so EXIF metadata, including GPS location, is never stored. PDF receipts are stored as uploaded. |
| Input handling | zod validation on every form and route body; parameterised queries only; vendor functions whitelist dimension names. |
| Rate limiting | Per-user limits on job creation (20 per hour, in the `app.jobs` insert policy through `app.recent_job_count()`, 7.2), exports (3 per day, in `/api/account/export`) and feed uploads (10 per day, in `/api/vendor/feed/validate`). |
| Invitation and region control | The Before User Created hook `ops.check_invitation()` refuses sign-ups for emails not in `ops.invitations` with the FR-8 message; `app.complete_onboarding` records and flags countries not in `supported_countries`, and the app holds those users at `/not-available`; `app.has_consent()` includes the country check, so an account outside the allow-list can read only its own profile, consent records and acceptances (4.9). The invitation is checked only at sign-up; removing an email from `ops.invitations` does not lock an existing account (the admin suspends it instead, section 6). |
| Vendor probing | Every vendor function logs the call and refuses beyond 200 calls an hour (5.7); the admin console shows the log. |
| Receipt privacy | Masking and no stored raw text (7.4); draft results deleted after 7 days. |
| Passwords and sessions | Supabase Auth defaults; minimum length 10; email verification required. Sessions are kept in cookies managed by `@supabase/ssr` and set with `Secure` and `SameSite=Lax`. They are not HTTP-only, because the browser client (9.2) reads them. To limit script injection, the app never renders user-supplied HTML (no `dangerouslySetInnerHTML`), sends a Content-Security-Policy header, and keeps the Supabase default access-token expiry of one hour. |
| Logs | Server logs contain IDs and error codes only; no emails, receipts, notes or OCR text. Admin route actions are recorded in `ops.admin_audit_log` (section 6). Writing Supabase Auth audit logs to the project database (`auth.audit_log_entries`, which holds emails and IP addresses) is turned off in the Auth settings; if that setting is unavailable, the delete route also removes the user's rows from that table. |
| Backups | Taken on the worker host with the read-only `backup_role`; encrypted with `age`, whose private key is never on that host; contain personal data and are treated as such (section 13.3). |

## 11. Testing

| Level | Tools | What is covered |
| --- | --- | --- |
| Database | pgTAP, run in CI against a fresh local Supabase | **RLS:** user A cannot read, update or delete user B's rows in any `app` table or bucket; a user without consent gets no rows; a vendor gets no rows from `app` tables; a consumer, an anonymous caller and a signed-in user with no profile row cannot call vendor functions; a consumer cannot change their own `role`, `age_confirmed` or `deleting`. **Colour:** golden vectors for `colour_family` using colours that are not reference swatches (for example `#00008B` gives Navy, `#1560BD` gives Blue, `#C0C0C0` gives Grey, `#36454F` gives Grey, `#800020` gives Maroon), and null RGB gives null. **Aggregation:** with seeded data, segments under the threshold never appear; rounding is to 5; complementary suppression hides the smallest visible sibling when one sibling is hidden, hides a third when two hidden siblings have fewer than 10 users together, and stops a hidden `category` x `colour_family` cell being recovered from the `category` total; a deleted or unconsented user changes no output; items with no fit, brand, size, price or condition are counted under `Unknown` or `Unrated` and never merge with an "all" row; a brand or size outside the lists reaches the facts only as `Other`. **Gaps:** no score from a suppressed owner row; a user with open wishlist entries created in different months counts once. **Triggers:** archiving an item flags its outfits. **Limited roles:** as `worker_role`, the claim query in 7.2 returns a queued job and reading `app.items` is refused; as `collector_role`, an upsert of a source row succeeds and vendor rows are not visible; as `fx_role`, a rate row can be written. **Legal controls:** `ops.check_invitation` returns the FR-8 error for an email not in `ops.invitations` (FR-8); `app.complete_onboarding` with a country not on the supported list returns `unsupported_country`, and a user without a supported country gets no rows (FR-9); a user without the current Terms and Privacy Policy acceptance gets no rows, and `app.accept_documents` refuses a stale version (FR-68); a vendor function refuses a caller without the current agreement acceptance (FR-94); the 201st vendor call in an hour raises `rate_limited` and the earlier calls appear in `ops.vendor_query_log` (FR-88). |
| Shared logic | Vitest | Rule engine fixtures (each rule, thin wardrobe, variety), season utility, colour conversion and family function (the same golden vectors as SQL), taxonomy validators, feed validation. |
| Worker | pytest | Receipt parser on a fixture set of 30 receipts (varied stores, currencies, crumpled and clean); receipt redaction (card, email, phone and membership numbers masked, address lines dropped, no raw scan text in the stored result) (FR-47); photo handler output size, transparency and thumbnails; job claim concurrency with two workers (no double claim); retry and reaper behaviour, including a reaped job's late result being discarded (7.2). |
| Collector | pytest with recorded HTML | `robots.txt` disallow honoured, rate limit applied, mapping of colour names and categories. |
| Web components | Vitest and Testing Library | Forms, colour picker, filters, empty and error states. |
| End to end | Playwright against the built app (`next start`) and the worker container, both using the local Supabase in CI | Sign up; uninvited email refused at sign-up with the FR-8 message; age, Terms and Privacy Policy ticks required before the pilot notice; pilot notice blocks until accepted, and "No thanks" leaves only export, Leave the pilot and sign out; unsupported country sent to `/not-available`; greyed-out sharing setting with tooltip; add item by each method; delete an item and its image is removed from storage; a photo and a receipt image carrying GPS EXIF are stored with no EXIF; receipt draft needs confirmation; outfit suggestion and calendar; delete account then sign-in fails and the email is no longer in `ops.invitations`; Leave the pilot then sign-in fails; sign out and sign in as a second user on the same browser shows none of the first user's data or queued changes; About page shows the contact address; vendor must accept the agreement before the portal opens; vendor sees dashboard and cannot reach consumer routes. |
| Accessibility | axe in Playwright, manual keyboard pass | Main flows meet WCAG 2.1 AA (NFR-4). |
| Performance | Lighthouse CI on a 500-item account | Main screens load under 3 seconds on a throttled mobile profile (NFR-3). |
| Security | Secret scan, dependency audit, manual review of every policy by the SA | No secrets in the repository; no high-severity advisories. |

Acceptance criteria in FDD section 17 each map to at least one end-to-end, pgTAP or pytest test; the mapping is kept in the test names (for example `FR-80 suppresses segment of 9`).

## 12. CI/CD, environments and configuration

### 12.1 Pipelines

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Pull request | Install, lint, type check, generate types and check for drift, Vitest, start local Supabase and run migrations and pgTAP, build, start the app (`next start`) and the worker container against the local Supabase and run Playwright with axe, secret scan, dependency audit. Worker and collector tests run in a separate job. |
| `deploy.yml` | Merge to main | Apply migrations to the production Supabase project with the CLI (`supabase db push`, after a dry run), using a pinned recent CLI version and `supabase link`, which reach the database through the pooler (12.3). Only if that succeeds, deploy the web app with `vercel deploy --prod`. Vercel's automatic deployment of `main` is turned off (`git.deploymentEnabled` in `vercel.json`), so a new app version never goes live before its migrations. Pull-request previews stay automatic. Migrations are written to be backward compatible with the previous app version. |
| `collect.yml` | Weekly and manual | Run the collector. |
| `fx.yml` | Daily | Fetch exchange rates and write `ops.fx_rates` through a limited role `fx_role` (policy in 4.5). |
| `keepalive.yml` | Daily | Request `/api/health`, which queries the database, so the free database does not pause (free projects pause after 7 days without activity). |
| `housekeeping.yml` | Daily and manual | POST to `/api/internal/housekeeping` with `HOUSEKEEPING_SECRET`. If the call fails, it opens or updates the same `alert` issue as `monitor.yml`. |
| `monitor.yml` | Every 6 hours and manual | Call `/api/health?deep=1` with `MONITOR_SECRET`. On failure, open or update one GitHub issue labelled `alert` that mentions all three team members, so each receives GitHub's notification email. |

Database schedules are created by migrations with `pg_cron`: the job reaper every minute (7.2), the receipt-result purge daily (7.4), the feed-upload purge hourly (4.8) and `analytics.run_aggregation()` daily at 20:30 UTC (5.1). `pg_cron` cannot delete Storage files, so file clean-up and deletion retries run through `housekeeping.yml`.

### 12.2 Environments

| Environment | Web | Database | Worker |
| --- | --- | --- | --- |
| Local | `next dev` | Supabase CLI (Docker) | `docker compose up` |
| Preview | Vercel preview per pull request | Dev Supabase project | Optional |
| Production | Vercel production | Production Supabase project | Container on the host machine |

There is no staging environment; migrations are exercised on a fresh local database in CI (`ci.yml`) before production. Previews use the dev project, which a developer brings up to date with `supabase db push` when a pull request changes the schema, so a preview can lag behind the pull request's migrations; the end-to-end tests do not depend on it.

### 12.3 Configuration (environment variables)

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web (public) | Publishable key (`sb_publishable_...`); safe for the browser |
| `SUPABASE_SECRET_KEY` | Vercel server only | Secret key (`sb_secret_...`); bypasses RLS. Used only in route handlers listed in section 6 |
| `WORKER_SHARED_SECRET` | Vercel server and worker | HMAC key for the signing route |
| `HOUSEKEEPING_SECRET` | Vercel server and GitHub secrets | Bearer token for `/api/internal/housekeeping`; random, at least 32 bytes |
| `MONITOR_SECRET` | Vercel server and GitHub secrets | Bearer token for the deep health check (section 6) |
| `WORKER_DATABASE_URL` | Worker | Connection string for `worker_role`, through the session pooler (note below) |
| `BACKUP_DATABASE_URL` | Worker host, backup job only (not given to the worker container) | Connection string for the read-only `backup_role` used by the weekly `pg_dump` (13.3), through the session pooler. It can read all data, so it is handled like the secret key and rotated if the host is lost or changed |
| `COLLECTOR_DATABASE_URL`, `FX_DATABASE_URL` | GitHub secrets | Limited roles `collector_role` and `fx_role`, through the session pooler |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | GitHub secrets, used only by `deploy.yml` on `main` | Let the Supabase CLI apply migrations to the production project and then deploy the web app (12.1) |
| `EMAIL_API_KEY` | Vercel server | Transactional email |
| Supabase Auth custom SMTP (host, port, user, password, sender address) | Supabase dashboard of the dev and production projects (Authentication settings); not in the repository | Required before invitations go out. Supabase's built-in mail sends only to the project team's addresses, so verification, password-reset and invitation emails would not reach participants without it. Same provider as `EMAIL_API_KEY`. |
| `NOTICE_VERSION` | Web build | Must equal `ops.settings.current_notice_version` |
| `TERMS_VERSION`, `PRIVACY_VERSION` | Web build | Must equal `ops.settings.current_terms_version` and `current_privacy_version` |
| `VENDOR_AGREEMENT_VERSION` | Web build | Must equal `ops.settings.current_vendor_agreement_version` |
| `CONTACT_EMAIL` | Web server (not secret) | The privacy contact address shown on the About page, on the vendor Account page (FR-95) and in emails. Required before the pilot opens (FR-67). The pilot value is `dunk-volts8c@icloud.com` (shared by the team). See `legal/CONTACT-ADDRESS.md`. |
| `HOSTING_REGION_LABEL` | Web server (not secret) | The text shown on the About page, `South Asia (Mumbai)`. Must match the Supabase project region (`ap-south-1`) and the Vercel function region (`bom1`, set in `vercel.json`). |
| `.env.example` | Repository | Names only, no values |

Supabase projects created since November 2025 issue publishable and secret keys; the legacy `anon` and `service_role` API keys are being retired and are not used. The `anon` and `service_role` Postgres roles (sections 4.5 and 10) are unaffected.

Vercel variables are set separately for each scope: Production uses the production Supabase project's values, and Preview uses the dev project's values only. Production keys are never given to Preview deployments.

All database connection strings (`WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL`, `COLLECTOR_DATABASE_URL`, `FX_DATABASE_URL`, and the Supabase CLI connection used by `deploy.yml`) use the Supabase session pooler. Use the pooler host shown in the project's Connect panel, port 5432, user `<role>.<project-ref>` (for example `worker_role.<project-ref>`) and `sslmode=require`. Do not use the direct host `db.<project-ref>.supabase.co`. On the free plan the direct host is reachable only over IPv6, which GitHub-hosted runners and Docker's default network do not provide, and the IPv4 add-on is a paid option outside the budget. Use session mode, not transaction mode on port 6543, so that prepared statements and session settings keep working. Values are stored only as secrets, never in the repository.

## 13. Operations

### 13.1 Monitoring

- Admin console panel (data from `/api/admin/ops`, section 6): worker status (heartbeat age, queue depth, oldest job age), last aggregate run and its audit row, number of failed jobs in 24 hours, deletion queue (profiles with `deleting = true`, ordered by `deletion_requested_at`; requests older than 5 days highlighted), and the date of the latest `ops.fx_rates` row, highlighted when more than 2 days old. That usually means GitHub has disabled the scheduled workflows after 60 days without repository activity; re-enable them in the repository's Actions tab.
- `monitor.yml` runs the deep health check (section 6) every 6 hours: worker heartbeat, queue age, deletion requests older than 5 days, the last aggregate run, and database and storage size against 80% of the free limit. A failure opens or updates a GitHub issue that mentions all three team members. GitHub's own failed-run email goes to only one person, so it is not relied on. Egress cannot be read from the database, so the SA checks it weekly on the organisation's usage page against the same 80% line.

### 13.2 Runbooks (short)

| Situation | Action |
| --- | --- |
| Worker offline | Check the host and the container (`docker compose ps`, logs). Jobs stay queued; users are offered manual entry after two minutes. Restart. If the host is lost, stolen or replaced, follow the Incident Response Plan first: rotate `WORKER_SHARED_SECRET` (Vercel and worker), the `worker_role` password and the `backup_role` password used by the backup job (13.3), and treat backups stored on that host as compromised. Then run the same image on the new host with the new values. |
| Stuck or repeatedly failing jobs | A job is attempted at most three times (errors and stalled jobs are requeued; `no_lines` is not retried), then marked failed and the user is offered manual entry. Inspect `last_error`; fix the cause; requeue by resetting status and `attempts`. |
| Storage near the limit | Check that unchosen images and old exports are being removed; lower the per-user cap (4.6); if still needed, reduce image size or move to the paid plan. |
| Deletion request pending | Confirm `deleting = true` and storage objects; rerun the delete routine (`/api/admin/users/[id]/delete`, or wait for the daily housekeeping run); the 7-day target (FR-64) is checked every 6 hours by `monitor.yml` (13.1). |
| Aggregate run failed | Read the audit row; fix and call `analytics.run_aggregation()` manually. The last good cube remains visible meanwhile. |
| Key or secret leak | Follow the Incident Response Plan. Rotate the affected key wherever it is stored (Supabase dashboard, GitHub secrets, Vercel, the worker host's environment), redeploy, and review logs. For the backup (`age`) private key, follow the plan's "Backup key lost" row. |
| Policy change | Any change to RLS or a vendor function needs a pgTAP test and the SA's review before merging. |

### 13.3 Backups and restore

A weekly job on the worker host (outside the worker container) runs `pg_dump` through a recent Supabase CLI over the session pooler connection (section 12.3), as the dedicated read-only role `backup_role` (`BACKUP_DATABASE_URL`; grants in 4.5), not with the `postgres` password. It dumps the roles, the schema and the data, and the data dump includes `auth.users`, which every `app` table references. The job encrypts the output with `age` (public key in the repository; private key held by the product owner and the SA and never stored on the worker host) and stores it on the host and in one other team member's private storage. Because `backup_role` can read every table, the host is protected as a holder of the full database, and the credential is rotated under the incident plan. Files in Supabase Storage (item images, receipt images, exports) are not in the backup; only their `storage.objects` rows are. Backups are never stored as GitHub Actions artifacts, because artifacts in a public repository are downloadable. A restore into a fresh local database is rehearsed once before the pilot opens (NFR-8), and the rehearsal checks that the roles and `auth.users` come back. Backups older than 30 days are deleted, and the Privacy Policy (sections 7 and 8) states that deleted users' data may remain in backups for up to 30 days.

A restore never brings back a deleted account. `/api/account/delete` writes the user ID and the time to `ops.deletion_log (user_id uuid, deleted_at timestamptz)`, with no foreign key and no email or other details. The housekeeping job deletes rows older than 30 days. Before a restore replaces the live database, the team copies the live `ops.deletion_log`. If the live database cannot be read, the team instead lists the deletion-confirmation emails sent since the backup (from the email provider's sent log) and runs the delete routine for those accounts before users are let back in. After the restore, and before users are let back in, the team runs the delete routine again for every user in that copy who was deleted after the backup was taken.

### 13.4 Data retention

| Data | Retention |
| --- | --- |
| User data | Until the user deletes it or the pilot ends and the team deletes it per the notice |
| Receipt-reading results (job results) | 7 days; raw scan text is never stored |
| Exports | 7 days |
| Unpublished vendor feed uploads | Until published, or 24 hours |
| Aggregate cube | Latest run only; audit rows kept for the pilot |
| Vendor reports (`ops.reports`) | The pilot period; rounded, suppressed group figures only (section 5.5) |
| Backups | 30 days |
| Deletion log (user ID and time only) | 30 days, to delete accounts again after a restore (13.3) |
| Analytics events | Until the user deletes the account or the pilot ends; pseudonymous |
| Daily sign-up and deletion counts (`ops.daily_counts`) | Pilot period; no user ID |
| Vendor query log | The pilot period |
| Vendor portal accounts, agreement acceptances and usage events | The pilot period; deleted by `/api/admin/pilot/end` |
| Invitation list (`ops.invitations`) | Until the person leaves the pilot or the pilot ends; unused invitations are deleted when the pilot ends |
| Admin audit log | The pilot period |

## 14. Build order

Aligned with the BRD timeline.

| Step | Weeks | Deliverables |
| --- | --- | --- |
| M1 Foundations | 1-2 | Repository, CI, local Supabase, migrations for lookups, colour functions, core tables, RLS and storage policies, pgTAP for RLS; auth, `proxy.ts` gating and the acceptance, pilot notice and onboarding pages; wardrobe list and item form with manual entry and the colour picker; seed taxonomy; first collector run. |
| M2 Wardrobe breadth | 3-4 | Catalogue search and picker, filters, collections and tags, condition, archive, purchases, wishlist, export and delete routes. Start pilot recruitment. |
| M3 Images and receipts | 4-5 | Job table and claim, worker container, photo handler, receipt handler and draft UI, heartbeat. |
| M4 Outfits | 5-6 | Rule engine and tests, builder, suggestions, calendar, optional log. |
| M5 Vendor side | 5-6 | Aggregation run, cube, suppression, vendor functions and tests, dashboard, gaps, condition spectrum, report, vendor invite, feed validation and publish. |
| M6 Hardening and pilot open | 6 | End-to-end and accessibility passes, restore rehearsal, load check at 500 users, a check that sign-up verification, password reset and export emails reach an invited address outside the team, a walkthrough of the legal pack with the final contact address, supported countries and invitation list in place, and an incident-plan practice run (`legal`). |
| Pilot | 7-12 | Operate, fix, measure, vendor review. |

Aggregation (M5) depends on enough test data from the earlier milestones; synthetic data generated by the seed scripts is used for tests only and is never loaded into production.

## 15. Traceability

| FDD requirements | Implemented in |
| --- | --- |
| FR-1 to FR-9 (account, notice, onboarding, invitations, supported countries) | 4.4 `profiles`, `consent_records`; 4.5; 4.9; 6 (`/api/admin/invitations`); 9.1 |
| FR-10 to FR-17 (wardrobe) | 4.4 `items`; 4.7; 6 (`items`); 9.2; 9.4 `FilterBar` |
| FR-18 to FR-20 (condition) | 4.2 `lk_condition_band`; 4.4; 9.4 `ConditionSlider`; 5.4 |
| FR-21 to FR-29a (adding items, colour) | 4.3; 7.3; 8.1; 9.4 `ItemForm`, `ColourPicker` |
| FR-30 to FR-36 (purchases, wishlist) | 4.4 tables; 9.4 |
| FR-40 to FR-47 (receipts, redaction) | 7.4; 9.4 `ReceiptFlow`; 4.6; 13.4 |
| FR-50 to FR-57 (outfits) | 4.4; 9.4; 9.5 |
| FR-60 to FR-69 (settings, data rights, Leave the pilot, About page, Terms acceptance, end of the pilot) | 6 (`delete`, `export`); 7.5; 13.4; 9.1; 9.4; 4.9 `document_acceptances`; 12.3 `CONTACT_EMAIL`; FR-69: 4.9 `ops.settings` keys, 6 (`/api/admin/pilot/end`, housekeeping step 5), 9.4 end-of-pilot banner |
| FR-70 to FR-79 (vendor portal) | 5.4; 5.5; 9.4 `vendor/*` |
| FR-80 to FR-88 (aggregation rules, query log and rate limit) | 5.1 to 5.3; 5.6; 5.7 |
| FR-90 to FR-95 (feed, vendor agreement, vendor contact address) | 6; 8.2; 4.8; 4.9; 5.4; 9.1 |
| FR-100 to FR-104 (catalogue management) | 4.8; 6; 8.1 |
| NFR-1 to NFR-8 | 9.3; 11; 12; 13 |

## 16. Refinements to and departures from the HLD

For the SA to confirm.

| ID | Point | LLD decision | Reason |
| --- | --- | --- | --- |
| LD-1 | HLD 7 (earlier wording): vendors have "no privileges" on `app` or `analytics_private`. | All roles share the Postgres role `authenticated`. Isolation uses RLS role checks, unexposed schemas, no grants and role checks inside vendor functions (section 10). | Supabase issues the same database role to every signed-in user. |
| LD-2 | HLD 4 (earlier wording): web server functions call the worker. | The worker polls the `jobs` table; the web app never calls it. | Matches the self-hosted decision; no inbound access. The HLD now describes polling throughout. |
| LD-3 | HLD 4 and 7 (earlier wording): the worker uses a "scoped key" (a "worker-only key" limited to the jobs table and buckets). | Worker uses a limited Postgres role plus signed URLs from a Vercel route; the Supabase secret key stays on Vercel. The host also holds the read-only `backup_role` login for the weekly backup (13.3). | Supabase offers no scoped storage key; this keeps the powerful key off a personal machine; the backup login can read but not change data. |
| LD-4 | HLD 5.4: aggregates in tables with k and rounding. | A cube restricted to a fixed set of grouping sets with one filter at most, plus complementary suppression. | Limits differencing attacks while keeping the dashboard flexible. |
| LD-5 | HLD 8 (earlier wording): weekly backup to a private storage location. | Encrypted backups taken on the worker host (outside the worker container, with the read-only `backup_role`, 13.3) and kept there and in one other private location; never as workflow artifacts. | Artifacts in a public repository are downloadable. |
| LD-6 | HLD 4: outfit logic in the web app. | Kept, as a separate package with data-driven rules. | Lets the style specialist edit rules without code changes. |
| LD-7 | New: legal controls (invitation-only sign-up through a Supabase Auth Before User Created hook, country allow-list, acceptance records, receipt redaction, vendor query log and agreement acceptance). | Added in sections 4.9, 5.7, 7.4, 9.1 and 10 after the legal and privacy review (`legal/LEGAL-REVIEW.md`). | Needed for the pilot's risk position. |

## 17. Open items

| ID | Item | Owner |
| --- | --- | --- |
| LOI-1 | Confirm LD-1 to LD-7. | C. Prashanth |
| LOI-2 | Tune the colour family reference swatches against real items and check the nearest-match results with test colours. | Arpan Shah |
| LOI-3 | Choose the `rembg` model (`u2netp` or `isnet-general-use`) after trying both on the worker host. Before release, record the licences of the chosen `rembg` model and the PaddleOCR detection and recognition models, and confirm each allows use and redistribution alongside the GPL-3.0 code (Legal Review finding 17). | C. Prashanth |
| LOI-4 | Confirm the aggregation grouping sets, price bands and region mapping before the first vendor demo. | Product owner and SA |
| LOI-5 | Choose the transactional email provider, verify its free quota and hosting region, set it up as custom SMTP in Supabase Auth for the dev and production projects (12.3), and add its name and region to Privacy Policy section 6 and the Privacy Risk Assessment 'Where' row, all before the first invitation is sent. | Delivery team |
| LOI-6 | Confirm the service worker library and offline write scope (9.3) after a first prototype. | C. Prashanth |
| LOI-7 | Confirm the backup private key holders named in 13.3 (product owner and SA), and name the team member and the private storage that hold the second backup copy; then name that provider and its country in Privacy Policy section 6 and the PRA 'Where' row before the pilot opens. | Product owner |
| LOI-8 | Test on the dev project that the Before User Created hook refuses an uninvited address for both email sign-up and Google sign-in, with the FR-8 message shown in the app; that it admits an invited address; and that the access-token hook still issues tokens carrying the role. | C. Prashanth |
