-- WO-0040 migration 2: the lookup tables of LLD 4.2. Rows come from supabase/seed/lookups.sql (generated).
create table catalog.lk_category (code text primary key, label text not null,
  sort int not null default 0, active boolean not null default true);
-- these have the same shape as lk_category
create table catalog.lk_colour_family (like catalog.lk_category including all);
create table catalog.lk_fit (like catalog.lk_category including all);
create table catalog.lk_material (like catalog.lk_category including all);
create table catalog.lk_pattern (like catalog.lk_category including all);
create table catalog.lk_season (like catalog.lk_category including all);
create table catalog.lk_occasion (like catalog.lk_category including all);
create table catalog.lk_size_system (like catalog.lk_category including all);
-- no taxonomy data exists for these yet: created empty (brands, price bands and regions come with R5 data)
create table catalog.lk_brand (like catalog.lk_category including all);
create table catalog.lk_price_band (like catalog.lk_category including all);
create table catalog.lk_region (like catalog.lk_category including all);

create table catalog.lk_sub_type (category text not null references catalog.lk_category(code),
  code text not null, label text not null, sort int not null default 0,
  active boolean not null default true, primary key (category, code));
create table catalog.lk_size (size_system text not null references catalog.lk_size_system(code),
  code text not null, label text not null, sort int not null default 0,
  active boolean not null default true, primary key (size_system, code));
create table catalog.lk_condition_band (code text primary key, label text not null,
  sort int not null default 0, active boolean not null default true,
  min_score smallint not null, max_score smallint not null, check (min_score <= max_score));
create table catalog.country_region (country char(2) primary key, region text not null);

-- LLD 4.5: catalog.lk_* are readable by signed-in users and the secret-key client, never writable by clients.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'catalog' and c.relkind = 'r' and (c.relname like 'lk\_%' or c.relname = 'country_region')
  loop
    execute format('alter table catalog.%I enable row level security', t);
    execute format('alter table catalog.%I force row level security', t);
    execute format('create policy %I on catalog.%I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on catalog.%I to authenticated', t);
    execute format('grant all on catalog.%I to service_role', t);
  end loop;
end $$;
