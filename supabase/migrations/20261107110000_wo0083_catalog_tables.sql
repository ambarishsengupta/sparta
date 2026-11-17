-- WO-0083 (R6b) migration 1: the catalogue tables of LLD 4.8, their keys, indexes, row-level security and the admin-only take-down.
-- catalog.vendors and catalog.vendor_members exist only because catalog_items has a vendor_id key and LLD 4.5 names the members table; they
-- have RLS but NO client policy or grant yet (the vendor portal, R7, adds the "select own rows" policy). No data is seeded here: the pilot
-- catalogue stays empty until the owner approves a source (O1); the synthetic demo rows come only from supabase/scripts/seed-demo-catalog.sh.

-- ---- the source register (Data Sourcing Policy section 4; FR-100) -------------------------------------------------------------
create table catalog.sources (
  id serial primary key,
  name text not null check (char_length(name) between 1 and 120),
  site_url text not null check (site_url ~ '^https?://[^[:space:]]+$'),
  robots_allowed boolean not null,
  terms_note text not null,
  allowed boolean not null default false,
  checked_on date not null,
  contact text,
  last_collected_at timestamptz,
  takedown_at timestamptz,
  takedown_note text check (char_length(takedown_note) <= 500),
  -- policy section 4: a source is collectable only with a robots.txt that allows it and a recorded terms note; section 7: never again once taken down
  constraint sources_allowed_ck check (not allowed or (robots_allowed and takedown_at is null and btrim(terms_note) <> ''))
);

create table catalog.vendors (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table catalog.vendor_members (
  vendor_id uuid references catalog.vendors(id) on delete cascade,
  user_id uuid references app.profiles(id) on delete cascade,
  primary key (vendor_id, user_id)
);

-- ---- the catalogue (LLD 4.8) --------------------------------------------------------------------------------------------------
create table catalog.catalog_items (
  id uuid primary key default gen_random_uuid(),
  source_id int references catalog.sources(id) on delete cascade,
  vendor_id uuid references catalog.vendors(id) on delete cascade,
  sku text not null, name text not null, brand text,
  gtin text check (gtin ~ '^[0-9]{14}$'),             -- barcode number, left-padded with zeros to 14 digits (FR-26)
  category text, sub_type text,
  colour_r smallint check (colour_r between 0 and 255), colour_g smallint check (colour_g between 0 and 255),
  colour_b smallint check (colour_b between 0 and 255), colour_hex char(7), colour_family text,
  is_multicolour boolean not null default false,
  secondary_colour_hex char(7) check (secondary_colour_hex ~ '^#[0-9A-Fa-f]{6}$'),   -- display only (LLD 4.3)
  fit text, material text, pattern text, sizes_available text[],
  price numeric(12,2) check (price >= 0 and price < 'Infinity'), currency char(3), seasons text[], occasions text[],
  product_url text not null, collected_at timestamptz not null default now(), missed_runs smallint not null default 0,
  status text not null default 'active' check (status in ('active', 'review', 'withdrawn')),
  check ((source_id is not null) <> (vendor_id is not null)),
  check (status <> 'active' or (category is not null and sub_type is not null)),
  unique nulls not distinct (source_id, vendor_id, sku)
);
create trigger catalog_items_colour before insert or update on catalog.catalog_items for each row execute function catalog.set_colour_fields();

-- LLD 4.7: catalogue search (trigram on name and brand, category x colour family) and barcode lookup
create index catalog_items_name_trgm on catalog.catalog_items using gin (name extensions.gin_trgm_ops);
create index catalog_items_brand_trgm on catalog.catalog_items using gin (brand extensions.gin_trgm_ops);
create index catalog_items_category_colour on catalog.catalog_items (category, colour_family);
create index catalog_items_gtin on catalog.catalog_items (gtin) where gtin is not null;

-- the keys that were left open in the core tables (R2): deleting a catalogue row only removes the link, never the user's own item
alter table app.items add constraint items_catalog_item_id_fkey foreign key (catalog_item_id) references catalog.catalog_items(id) on delete set null;
alter table app.wishlist_entries add constraint wishlist_entries_catalog_item_id_fkey foreign key (catalog_item_id) references catalog.catalog_items(id) on delete set null;

-- ---- row-level security and grants (LLD 4.5) ----------------------------------------------------------------------------------
alter table catalog.sources enable row level security;
alter table catalog.sources force row level security;
alter table catalog.vendors enable row level security;
alter table catalog.vendors force row level security;
alter table catalog.vendor_members enable row level security;
alter table catalog.vendor_members force row level security;
alter table catalog.catalog_items enable row level security;
alter table catalog.catalog_items force row level security;
revoke all on catalog.sources, catalog.vendors, catalog.vendor_members, catalog.catalog_items from public, anon, authenticated;
grant all on catalog.sources, catalog.vendors, catalog.vendor_members, catalog.catalog_items to service_role;
grant usage on sequence catalog.sources_id_seq to service_role;

-- consumers read active rows only, with consent; vendors and admins write through server routes (secret key), never directly
grant select on catalog.catalog_items to authenticated;
create policy catalog_items_consumer_select on catalog.catalog_items for select to authenticated
  using (status = 'active' and (select app.current_role()) = 'consumer' and (select app.has_consent()));

-- ---- take-down (FR-103; Data Sourcing Policy section 7; LLD 4.8) --------------------------------------------------------------
-- Admin only. One transaction (a function body is one): lock the source, mark it down, delete its catalogue rows. The source row is kept as the
-- record of the request and the marker that it must not be collected again. Users' items and wishlist entries keep their own attributes and
-- lose only the link (on delete set null). Returns how many catalogue rows were deleted.
create function catalog.take_down_source(p_source int, p_note text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if (select app.current_role()) is distinct from 'admin' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  perform 1 from catalog.sources s where s.id = p_source for update;   -- also waits for a collector insert that is in flight
  if not found then raise exception 'source_not_found' using errcode = 'P0002'; end if;
  update catalog.sources set allowed = false, takedown_at = now(), takedown_note = p_note where id = p_source;
  delete from catalog.catalog_items where source_id = p_source;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function catalog.take_down_source(int, text) from public, anon;
grant execute on function catalog.take_down_source(int, text) to authenticated;
