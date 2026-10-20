# Sparta: Low-Level Design (LLD)

| Field | Value |
| --- | --- |
| Document | Low-Level Design |
| Version | 1.1 (final; amended after the legal and privacy review) |
| Date | 2026-10-20 |
| Author | Business analyst (drafted for the product owner) |
| Reviewer | C. Prashanth (Solution Architect) |
| Approver | Ambarish Sengupta (Product Owner) |
| Traces to | BRD v1.1, FDD v1.2, HLD v1.1; legal pack in `docs/legal` |
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
| Web | Next.js (App Router), React, Tailwind CSS, shadcn/ui, TanStack Query, react-hook-form with zod, Recharts, next-intl, a service worker library for the PWA (for example Serwist). |
| Database | Supabase Postgres 15 or later. Extensions: `pgcrypto`, `pg_cron`, `pg_trgm`. |
| Naming | Tables and columns in `snake_case`; IDs are `uuid` (default `gen_random_uuid()`) except job and run IDs, which are `bigint` identities. |
| Time | `timestamptz` everywhere, UTC. Dates the user picks (purchase date, plan date) are `date`. |
| Money | `numeric(12,2)` plus an ISO 4217 `char(3)` currency on every amount. |
| Migrations | One SQL file per change in `supabase/migrations`, applied by the Supabase CLI. No manual changes in the dashboard. |
| Types | `supabase gen types typescript` run in CI; the build fails if the generated file is stale. |
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
      (consumer)/            wardrobe, outfits, wishlist, purchases, me
      (vendor)/              dashboard, gaps, reports, feed
      (admin)/               vendors, sources, runs, deletions, worker status
      api/                   route handlers (section 6)
    components/              ui/ (shadcn), wardrobe/, outfits/, vendor/, shared/
    lib/
      supabase/              browser.ts, server.ts, middleware.ts
      colour/                convert.ts, family.ts, picker adapters
      season.ts
      i18n/                  messages/en.json
    middleware.ts            auth, role and consent gating
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
  .github/workflows/         ci.yml, deploy.yml, collect.yml, fx.yml, keepalive.yml
  docs/
```

Rule: anything that must agree across the web app, worker, collector and feed validator (taxonomy values, colour families, size systems) lives in `packages/taxonomy` and is loaded into the database by a seed migration, not retyped.

## 4. Database design

### 4.1 Schemas and exposure

| Schema | Purpose | Exposed through the Supabase API |
| --- | --- | --- |
| `app` | Per-user data | Yes, protected by RLS |
| `catalog` | Taxonomy lookups, catalogue, vendors, sources | Yes, read access by policy |
| `analytics` | Vendor-facing aggregate tables and functions | Functions only; tables have no grants |
| `analytics_private` | Anonymised fact table | **No** (not in the exposed schemas list) |
| `ops` | Settings, runs, audit, FX rates, worker heartbeat | No |

### 4.2 Lookup tables (`catalog`)

One small table per taxonomy list, all with `code text primary key`, `label text`, `sort int` and `active boolean`: `lk_category`, `lk_sub_type` (adds `category` FK), `lk_colour_family`, `lk_fit`, `lk_material`, `lk_pattern`, `lk_season`, `lk_occasion`, `lk_size_system`, `lk_condition_band` (adds `min_score`, `max_score`), `lk_price_band`, `lk_region`, `country_region(country char(2) primary key, region text)`.

Application tables reference these with foreign keys, so invalid values cannot be stored.

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
-- Black 000000; White FFFFFF; Grey 808080, A9A9A9, 4D4D4D; Navy 1F2A44; Blue 1E5AA8, 6FA8DC;
-- Teal 008080; Green 2E8B57; Olive 6B6B2F; Khaki C3B091; Beige E8DCC2, D9C7A0;
-- Brown 5C4033, 8B5A2B; Maroon 800000, 7B1E3A, 5A1F2E; Red D62828; Orange F28C28; Yellow F7D038, F0E68C;
-- Pink F4A6C0; Purple 6A3D9A.
-- "Multi" has no swatch: it is assigned only when is_multicolour is true.

create function catalog.srgb_lin(c float8) returns float8 language sql immutable as $$
  select case when c <= 0.04045 then c/12.92 else power((c+0.055)/1.055, 2.4) end $$;

create function catalog.rgb_to_lab(r int, g int, b int) returns float8[]
language plpgsql immutable as $$
declare rl float8 := catalog.srgb_lin(r/255.0); gl float8 := catalog.srgb_lin(g/255.0); bl float8 := catalog.srgb_lin(b/255.0);
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

create function catalog.colour_family(r int, g int, b int) returns text
language sql stable as $$
  with q as (select catalog.rgb_to_lab(r, g, b) as lab)
  select c.family from catalog.colour_family_ref c, q
  order by power(c.l - q.lab[1], 2) + power(c.a - q.lab[2], 2) + power(c.b - q.lab[3], 2)
  limit 1 $$;
```

The distance is the CIE76 colour difference. Several swatches per family (for example light and dark grey) make the nearest-match regions closer to how people name colours. A first check of the draft swatches against 18 test colours matched the expected family in all cases except burgundy `#7B1E3A`, which fell into Brown until two more Maroon swatches were added (already reflected above); the golden vectors in section 11 keep this from regressing.

Every table with colours (`app.items`, `app.wishlist_entries`, `catalog.catalog_items`) has `colour_r`, `colour_g`, `colour_b` (`smallint`, 0 to 255), `colour_hex`, `colour_family`, `is_multicolour`, and for items a secondary set. A `before insert or update` trigger `catalog.set_colour_fields()`:

- recomputes `colour_hex` from RGB;
- sets `colour_family = 'Multi'` when `is_multicolour`, otherwise `catalog.colour_family(r, g, b)`;
- does the same for the secondary colour.

Clients cannot set `colour_family` directly: a column privilege revokes `update` on it from `authenticated`, and the trigger overwrites any supplied value.

### 4.4 Core tables (`app`)

Columns shown are the design. Common to all: `id`, `created_at`, and `updated_at` where users edit rows (kept by a trigger).

```sql
create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'consumer' check (role in ('consumer','vendor','admin')),
  display_name text, country char(2), hemisphere text check (hemisphere in ('north','south')),
  currency char(3) not null default 'USD',
  age_confirmed boolean not null default false,
  deleting boolean not null default false,
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
  sub_type text not null,                      -- composite FK to (category, code)
  colour_r smallint not null check (colour_r between 0 and 255), colour_g smallint not null check (colour_g between 0 and 255),
  colour_b smallint not null check (colour_b between 0 and 255),
  colour_hex char(7), colour_family text, is_multicolour boolean not null default false,
  colour2_r smallint, colour2_g smallint, colour2_b smallint, colour2_hex char(7), colour2_family text,
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
  image_path text, image_original_path text,
  origin text not null check (origin in ('catalogue','manual','photo','receipt','vendor_feed')),
  status text not null default 'active' check (status in ('active','archived')),
  archive_reason text check (archive_reason in ('sold','donated','discarded','lost')),
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```

