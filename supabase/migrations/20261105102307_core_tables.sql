-- WO-0041 migration 5: the consumer tables of LLD 4.4 and 4.9 and the indexes of 4.7. Policies, grants and triggers follow in
-- migrations 6 and 7. Skipped here (later releases): jobs, receipts, purchase_receipts, analytics_events (storage, worker,
-- analytics), and the foreign key to catalog.catalog_items (R6 creates that table; see workflow/evidence/R2/NOTES.md).
--
-- Hardening beyond the LLD: every link table references its parent through a composite key that includes user_id
-- (unique (id, user_id) on the parent), so a row can never point at another user's parent, and a cascade can never reach
-- across users. Plain foreign keys are checked without row-level security, so they could not give that guarantee.

create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'consumer' check (role in ('consumer', 'vendor', 'admin')),
  display_name text,
  country char(2) check (country ~ '^[A-Z]{2}$'),
  hemisphere text check (hemisphere in ('north', 'south')),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  occasions text[] not null default '{}',
  age_confirmed boolean not null default false,
  deleting boolean not null default false,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  notice_version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, notice_version)
);

create table app.document_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  document text not null check (document in ('terms', 'privacy_policy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

create table app.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  catalog_item_id uuid,                        -- foreign key to catalog.catalog_items is added with that table (R6)
  name text not null,
  category text not null references catalog.lk_category(code),
  sub_type text not null,
  colour_r smallint not null check (colour_r between 0 and 255),
  colour_g smallint not null check (colour_g between 0 and 255),
  colour_b smallint not null check (colour_b between 0 and 255),
  colour_hex char(7), colour_family text, is_multicolour boolean not null default false,   -- set by the colour trigger only
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
  origin text not null check (origin in ('catalogue', 'manual', 'photo', 'receipt', 'vendor_feed')),
  status text not null default 'active' check (status in ('active', 'archived')),
  archive_reason text check (archive_reason in ('sold', 'donated', 'discarded', 'lost')),
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (category, sub_type) references catalog.lk_sub_type(category, code),
  unique (id, user_id)
);

create table app.item_features (
  item_id uuid primary key references app.items(id) on delete cascade,   -- owner check: trigger app.check_item_features_owner
  user_id uuid not null references app.profiles(id) on delete cascade,
  model_version text not null check (model_version in ('garment-cnn-v1', 'garment-cnn-v2')),
  garment_class smallint check (garment_class >= 0),
  garment_p real check (garment_p between 0 and 1),
  embedding real[] not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (array_ndims(embedding) = 1),
  check ((model_version = 'garment-cnn-v1' and cardinality(embedding) = 32)
      or (model_version = 'garment-cnn-v2' and cardinality(embedding) = 64)),
  check (garment_class is null or garment_class <= case model_version when 'garment-cnn-v1' then 9 else 19 end)
);

create table app.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, name), unique (id, user_id)
);
create table app.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name), unique (id, user_id)
);
create table app.item_collections (
  user_id uuid not null references app.profiles(id) on delete cascade,
  item_id uuid not null, collection_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (item_id, collection_id),
  foreign key (item_id, user_id) references app.items(id, user_id) on delete cascade,
  foreign key (collection_id, user_id) references app.collections(id, user_id) on delete cascade
);
create table app.item_tags (
  user_id uuid not null references app.profiles(id) on delete cascade,
  item_id uuid not null, tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id),
  foreign key (item_id, user_id) references app.items(id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references app.tags(id, user_id) on delete cascade
);

create table app.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  item_id uuid not null,
  purchase_date date, store text, price numeric(12,2), currency char(3),
  quantity int not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (item_id, user_id) references app.items(id, user_id) on delete cascade
);

