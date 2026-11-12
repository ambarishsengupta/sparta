-- WO-0112 (R7b): a vendor member reads its own vendor's id and name (the portal shows the name on /vendor and /vendor/account; found by WO-0103).
-- Column grant on (id, name) only: created_at stays unreadable, nothing is writable; the policy lets a member see the vendor it belongs to and nobody else's row.
-- The membership subquery runs as the caller, so vendor_members_own_select limits it to the caller's own memberships.
grant select (id, name) on catalog.vendors to authenticated;
create policy vendors_member_select on catalog.vendors for select to authenticated using (
  exists (select 1 from catalog.vendor_members m where m.vendor_id = vendors.id and m.user_id = (select auth.uid())));