Other tables, all with `user_id` referencing `app.profiles` `on delete cascade` and the owner-only RLS policy in 4.5:

| Table | Key columns |
| --- | --- |
| `purchases` | `item_id` (cascade), `purchase_date`, `store`, `price`, `currency`, `quantity`, `notes` |
| `receipts` | `storage_path`, `store`, `receipt_date`, `currency`, `total`, `created_at` |
| `purchase_receipts` | `purchase_id`, `receipt_id` (primary key on both) |
| `wishlist_entries` | `catalog_item_id` (nullable), copy of attributes (`name`, `category`, `sub_type`, colour fields, `fit`, `brand`, `size_value`, seasons), `target_price`, `currency`, `priority` (`low`,`medium`,`high`), `planned_month`, `budget`, `notes`, `status` (`open`,`bought`) |
| `collections`, `item_collections` | user collections and the many-to-many link |
| `tags`, `item_tags` | free tags and the link |
| `outfits` | `name`, `occasions[]`, `seasons[]`, `notes`, `needs_attention` |
| `outfit_items` | `outfit_id`, `item_id`, `slot` (`top`,`bottom`,`layer`,`footwear`,`accessory`) |
| `outfit_plans` | `outfit_id`, `plan_date`, `label` |
| `outfit_logs` | `outfit_id`, `logged_on`; never read by any aggregate or counter |
| `suggestion_feedback` | `occasion`, `rule_ids[]`, `accepted` (for rule tuning; no item IDs) |
| `jobs` | section 7.2 |
| `analytics_events` | `event`, `props jsonb` (no free text), `created_at` |

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

create function app.has_consent(p_user uuid default null) returns boolean
language sql stable security definer set search_path = app, ops as $$
  select exists (
    select 1 from app.consent_records c
    where c.user_id = coalesce(p_user, (select auth.uid()))
      and c.notice_version = (select value from ops.settings where key = 'current_notice_version')) $$;
```

Policy pattern for every owner table (`items` shown); `(select auth.uid())` keeps the call evaluated once per query:

```sql
alter table app.items enable row level security;
alter table app.items force row level security;

create policy items_owner on app.items for all to authenticated
  using      (user_id = (select auth.uid()) and app.current_role() = 'consumer' and app.has_consent())
  with check (user_id = (select auth.uid()) and app.current_role() = 'consumer' and app.has_consent());
```

Other policies:

| Table | Policy |
| --- | --- |
| `app.profiles` | Select and update own row (cannot change `role`; column privilege). Insert by the sign-up trigger only. |
| `app.consent_records` | Insert and select own rows with no consent gate (a user must be able to accept). No update, no delete (deletion is by cascade). |
| `catalog.catalog_items` | `select` for `authenticated` consumers with consent, where `status = 'active'`. Vendors and admins manage their own rows through server routes only. |
| `catalog.lk_*` | `select` for `authenticated`; no writes. |
| `catalog.sources`, `ops.*` | No policies, no grants; reached only by the service role in server routes or by admin-only functions. |
| `analytics`, `analytics_private` | No grants. Vendors call `security definer` functions. |

Sign-up trigger `app.handle_new_user()` on `auth.users` inserts a `profiles` row with role `consumer`. Vendor and admin accounts are created by the server route in section 6 with role set explicitly, and a vendor cannot become a consumer or the reverse.

### 4.6 Storage

Private buckets `item-images`, `receipts`, `exports`. Object path `{user_id}/{uuid}.{ext}`.

```sql
create policy "own folder read"  on storage.objects for select to authenticated
  using (bucket_id in ('item-images','receipts','exports')
         and (storage.foldername(name))[1] = (select auth.uid())::text and app.has_consent());
create policy "own folder write" on storage.objects for insert to authenticated
  with check (bucket_id in ('item-images','receipts')
         and (storage.foldername(name))[1] = (select auth.uid())::text and app.has_consent());
