-- WO-0080 (R6a) migration 1: app.receipts and app.purchase_receipts (LLD 4.4, 4.5, 4.6, 4.7; FR-32, FR-46, FR-47).
--
-- A receipt row is created with the upload, so a stored file is always deletable (WO-0082). `authenticated` has no delete on receipts: the
-- row goes only through DELETE /api/receipts/[id], which removes the object first (LLD 4.6). purchase_receipts links a purchase to a receipt
-- through composite owner keys (id, user_id) on both parents, so a link to another user's purchase or receipt is impossible even for roles
-- that bypass RLS. The deleted purchase or receipt takes its links with it (on delete cascade).

-- the parent key the composite foreign key needs (the same pattern as items, collections and outfits)
alter table app.purchases add constraint purchases_id_user_unique unique (id, user_id);

create table app.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id) on delete cascade,
  storage_path text not null,
  store text check (char_length(store) <= 200),
  receipt_date date,
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  total numeric(12,2) check (total >= 0),
  -- the receipt job whose draft was confirmed. No foreign key on purpose: the daily purge deletes finished receipt jobs after 7 days and a
  -- set-null key into app.jobs would be the one non-cascading key into app.* (pgTAP 008 audits that). Ownership is checked by the update
  -- policy and by app.confirm_receipt instead.
  job_id bigint unique,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (storage_path),
  -- one plain file directly under the owner's folder: the rule of app.job_input_ok and of items.image_path (WO-0075)
  constraint receipts_storage_path_owner_chk check (
    storage_path ~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') and storage_path !~ '\.\.')
);

create table app.purchase_receipts (
  purchase_id uuid not null,
  receipt_id uuid not null,
  user_id uuid not null references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (purchase_id, receipt_id),
  foreign key (purchase_id, user_id) references app.purchases(id, user_id) on delete cascade,
  foreign key (receipt_id, user_id) references app.receipts(id, user_id) on delete cascade
);

create index receipts_user_created on app.receipts (user_id, created_at desc);
create index purchase_receipts_user on app.purchase_receipts (user_id);
create index purchase_receipts_receipt on app.purchase_receipts (receipt_id);
-- LLD 4.7 purchases (user_id, purchase_date desc) already exists as purchases_user_date (core tables migration)

alter table app.receipts enable row level security;
alter table app.receipts force row level security;
alter table app.purchase_receipts enable row level security;
alter table app.purchase_receipts force row level security;
revoke all on app.receipts, app.purchase_receipts from public, anon, authenticated;
grant all on app.receipts, app.purchase_receipts to service_role;   -- the secret-key client (LLD 4.1)

-- receipts: select; insert only the upload's own facts (not id, job_id, confirmed_at); update only what the draft sets (never storage_path
-- or user_id); no delete. purchase_receipts: select, insert, delete (unlinking).
grant select on app.receipts, app.purchase_receipts to authenticated;
grant insert (user_id, storage_path, store, receipt_date, currency, total) on app.receipts to authenticated;
grant update (store, receipt_date, currency, total, job_id, confirmed_at) on app.receipts to authenticated;
grant insert, delete on app.purchase_receipts to authenticated;

do $$
declare
  gate constant text := 'user_id = (select auth.uid()) and (select app.current_role()) = ''consumer'' and (select app.has_consent())';
begin
  execute format('create policy receipts_select on app.receipts for select to authenticated using (%s)', gate);
  execute format('create policy receipts_insert on app.receipts for insert to authenticated with check (%s)', gate);
  -- a job_id, when set, is one of the caller's own receipt jobs (the subquery runs under the caller's jobs policy)
  execute format('create policy receipts_update on app.receipts for update to authenticated using (%s) with check (%s and (job_id is null or exists (
      select 1 from app.jobs j where j.id = job_id and j.user_id = (select auth.uid()) and j.type = ''receipt'')))', gate, gate);
  execute format('create policy purchase_receipts_select on app.purchase_receipts for select to authenticated using (%s)', gate);
  execute format('create policy purchase_receipts_insert on app.purchase_receipts for insert to authenticated with check (%s)', gate);
  execute format('create policy purchase_receipts_delete on app.purchase_receipts for delete to authenticated using (%s)', gate);
end $$;