create table app.wishlist_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  catalog_item_id uuid,                        -- foreign key to catalog.catalog_items is added with that table (R6)
  name text not null,
  category text not null, sub_type text not null,
  colour_r smallint check (colour_r between 0 and 255), colour_g smallint check (colour_g between 0 and 255),
  colour_b smallint check (colour_b between 0 and 255),
  check (num_nulls(colour_r, colour_g, colour_b) in (0, 3)),
  colour_hex char(7), colour_family text, is_multicolour boolean not null default false,   -- set by the colour trigger only
  fit text references catalog.lk_fit(code),
  brand text,
  size_system text references catalog.lk_size_system(code), size_value text,
  seasons text[] not null default '{}',
  target_price numeric(12,2), currency char(3),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  planned_month date check (planned_month = date_trunc('month', planned_month)::date),   -- first day of the month
  budget numeric(12,2),
  notes text,
  status text not null default 'open' check (status in ('open', 'bought')),
  origin text not null default 'user' check (origin in ('user', 'unlock')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (category, sub_type) references catalog.lk_sub_type(category, code)
);

create table app.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  name text not null,
  occasions text[] not null default '{}', seasons text[] not null default '{}',
  notes text,
  needs_attention boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create table app.outfit_items (
  user_id uuid not null references app.profiles(id) on delete cascade,
  outfit_id uuid not null, item_id uuid not null,
  slot text not null check (slot in ('top', 'bottom', 'layer', 'footwear', 'accessory')),
  created_at timestamptz not null default now(),
  primary key (outfit_id, item_id),
  foreign key (outfit_id, user_id) references app.outfits(id, user_id) on delete cascade,
  foreign key (item_id, user_id) references app.items(id, user_id) on delete cascade
);
create table app.outfit_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  outfit_id uuid not null,
  plan_date date not null, label text,
  created_at timestamptz not null default now(),
  foreign key (outfit_id, user_id) references app.outfits(id, user_id) on delete cascade
);
create table app.outfit_logs (   -- never read by any aggregate or counter (FR-56, FR-57)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  outfit_id uuid not null,
  logged_on date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (outfit_id, user_id) references app.outfits(id, user_id) on delete cascade
);

create table app.suggestion_feedback (   -- for rule tuning; holds no item IDs
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  occasion text not null references catalog.lk_occasion(code),
  rule_ids text[] not null default '{}',
  accepted boolean not null,
  engine_config text not null check (engine_config ~ '^[A-Za-z0-9:;._-]{1,64}$'),   -- e.g. gm1;emb0;pair0;ul:fb;w:base
  created_at timestamptz not null default now()
);

-- LLD 4.7 (the indexes whose tables exist), plus user_id indexes that the owner policies and the cascades rely on
create index items_user_status_created on app.items (user_id, status, created_at desc);
create index items_user_category_colour on app.items (user_id, category, colour_family);
create index items_user_never_worn on app.items (user_id) where is_never_worn;
create index items_seasons_gin on app.items using gin (seasons);
create index items_occasions_gin on app.items using gin (occasions);
create index purchases_user_date on app.purchases (user_id, purchase_date desc);
create index purchases_item on app.purchases (item_id);
create index wishlist_user_status on app.wishlist_entries (user_id, status);
create index item_features_user on app.item_features (user_id);
create index collections_user on app.collections (user_id);
create index item_collections_user on app.item_collections (user_id);
create index item_collections_collection on app.item_collections (collection_id);
create index tags_user on app.tags (user_id);
create index item_tags_user on app.item_tags (user_id);
create index item_tags_tag on app.item_tags (tag_id);
create index outfits_user on app.outfits (user_id);
create index outfit_items_user on app.outfit_items (user_id);
create index outfit_items_item on app.outfit_items (item_id);
create index outfit_plans_user_date on app.outfit_plans (user_id, plan_date);
create index outfit_plans_outfit on app.outfit_plans (outfit_id);
create index outfit_logs_user on app.outfit_logs (user_id);
create index outfit_logs_outfit on app.outfit_logs (outfit_id);
create index suggestion_feedback_user on app.suggestion_feedback (user_id);