-- no update or delete policy for users; deletion goes through the delete-account route and item deletion route
```

Limits set on the buckets: images 5 MB, receipts 8 MB, allowed types `image/jpeg`, `image/png`, `image/webp`, and `application/pdf` for receipts only.

### 4.7 Indexes

| Index | Reason |
| --- | --- |
| `items (user_id, status, created_at desc)` | Default wardrobe list |
| `items (user_id, category, colour_family)` | Common filters |
| `items (user_id) where is_never_worn` | "Never worn" filter |
| GIN on `items (seasons)`, `items (occasions)` | Array filters |
| `purchases (user_id, purchase_date desc)` | Purchases list |
| `wishlist_entries (user_id, status)` | Wishlist |
| `catalog_items` GIN `gin_trgm_ops` on `name` and `brand`; btree on `(category, colour_family)` | Catalogue search |
| `jobs (status, run_after, id)` partial where `status = 'queued'` | Job claim |
| `analytics_events (event, created_at)` | Pilot measures |

### 4.8 Catalogue and vendor tables (`catalog`)

```sql
create table catalog.sources (
  id serial primary key, name text not null, site_url text not null,
  robots_allowed boolean not null, terms_note text not null, allowed boolean not null default false,
  checked_on date not null, contact text, last_collected_at timestamptz
);
create table catalog.vendors (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table catalog.vendor_members (vendor_id uuid references catalog.vendors(id) on delete cascade,
  user_id uuid references app.profiles(id) on delete cascade, primary key (vendor_id, user_id));
create table catalog.catalog_items (
  id uuid primary key default gen_random_uuid(),
  source_id int references catalog.sources(id) on delete cascade,
  vendor_id uuid references catalog.vendors(id) on delete cascade,
  sku text not null, name text not null, brand text,
  category text not null, sub_type text not null,
  colour_r smallint, colour_g smallint, colour_b smallint, colour_hex char(7), colour_family text, secondary_colour_hex char(7),
  fit text, material text, pattern text, sizes_available text[],
  price numeric(12,2), currency char(3), seasons text[], occasions text[],
  product_url text not null, collected_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','review','withdrawn')),
  check ((source_id is not null) <> (vendor_id is not null)),
  unique nulls not distinct (source_id, vendor_id, sku)
);
```

Removing a source (`delete from catalog.sources`) removes all its items in one action (FR-103).

### 4.9 Invitations, supported countries and acceptances

These tables implement the legal controls from the legal and privacy review (`docs/legal/LEGAL-REVIEW.md`).

```sql
create table ops.invitations (
  email text primary key check (email = lower(email)),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  note text
);

-- ops.settings keys added: current_terms_version, current_privacy_version,
-- supported_countries (comma-separated ISO codes, initially 'IN')

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

- **Invitation-only sign-up (FR-8).** `app.handle_new_user()` (section 4.5) raises the exception `not_invited` unless `lower(new.email)` is in `ops.invitations`, and then sets `accepted_at`. Because it is a trigger on `auth.users`, it blocks both email sign-up and Google sign-in for uninvited addresses. Vendor and admin invitations created through the server route are added to the list automatically. The admin manages the list through `/api/admin/invitations` (section 6).
- **Onboarding (FR-9).** The RPC `app.complete_onboarding(country, hemisphere, currency, age_confirmed)` stores the profile fields and raises `unsupported_country` if the country is not in `supported_countries`.
- **Eligibility.** `app.has_consent()` (section 4.5) is extended to require, for the current user: the pilot notice accepted at the current version; the Terms and Privacy Policy accepted at their current versions (`app.document_acceptances`); `age_confirmed`; and a `profiles.country` in `supported_countries`. The function name is kept so existing policies still apply; its meaning is "eligible participant". A user who fails it can read only their own profile, consent records and acceptances, and can still use the export and delete routes, which run on the server. The aggregation job's eligibility test (section 5.1, step 3) uses the same function.
- **Vendor agreement (FR-94).** A vendor member inserts a row into `catalog.vendor_agreement_acceptances` through an RLS policy limited to their own vendor and user. The vendor functions in section 5.4 refuse the call unless the caller has accepted the current agreement version (`ops.settings.current_vendor_agreement_version`).

## 5. Aggregation and vendor functions

### 5.1 Run: `analytics.run_aggregation()`

A `security definer` function owned by a privileged role, scheduled with `pg_cron` at 02:30 UTC. One run does:

1. Insert an `ops.aggregate_runs` row (start time) and take an advisory lock, so two runs cannot overlap.
2. Pick a random salt in memory only (`encode(gen_random_bytes(16),'hex')`); it is never stored.
3. Truncate `analytics_private.facts` and rebuild it from three sources, each limited to **eligible users**: `role = 'consumer'`, `deleting = false`, and `app.has_consent(user_id)`:
   - `owned`: active items; period is the current month.
   - `wishlist`: wishlist entries with status `open`; period is the month created.
   - `purchase`: purchases; period is the purchase month.
4. Each fact row holds: `user_hash` (`encode(digest(user_id::text || salt, 'sha256'), 'hex')`), `kind`, `period`, `category`, `sub_type`, `colour_family`, `fit`, `brand` (normalised), `size_value`, `season`, `price_band`, `condition_band` (owned only), `region`. No names, emails, images, receipts, notes or outfit logs.
   - `price_band` is computed from the price converted to USD with the latest `ops.fx_rates`, then bucketed (below 25, 25 to 50, 50 to 100, 100 to 200, 200 and above).
   - `region` is `catalog.country_region` for the user's country, or `Unknown`.
   - `season` takes the first listed season of the item, or `All year`.
5. Build the cube (5.2), apply suppression (5.3) and publish to `analytics.cube`.
6. Write the audit row: users included, items included, rows suppressed, duration, success or error.

### 5.2 The cube

`analytics.cube` columns: `run_id`, `kind`, `period`, `d_category`, `d_colour_family`, `d_fit`, `d_brand`, `f_size`, `f_season`, `f_price_band`, `f_region` (all nullable, a null meaning "all"), `condition_band` (nullable, used only for the condition spectrum), `users` (distinct `user_hash`), `events` (rows), `users_rounded`, `events_rounded`.

Grouping sets, generated programmatically in the function: for each dimension group `D` in {`category`}, {`colour_family`}, {`fit`}, {`brand`}, {`category, colour_family`}, {`category, fit`}, {`category, brand`}, and each filter `F` in {none, `size`, `season`, `price_band`, `region`}, one grouping set `D plus F`. At most one filter applies at once (FR-77). A separate pass builds the condition spectrum per `category` with `condition_band`.

```sql
insert into analytics.cube_stage (...)
select kind, period, category, colour_family, fit, brand, size_value, season, price_band, region,
       count(distinct user_hash), count(*)
from analytics_private.facts
group by kind, period, grouping sets (<generated list>);
```

### 5.3 Suppression and rounding

1. **Minimum group size.** Delete rows with `users < ops.settings('min_group_size')` (value 10 in the pilot, 50 in production).
2. **Complementary suppression.** For each parent group (same `kind`, `period`, dimension group, filter dimension), if exactly one child (a filter value) was suppressed, also suppress the smallest remaining child, so that the hidden value cannot be recovered by subtracting from the parent.
3. **Rounding.** Set `users_rounded = round(users / 5.0) * 5` and `events_rounded` likewise. Raw `users` and `events` are dropped before publishing: `analytics.cube` stores only the rounded values.
4. **No zero reveal.** A row that rounds to 0 after step 3 is deleted.

### 5.4 Vendor functions

All are `security definer`, in schema `analytics`, with `search_path` fixed, executable only by `authenticated`, and begin with `if app.current_role() <> 'vendor' then raise exception 'forbidden'; end if;`. Each has a hard-coded whitelist of dimension and filter names; the values are passed as parameters and never interpolated into SQL. After the role check each function also verifies that the vendor user has accepted the current Vendor Pilot Agreement version, then calls `analytics.log_and_limit` (section 5.7).

| Function | Returns | Used by |
| --- | --- | --- |
| `analytics.ownership_mix(dim text, filter_dim text default null, filter_value text default null)` | segment, `users_rounded` | FR-72 |
| `analytics.trend(kind text, dim text, period_unit text default 'month', filter_dim text default null, filter_value text default null)` | period, segment, `events_rounded` | FR-73, FR-74 |
| `analytics.gaps(dim text, filter_dim text default null, filter_value text default null, top_n int default 20)` | segment, `owner_users_rounded`, `wishlist_users_rounded`, `gap_score` | FR-75 |
| `analytics.condition_spectrum(category text)` | band, share | FR-76 |
| `analytics.filter_options()` | the filter values that currently have visible rows | FR-77 |
| `analytics.coverage()` | rounded user count of the cohort, last run time | Dashboard header |
| `analytics.reports()` / `analytics.report(id)` | reviewed report metadata and content | FR-78 |

`gaps`: for a segment, `gap_score = wishlist_users / nullif(owner_users, 0)`. Both counts come from rows that passed section 5.3. If the `owned` row is missing or suppressed the function returns the segment with `gap_score` null and the label "no visible ownership" and only if the wishlist row passed. It never computes a score from a suppressed value.

`condition_spectrum`: share of owned items in each band within the category, rounded to the nearest 5 percentage points, shown only when the category row passes section 5.3.

A pgTAP test (section 11) calls every function as a vendor and as a consumer, and checks that it never returns a row with fewer than the threshold users.

### 5.5 Reports

A report is a stored snapshot: `ops.reports (id, period, generated_at, reviewed_by, reviewed_at, payload jsonb)`. The admin generates one on demand (FR-79) from the same functions' results; vendors can read only rows where `reviewed_at is not null`.

### 5.6 Deletion exclusion and re-runs

Deleted users disappear from `app` by cascade, so the next nightly rebuild excludes them. Facts are rebuilt from scratch each run, so no earlier run's data is retained in `analytics_private`. The published cube is replaced each run; only the audit row is kept (FR-64, FR-86).

### 5.7 Vendor query log and rate limit

```sql
create table ops.vendor_query_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  fn text not null,
  params jsonb,
  called_at timestamptz not null default now()
);

create function analytics.log_and_limit(p_fn text, p_params jsonb) returns void
language plpgsql security definer set search_path = analytics, ops as $$
begin
  if (select count(*) from ops.vendor_query_log
      where user_id = (select auth.uid()) and called_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;
  insert into ops.vendor_query_log (user_id, fn, params) values ((select auth.uid()), p_fn, p_params);
end $$;
```

Every function in section 5.4 calls `analytics.log_and_limit` straight after its role and agreement checks (FR-88). Refused calls are rolled back with the transaction, so the log shows the 200 calls that preceded them. The admin console lists the log by vendor and function. Parameters never contain participant data, only dimension names and filter values. The log is deleted when the pilot ends.

## 6. Server routes (Next.js route handlers)

Routes that need a secret use the service role key, which exists only in Vercel's server environment. Every route first verifies the caller's session and role.

| Route | Method | Caller | What it does |
| --- | --- | --- | --- |
| `/api/account/delete` | POST | Consumer | Re-authenticates (password or fresh OAuth), sets `deleting = true`, deletes the user's storage objects (`item-images`, `receipts`, `exports`), then deletes the `auth.users` row (cascade removes all `app` rows). Returns when complete and sends the confirmation email. On failure the flag stays set and the housekeeping job retries. |
| `/api/account/export` | POST | Consumer | Inserts a `jobs` row of type `export`. |
| `/api/exports/[id]` | GET | Consumer | Returns a short-lived signed URL for the user's own export. |
| `/api/admin/vendors/invite` | POST | Admin | Creates the vendor row and the invited auth user with role `vendor`, adds the membership, sends the invitation. |
| `/api/admin/invitations` | POST, DELETE | Admin | Adds or removes emails on the invitation list (`ops.invitations`), one at a time or from a pasted list. |
| `/api/vendor/feed/validate` | POST | Vendor | Parses a CSV or JSON upload and validates each row (section 8.2); returns row errors and a preview; stores the validated rows in a temporary table keyed by an upload ID. |
| `/api/vendor/feed/publish` | POST | Vendor | Upserts the validated rows as `catalog.catalog_items` owned by the vendor; supports withdraw. |
| `/api/admin/reports/generate` | POST | Admin | Builds a report snapshot. |
| `/api/admin/reports/[id]/review` | POST | Admin | Marks a report reviewed. |
| `/api/worker/signed-urls` | POST | Worker | Authenticated by a signed bearer token (HMAC with `WORKER_SHARED_SECRET`, timestamp checked). Given a job ID in status `running`, returns a signed download URL for each input object and signed upload URLs for each expected output path. Rejects any path outside the job's owner folder. |
| `/api/health` | GET | Uptime ping | Checks the database and returns the last aggregate run time. |

Errors use a consistent JSON shape `{ "error": { "code": "...", "message": "..." } }`; no stack traces or SQL text leave the server.

## 7. Worker

### 7.1 Runtime

A Python 3.11 container with a FastAPI app. It exposes only `/health` on the container's local interface (not published); its work is a background loop.

| Component | Detail |
| --- | --- |
| Database access | A direct pooled connection using a dedicated Postgres role `worker_role`. Privileges: `select`, `update` on `app.jobs`; `select` on the `catalog` lookups and `catalog_items` (for receipt matching); `insert`/`update` on `app.job_results` and `ops.worker_heartbeat`. It cannot read any other user table. |
| Storage access | Through the signed URLs from `/api/worker/signed-urls`. The service role key is never on the worker machine. |
| Concurrency | One job at a time. Background removal and OCR are memory heavy. |
| Memory | About 2 GB; model files are loaded once at start and kept. |
| Restart | `restart: always` in `compose.yaml`; models pre-downloaded in the image build. |

### 7.2 Job table and claim

```sql
create table app.jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.profiles(id) on delete cascade,
  type text not null check (type in ('photo','receipt','export')),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  input jsonb not null,                 -- storage paths, options
  result jsonb,                         -- draft lines, output paths
  attempts int not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
```

Users can insert jobs for themselves and read their own job rows (RLS, status `queued` only on insert, input paths checked to start with their own user ID). The worker claims one job:

```sql
update app.jobs set status = 'running', started_at = now(), attempts = attempts + 1
where id = (select id from app.jobs
            where status = 'queued' and run_after <= now()
            order by id
            for update skip locked limit 1)
returning id, user_id, type, input;
```

A reaper query, run by `pg_cron` every minute, resets jobs stuck in `running` for more than five minutes to `queued` (with `run_after = now() + interval '30 seconds'`) if `attempts < 3`, or to `failed` otherwise.

The worker polls every 3 seconds when idle, and immediately again after finishing a job. A user's browser follows its job via a Supabase Realtime subscription on its own job row, with a fallback poll every 5 seconds.

### 7.3 Photo handler

1. Get signed URLs (7.1) and download the original.
2. Validate the file (type by content, not extension; maximum 5 MB; maximum 6,000 pixels on the long side).
3. Remove the background with `rembg` (model `u2netp` for lower memory; `isnet-general-use` if quality needs it).
4. Resize to at most 1,200 pixels on the long side; save as WebP quality 80 with transparency.
5. Estimate the dominant colour: downsample, drop transparent pixels, k-means with k = 3, choose the largest cluster that is not near-white background; return RGB.
6. Upload the cut-out to the signed upload URL and write `result = { "path": "...", "dominant_rgb": [r,g,b] }`.
7. Delete temporary files. Status `done`.

### 7.4 Receipt handler

1. Download the image (or the first page of a PDF, rendered with `pdf2image`).
2. Preprocess: auto-rotate, deskew, grayscale, contrast normalise.
3. OCR with PaddleOCR (English, text-line detection and recognition), producing lines with bounding boxes and confidence.
4. Parse (rules in `parse/`):

| Field | Method |
| --- | --- |
| Store | Highest-confidence text in the top region that is not a date, address or phone number. |
| Date | Regular expressions for `dd/mm/yyyy`, `dd-mm-yy`, `d Mon yyyy`, `Mon d, yyyy`; pick the first date near the top. |
| Currency | Symbol or code near totals (`$`, `£`, `€`, `₹`, `Rs`, ISO codes); default to the user's profile currency. |
| Line items | A line whose last token is an amount (`\d+[.,]\d{2}`), with an optional quantity prefix (`2 x`, `2@`) or a quantity column. The text before the amount is the description. |
| Skipped lines | Keywords such as subtotal, total, tax, GST, VAT, change, cash, card, discount, thank you; and lines with no letters. |
| Clothing guess | Description keywords mapped to categories and sub-types (for example `tee`, `shirt`, `jeans`, `chino`, `sneaker`). Lines with no match are marked `unknown` and pre-skipped (FR-43). |
| Catalogue match | `pg_trgm` similarity of the description to `catalog_items.name` and brand; return the top three with scores above 0.4. |

5. Write `result` as JSON: `{ store, date, currency, lines: [{ text, qty, amount, guess: {category, sub_type}, matches: [...], confidence, skip }], overall_confidence }`. If no lines were found, set status `failed` with `last_error = 'no_lines'` so the app shows the manual entry fallback (FR-45).
6. Delete temporary files. The raw text from the scan is kept only in memory and is never stored. The job result (the draft lines) is cleared after **7 days** by a `pg_cron` job.

**Redaction (FR-47).** Before the result is written the worker masks the following in every line and in the store name: card-like numbers (13 to 19 digits, with spaces or dashes, replaced by `[card]`); email addresses (`[email]`); phone numbers (`[phone]`); and numbers that follow words such as member, loyalty, rewards, account or customer (`[id]`). Lines that look like street addresses or postcodes are dropped. Only the store name, date, currency and item lines are kept. Redaction runs before catalogue matching, so masked text is never compared against the database.

### 7.5 Export handler

Builds a zip in a temporary directory: one JSON file per table of the user's rows, the user's images and receipts (downloaded through signed URLs), a `README` explaining the files. Uploads to the `exports` bucket, writes the path to the job result, and the web app emails and shows a signed link. Exports expire after 7 days.

### 7.6 Heartbeat

Every 60 seconds the worker upserts `ops.worker_heartbeat(worker_id, seen_at, queue_depth, oldest_queued_age, version)`. The admin console shows the worker as offline if `seen_at` is older than five minutes.

## 8. Collector and feed validation

### 8.1 Collector (`jobs/collector`)

Run on GitHub Actions on a schedule (weekly during the pilot) and on demand.

1. Read allowed sources from `catalog.sources` where `allowed` is true.
2. For each source: fetch and parse `robots.txt` (`urllib.robotparser`); skip any URL it disallows; stop if the check fails.
3. Request pages at most once every 2 seconds, with the user agent `SpartaPilotBot/0.1 (+<repository URL>)`, honouring `Retry-After` and backing off on errors.
4. Extract only product attributes: name, brand, category hints, colour, sizes, price, currency, product URL. Prefer structured data (JSON-LD `Product` markup, sitemaps). No product images are downloaded or stored.
5. Map to the taxonomy through the mapping tables in `jobs/collector/mapping` (category and sub-type keywords, colour names to RGB through a table of CSS colour names and common retail names, falling back to hex codes). Anything unmapped is stored with `status = 'review'`.
6. Upsert on `(source_id, sku)`; rows missing from a later run are marked `withdrawn` after two runs without them.
7. Database access through a limited role `collector_role` (insert and update on `catalog.catalog_items`, read on `catalog.sources` and lookups).

### 8.2 Feed validation

Rules for each row (CSV or JSON), implemented once in `packages/taxonomy` and called by the route:

- Required fields present (`sku`, `name`, `brand`, `category`, `sub_type`, `primary_colour`, `price`, `currency`, `product_url`).
- `category` and `sub_type` in the taxonomy; `sub_type` belongs to the category.
- `primary_colour` is a valid hex code or a known colour name; if a name, it is mapped to RGB.
- `price` is a positive number; `currency` is a valid ISO 4217 code.
- `product_url` and `image_url` are well-formed `https` URLs. `image_url` is accepted but not fetched or stored.
- `sku` is unique within the file and the vendor.
- Maximum 5,000 rows and 5 MB per upload.

Errors are returned per row and column. Nothing is written until the vendor confirms (FR-91).

## 9. Web application

### 9.1 Access control in the app

`middleware.ts` runs on every request:

1. No session: redirect to sign-in (public routes excepted).
2. Session with role `consumer` and no consent record for the current notice version: redirect to `/pilot-notice` (the blocking pop-up page); everything else is blocked (FR-3, FR-4).
3. Role mismatch (for example a vendor opening a consumer route): redirect to the role's home.

The pilot notice page writes the consent record through the browser client (the insert is allowed by its policy) and records the notice version from a constant shipped with the app and equal to `ops.settings.current_notice_version`. If they differ, the insert is rejected by a check in the policy, and the app shows an error asking the user to reload.

These checks only guide the interface. The database policies in 4.5 are the actual enforcement.

**Further gating (FR-8, FR-9, FR-66, FR-67).** After the consent check, `middleware.ts` checks that `profiles.country` is on the supported list and `age_confirmed` is true; users who fail are sent to `/not-available`, which offers only export and Leave the pilot. The About page (`/about`), the Privacy Policy, the Terms of Use and the pilot notice are public pages. Settings has a **Leave the pilot** button that calls `/api/account/delete`; `/about` shows the value of `CONTACT_EMAIL`.

### 9.2 Data layer

- Two Supabase clients: browser (anon key, user session) and server (cookie session). The service role client is created only inside route handlers that need it, never imported elsewhere (enforced by an ESLint rule on the import path).
- TanStack Query for fetching and caching. Query keys are `['items', filters]`, `['catalog', query]`, and so on. Mutations are optimistic where safe.
- Lists use keyset pagination on `(created_at, id)` with 40 rows a page and infinite scroll.
- Filters are expressed once as a function that turns a filter object into a Supabase query; the same object serialises into the URL so views can be linked and restored.

### 9.3 Offline and PWA (NFR-2)

- Web manifest, icons, `display: standalone`.
- The service worker caches the app shell and static assets (cache first), and recent API reads (stale while revalidate) for the wardrobe, outfits and wishlist.
- Writes made offline (add or edit an item, wishlist changes, outfit saves) go into an IndexedDB queue through TanStack Query's persisted mutations and replay in order when the connection returns. Photo and receipt uploads are not queued offline; the app tells the user they need a connection.
- A visible offline banner shows queued changes.

### 9.4 Key modules

| Module | Contents |
| --- | --- |
| `components/wardrobe/ItemForm` | One form for manual, photo, catalogue and receipt-derived items; zod schema generated from the taxonomy; colour picker; condition slider with band label. |
| `components/shared/ColourPicker` | A hue strip with a saturation and lightness area (the `react-colorful` library), a hex input, preset swatches, an eyedropper button using the browser `EyeDropper` API with a canvas-sampling fallback, and the derived family name shown live (computed by the same nearest-swatch function in TypeScript, kept identical to the SQL by a shared test vector file). |
| `components/wardrobe/ConditionSlider` | 0 to 100 slider with band label from `lk_condition_band`; optional (can be cleared). |
| `components/wardrobe/FilterBar` | All filters in FR-11; a "similar colour" control that converts the chosen colour to CIELAB and finds items within a distance threshold using the client-side list. |
| `components/outfits/Builder` | Slots, item picker, saves to `outfits` and `outfit_items`. |
| `components/outfits/Suggestions` | Calls the rule engine (9.5) and shows up to three outfits with reasons. |
| `components/outfits/Calendar` | Month view of `outfit_plans`. The optional "I wore this" action writes an `outfit_logs` row and shows no counter, streak or reminder. |
| `components/purchases/ReceiptFlow` | Upload, wait for the job, editable draft, confirm to create items and purchases in one transaction (an RPC `app.confirm_receipt(job_id, lines jsonb)`). |
| `components/vendor/*` | Dashboard cards, bar and line charts (Recharts), gap table, filters, "not enough users to display" states. |
| `lib/season.ts` | `seasonFor(date, hemisphere)`: northern hemisphere December to February winter, March to May spring, June to August summer, September to November autumn; southern hemisphere shifted by six months. |

All text comes from `messages/en.json` (NFR-5). Prices are shown with `Intl.NumberFormat` in the stored currency and, if a rate is available, a secondary converted amount labelled with the rate date.

### 9.5 Outfit rule engine (`packages/rules`)

A pure TypeScript module with no network or database access; the web app passes it the user's active items.

```ts
type Suggestion = { items: Record<Slot, ItemId | null>; score: number; reasons: string[]; ruleIds: string[] };

function suggest(items: Item[], ctx: { occasion: Occasion; date: Date; hemisphere: 'north'|'south' }): Suggestion[]
```

Algorithm:

1. **Eligibility (hard rules R1, R2).** Keep active items whose seasons include the current season (or none set, or `All year`) and whose occasion tags match, or whose category and sub-type are allowed for the occasion by the occasion table in `rules.json`. Summer excludes coats and heavy knits; sport allows only activewear.
2. **Slot candidates.** Group by slot (`top`, `bottom`, `layer`, `footwear`, `accessory`) and keep the best eight per slot by a cheap pre-score (occasion match, condition not in the Falling apart band).
3. **Combinations.** Enumerate top x bottom x footwear x optional layer (at most 8 x 8 x 8 x 9, with early pruning of rule violations).
4. **Score (R3 to R6).**
   - **Colour (R3).** Convert each item's RGB to HSL. Neutral if its colour family is in the neutral set (Black, White, Grey, Navy, Beige, Khaki, Olive, Brown) or saturation is below 0.15. Bold if saturation is above 0.6 and not neutral. Penalise more than three distinct non-neutral families, and more than one bold item.
   - **Pattern (R4).** Penalise more than one non-solid pattern.
   - **Layering (R5).** In cool seasons, require a layer; penalise a layer whose colour family equals the top's.
   - **Footwear (R6).** Allowed footwear sub-types come from the occasion table; add a bonus when belt and shoes share a colour family.
5. **Variety (R7).** Pick the best combination, then penalise reuse of any item already chosen and pick the next, up to three.
6. **Reasons (R8).** Each satisfied rule contributes a fixed sentence template, for example "Layer works for cool weather" or "Navy and grey are neutral".
7. **Thin wardrobe (FR-54).** If no combination passes the hard rules, return the missing slots as a `missing` list.

Rules and occasion tables are data in `packages/rules/rules.json`, so the style specialist can adjust them without touching code. Unit tests cover each rule with fixtures.

### 9.6 Analytics events

A small `track(event, props)` function inserts into `app.analytics_events` (RLS: own rows). Allowed events and property keys are whitelisted in code; no free text is allowed.

## 10. Security details

| Control | Implementation |
| --- | --- |
| Roles | Role stored in `app.profiles.role`, changeable only by the service role. The role is also copied into the JWT through a Supabase Auth hook for the interface, but policies read the database value. |
| Consent gate | `app.has_consent()` in every consumer policy (4.5) and storage policy (4.6). |
| Vendor isolation | Vendors authenticate as the same Postgres role (`authenticated`) as consumers, so isolation rests on: (a) every `app` policy requiring `current_role() = 'consumer'`; (b) `analytics_private` and `ops` not being exposed through the API and having no grants for `authenticated`; (c) `analytics` tables having no grants, with only the vendor functions executable; (d) each function checking the role. This replaces the HLD's wording about privileges on schemas; the effect is the same. |
| Grants | `revoke all on all tables in schema ... from anon, authenticated` first, then explicit grants. `anon` has no access to any application table. |
| Functions | `security definer` functions have a fixed `search_path`, schema-qualified object names, and `revoke execute ... from public` followed by an explicit grant. |
| Worker | Database role with the minimum grants (7.1); storage only through short-lived signed URLs, so the service role key never leaves Vercel. Requests to the signing route are authenticated with an HMAC token, rate limited, and tied to a job in `running` status. |
| Uploads | Size and content-type limits at the bucket; content sniffing in the worker; images are re-encoded (so any payload in the original is discarded). |
| Input handling | zod validation on every form and route body; parameterised queries only; vendor functions whitelist dimension names. |
| Rate limiting | Per-user limits on job creation (20 per hour), exports (3 per day) and feed uploads (10 per day), enforced in the insert policies and routes. |
| Invitation and region control | `app.handle_new_user()` refuses sign-ups for emails not in `ops.invitations`; `app.complete_onboarding` refuses countries not in `supported_countries`; `app.has_consent()` includes both, so an ineligible account reads no data (4.9). |
| Vendor probing | Every vendor function logs the call and refuses beyond 200 calls an hour (5.7); the admin console shows the log. |
| Receipt privacy | Masking and no stored raw text (7.4); draft results deleted after 7 days. |
| Passwords and sessions | Supabase Auth defaults; minimum length 10; email verification required; sessions in HTTP-only cookies. |
| Logs | Server logs contain IDs and error codes only; no emails, receipts, notes or OCR text. |
| Backups | Encrypted with `age`; contain personal data and are treated as such (section 13). |

## 11. Testing

| Level | Tools | What is covered |
| --- | --- | --- |
| Database | pgTAP, run in CI against a fresh local Supabase | **RLS:** user A cannot read, update or delete user B's rows in any `app` table or bucket; a user without consent gets no rows; a vendor gets no rows from `app` tables; a consumer cannot call vendor functions. **Colour:** golden vectors for `colour_family` (for example `#1F2A44` gives Navy, `#808080` gives Grey, `#FFFFFF` gives White). **Aggregation:** with seeded data, segments under the threshold never appear; rounding is to 5; complementary suppression hides the second smallest sibling; a deleted or unconsented user changes no output. **Gaps:** no score from a suppressed owner row. **Triggers:** archiving an item flags its outfits. |
| Shared logic | Vitest | Rule engine fixtures (each rule, thin wardrobe, variety), season utility, colour conversion and family function (the same golden vectors as SQL), taxonomy validators, feed validation. |
| Worker | pytest | Receipt parser on a fixture set of 30 receipts (varied stores, currencies, crumpled and clean); photo handler output size and transparency; job claim concurrency with two workers (no double claim); retry and reaper behaviour. |
| Collector | pytest with recorded HTML | `robots.txt` disallow honoured, rate limit applied, mapping of colour names and categories. |
| Web components | Vitest and Testing Library | Forms, colour picker, filters, empty and error states. |
| End to end | Playwright against Vercel preview plus the dev Supabase project | Sign up; pilot notice blocks until accepted; greyed-out sharing setting with tooltip; add item by each method; receipt draft needs confirmation; outfit suggestion and calendar; delete account then sign-in fails; vendor sees dashboard and cannot reach consumer routes. |
| Accessibility | axe in Playwright, manual keyboard pass | Main flows meet WCAG 2.1 AA (NFR-4). |
| Performance | Lighthouse CI on a 500-item account | Main screens load under 3 seconds on a throttled mobile profile (NFR-3). |
| Security | Secret scan, dependency audit, manual review of every policy by the SA | No secrets in the repository; no high-severity advisories. |

Acceptance criteria in FDD section 17 each map to at least one end-to-end or pgTAP test; the mapping is kept in the test names (for example `FR-80 suppresses segment of 9`).

## 12. CI/CD, environments and configuration

### 12.1 Pipelines

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Pull request | Install, lint, type check, generate types and check for drift, Vitest, start local Supabase and run migrations and pgTAP, build, Playwright against the preview, secret scan, dependency audit. Worker and collector tests run in a separate job. |
| `deploy.yml` | Merge to main | Apply migrations to the production Supabase project with the CLI (after a dry run), then Vercel deploys. Migrations are written to be backward compatible with the previous app version. |
| `collect.yml` | Weekly and manual | Run the collector. |
| `fx.yml` | Daily | Fetch exchange rates and write `ops.fx_rates` through a limited role. |
| `keepalive.yml` | Weekly | Request `/api/health` so the free database does not pause. |

### 12.2 Environments

| Environment | Web | Database | Worker |
| --- | --- | --- | --- |
| Local | `next dev` | Supabase CLI (Docker) | `docker compose up` |
| Preview | Vercel preview per pull request | Dev Supabase project | Optional |
| Production | Vercel production | Production Supabase project | Container on the host machine |

There is no staging environment; migrations are exercised on a fresh local database and the dev project before production.

### 12.3 Configuration (environment variables)

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web (public) | Safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel server only | Used only in route handlers listed in section 6 |
| `WORKER_SHARED_SECRET` | Vercel server and worker | HMAC key for the signing route |
| `WORKER_DATABASE_URL` | Worker | Connection string for `worker_role` |
| `COLLECTOR_DATABASE_URL`, `FX_DATABASE_URL` | GitHub secrets | Limited roles |
| `EMAIL_API_KEY` | Vercel server | Transactional email |
| `NOTICE_VERSION` | Web build | Must equal `ops.settings.current_notice_version` |
| `TERMS_VERSION`, `PRIVACY_VERSION` | Web build | Must equal `ops.settings.current_terms_version` and `current_privacy_version` |
| `CONTACT_EMAIL` | Web (public) | The privacy contact address shown on the About page and in emails. Required before the pilot opens (FR-67). |
| `.env.example` | Repository | Names only, no values |

## 13. Operations

### 13.1 Monitoring

- Admin console panel: worker status (heartbeat age, queue depth, oldest job age), last aggregate run and its audit row, number of failed jobs in 24 hours, deletion queue (requests older than 5 days highlighted).
- A scheduled GitHub Action calls `/api/health`; a failure sends an email to the team.
- Supabase usage (storage and database size) is checked in the weekly keep-alive run, which fails when either is above 80% of the free limit.

### 13.2 Runbooks (short)

| Situation | Action |
| --- | --- |
| Worker offline | Check the host and the container (`docker compose ps`, logs). Jobs stay queued; users are offered manual entry after two minutes. Restart; if the host is lost, run the same image elsewhere with the same environment variables. |
| Stuck or repeatedly failing jobs | The reaper retries three times, then marks failed. Inspect `last_error`; fix the cause; requeue by resetting status and `attempts`. |
| Storage near the limit | Delete original images where the cut-out was accepted; lower the per-user image cap; if still needed, move to the paid plan or reduce image size. |
| Deletion request pending | Confirm `deleting = true` and storage objects; rerun the delete routine; the 7-day target (FR-64) is checked daily. |
| Aggregate run failed | Read the audit row; fix and call `analytics.run_aggregation()` manually. The last good cube remains visible meanwhile. |
| Key or secret leak | Rotate the affected key (Supabase dashboard, GitHub secrets, Vercel), redeploy, and review logs. |
| Policy change | Any change to RLS or a vendor function needs a pgTAP test and the SA's review before merging. |

### 13.3 Backups and restore

A weekly job on the worker host runs `pg_dump` through the Supabase CLI, encrypts the output with `age` (public key in the repository, private key held by the product owner and the SA), and stores it on the host and in one other team member's private storage. Backups are never stored as GitHub Actions artifacts, because artifacts in a public repository are downloadable. A restore into a fresh local database is rehearsed once before the pilot opens (NFR-8). Backups older than 30 days are deleted, and the notice states that deleted users' data may remain in backups for up to 30 days.

### 13.4 Data retention

| Data | Retention |
| --- | --- |
| User data | Until the user deletes it or the pilot ends and the team deletes it per the notice |
| Receipt-reading results (job results) | 7 days; raw scan text is never stored |
| Exports | 7 days |
| Aggregate cube | Latest run only; audit rows kept for the pilot |
| Backups | 30 days |
| Analytics events | Pilot period, pseudonymous |
| Vendor query log | The pilot period |

## 14. Build order

Aligned with the BRD timeline.

| Step | Weeks | Deliverables |
| --- | --- | --- |
| M1 Foundations | 1-2 | Repository, CI, local Supabase, migrations for lookups, colour functions, core tables, RLS and storage policies, pgTAP for RLS; auth, middleware and the pilot notice page; wardrobe list and item form with manual entry and the colour picker; seed taxonomy; first collector run. |
| M2 Wardrobe breadth | 3-4 | Catalogue search and picker, filters, collections and tags, condition, archive, purchases, wishlist, export and delete routes. Start pilot recruitment. |
| M3 Images and receipts | 4-5 | Job table and claim, worker container, photo handler, receipt handler and draft UI, heartbeat. |
| M4 Outfits | 5-6 | Rule engine and tests, builder, suggestions, calendar, optional log. |
| M5 Vendor side | 5-6 | Aggregation run, cube, suppression, vendor functions and tests, dashboard, gaps, condition spectrum, report, vendor invite, feed validation and publish. |
| M6 Hardening and pilot open | 6 | End-to-end and accessibility passes, restore rehearsal, load check at 500 users, a walkthrough of the legal pack with the final contact address, supported countries and invitation list in place, and an incident-plan practice run (`docs/legal`). |
| Pilot | 7-12 | Operate, fix, measure, vendor review. |

Aggregation (M5) depends on enough test data from the earlier milestones; synthetic data generated by the seed scripts is used for tests only and is never loaded into production.

## 15. Traceability

| FDD requirements | Implemented in |
| --- | --- |
| FR-1 to FR-7 (account, notice, onboarding) | 4.4 `profiles`, `consent_records`; 4.5; 9.1 |
| FR-10 to FR-17 (wardrobe) | 4.4 `items`; 4.7; 9.2; 9.4 `FilterBar` |
| FR-18 to FR-20 (condition) | 4.2 `lk_condition_band`; 4.4; 9.4 `ConditionSlider`; 5.4 |
| FR-21 to FR-29a (adding items, colour) | 4.3; 7.3; 8.1; 9.4 `ItemForm`, `ColourPicker` |
| FR-30 to FR-36 (purchases, wishlist) | 4.4 tables; 9.4 |
| FR-40 to FR-46 (receipts) | 7.4; 9.4 `ReceiptFlow`; 4.6 |
| FR-50 to FR-57 (outfits) | 4.4; 9.4; 9.5 |
| FR-60 to FR-65 (settings, data rights) | 6 (`delete`, `export`); 7.5; 13.4; 9.4 |
| FR-70 to FR-79 (vendor portal) | 5.4; 5.5; 9.4 `vendor/*` |
| FR-80 to FR-87 (aggregation rules) | 5.1 to 5.3; 5.6 |
| FR-90 to FR-93 (feed) | 6; 8.2; 4.8 |
| FR-100 to FR-104 (catalogue management) | 4.8; 8.1 |
| NFR-1 to NFR-8 | 9.3; 11; 12; 13 |

## 16. Refinements to and departures from the HLD

For the SA to confirm.

| ID | Point | LLD decision | Reason |
| --- | --- | --- | --- |
| LD-1 | HLD 7: vendors have "no privileges" on `app` or `analytics_private`. | All roles share the Postgres role `authenticated`. Isolation uses RLS role checks, unexposed schemas, no grants and role checks inside vendor functions (section 10). | Supabase issues the same database role to every signed-in user. |
| LD-2 | HLD 5.1 and 5.2: the web app calls the worker. | The worker polls the `jobs` table; the web app never calls it. | Matches the self-hosted decision; no inbound access. |
| LD-3 | HLD 7: the worker uses a "scoped key". | Worker uses a limited Postgres role plus signed URLs from a Vercel route; the service role key stays on Vercel. | Supabase offers no scoped storage key; this keeps the powerful key off a personal machine. |
| LD-4 | HLD 5.4: aggregates in tables with k and rounding. | A cube restricted to a fixed set of grouping sets with one filter at most, plus complementary suppression. | Limits differencing attacks while keeping the dashboard flexible. |
| LD-5 | HLD 8: weekly backup to a private storage location. | Encrypted backups on the worker host and one other private location; never as workflow artifacts. | Artifacts in a public repository are downloadable. |
| LD-6 | HLD 4: outfit logic in the web app. | Kept, as a separate package with data-driven rules. | Lets the style specialist edit rules without code changes. |
| LD-7 | New: legal controls (invitation-only sign-up through an auth trigger, country allow-list, acceptance records, receipt redaction, vendor query log and agreement acceptance). | Added in sections 4.9, 5.7, 7.4, 9.1 and 10 after the legal and privacy review (`docs/legal/LEGAL-REVIEW.md`). | Needed for the pilot's risk position. |

## 17. Open items

| ID | Item | Owner |
| --- | --- | --- |
| LOI-1 | Confirm LD-1 to LD-6. | C. Prashanth |
| LOI-2 | Tune the colour family reference swatches against real items and check the nearest-match results with test colours. | Arpan Shah |
| LOI-3 | Choose the `rembg` model (`u2netp` or `isnet-general-use`) after trying both on the worker host. | C. Prashanth |
| LOI-4 | Confirm the aggregation grouping sets, price bands and region mapping before the first vendor demo. | Product owner and SA |
| LOI-5 | Choose the transactional email provider and verify its free quota. | Delivery team |
| LOI-6 | Confirm the service worker library and offline write scope (9.3) after a first prototype. | C. Prashanth |
| LOI-7 | Decide who holds the backup private key and where the second backup copy lives. | Product owner |
| LOI-8 | Test that blocking sign-up in the `auth.users` trigger works for both email and Google sign-in on the dev project, and that the app shows a clear message. | C. Prashanth |
