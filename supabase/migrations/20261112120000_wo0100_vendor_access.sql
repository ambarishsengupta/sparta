-- WO-0100 (R7a) migration 1: vendor access to the database (LLD 4.5, 4.9, 5.7; FR-70, FR-88, FR-94; BR-34, BR-35, BR-36).
-- (1) a vendor reads its own catalog.vendor_members rows (the acceptance policy below relies on it); no write grant: memberships are managed by server routes.
-- (2) catalog.vendor_agreement_acceptances exactly as LLD 4.9: select own rows, insert own row for the caller's own vendor at the current version only;
--     no update, no delete (deletion is by cascade). The insert grant lists the three columns, so accepted_at can not be chosen by the client.
-- (3) ops.vendor_query_log (LLD 5.7): no grant to any client role. The vendor functions (next migration) write it as their owner.
-- Deny by default: RLS enabled and forced, revoke all first, then the grants named here.

grant select on catalog.vendor_members to authenticated;
create policy vendor_members_own_select on catalog.vendor_members for select to authenticated using (user_id = (select auth.uid()));

create table catalog.vendor_agreement_acceptances (
  vendor_id uuid not null references catalog.vendors(id) on delete cascade,
  user_id uuid not null references app.profiles(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (vendor_id, user_id, version)
);
alter table catalog.vendor_agreement_acceptances enable row level security;
alter table catalog.vendor_agreement_acceptances force row level security;
revoke all on catalog.vendor_agreement_acceptances from public, anon, authenticated, service_role;
grant select on catalog.vendor_agreement_acceptances to authenticated;
grant insert (vendor_id, user_id, version) on catalog.vendor_agreement_acceptances to authenticated;
create policy vendor_acceptances_own_select on catalog.vendor_agreement_acceptances for select to authenticated using (user_id = (select auth.uid()));
-- the membership subquery runs as the caller, so it is answered by vendor_members_own_select: only the caller's own vendor passes
create policy vendor_acceptances_own_insert on catalog.vendor_agreement_acceptances for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from catalog.vendor_members m where m.vendor_id = vendor_agreement_acceptances.vendor_id and m.user_id = (select auth.uid()))
  and version = (select app.public_setting('current_vendor_agreement_version')));

-- one row per answered vendor call (FR-88); parameters are dimension names and filter values only, never participant data
create table ops.vendor_query_log (
  id bigint generated always as identity primary key,
  vendor_id uuid not null,
  user_id uuid not null,
  fn text not null,
  params jsonb,
  called_at timestamptz not null default now()
);
create index on ops.vendor_query_log (vendor_id, called_at);
alter table ops.vendor_query_log enable row level security;
alter table ops.vendor_query_log force row level security;
revoke all on ops.vendor_query_log from public, anon, authenticated, service_role;
revoke all on sequence ops.vendor_query_log_id_seq from public, anon, authenticated, service_role;
