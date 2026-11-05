-- WO-0041 migration 7: row-level security, policies and grants for the consumer tables (LLD 4.5, section 10).
-- Deny by default: RLS is enabled AND forced on every table; no client role gets a privilege that has no matching policy;
-- anon gets nothing on any table. A new table without its own block here fails supabase/tests/database/004_rls_isolation.

revoke all on all tables in schema app from public, anon, authenticated;
grant all on all tables in schema app to service_role;   -- the secret-key client (LLD 4.1); it bypasses RLS but needs grants

-- ---- profiles, consent records, document acceptances: readable by their owner with no consent gate -----------------------
alter table app.profiles enable row level security;
alter table app.profiles force row level security;
alter table app.consent_records enable row level security;
alter table app.consent_records force row level security;
alter table app.document_acceptances enable row level security;
alter table app.document_acceptances force row level security;

-- `authenticated` gets no table-level insert or update on profiles, only these columns (a column revoke has no effect under a
-- table-level grant). role, age_confirmed, deleting and deletion_requested_at are therefore server-side only.
grant select on app.profiles to authenticated;
grant update (display_name, country, hemisphere, currency, occasions) on app.profiles to authenticated;
create policy profiles_select on app.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on app.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- insert only the user and the notice version: accepted_at cannot be forged; the version must be the current one
grant select, insert (user_id, notice_version) on app.consent_records to authenticated;
create policy consent_records_select on app.consent_records for select to authenticated using (user_id = (select auth.uid()));
create policy consent_records_insert on app.consent_records for insert to authenticated
  with check (user_id = (select auth.uid()) and notice_version = (select app.public_setting('current_notice_version')));

grant select on app.document_acceptances to authenticated;   -- rows are written only by app.accept_documents
create policy document_acceptances_select on app.document_acceptances for select to authenticated using (user_id = (select auth.uid()));

-- ---- owner tables behind the consent gate -------------------------------------------------------------------------------
-- One policy per operation, and a grant only for the operations listed. No delete on items (LLD 4.6: the delete route
-- removes storage objects first), no update on append-only records.
do $$
declare
  t record;
  op text;
  gate constant text := 'user_id = (select auth.uid()) and (select app.current_role()) = ''consumer'' and (select app.has_consent())';
begin
  for t in select * from (values
    ('items', 'select,insert,update'),
    ('item_features', 'select,insert,update,delete'),
    ('purchases', 'select,insert,update,delete'),
    ('wishlist_entries', 'select,insert,update,delete'),
    ('collections', 'select,insert,update,delete'),
    ('tags', 'select,insert,update,delete'),
    ('item_collections', 'select,insert,delete'),
    ('item_tags', 'select,insert,delete'),
    ('outfits', 'select,insert,update,delete'),
    ('outfit_items', 'select,insert,update,delete'),
    ('outfit_plans', 'select,insert,update,delete'),
    ('outfit_logs', 'select,insert,delete'),
    ('suggestion_feedback', 'select,insert')
  ) as v(tbl, ops)
  loop
    execute format('alter table app.%I enable row level security', t.tbl);
    execute format('alter table app.%I force row level security', t.tbl);
    foreach op in array string_to_array(t.ops, ',') loop
      execute format('create policy %I on app.%I for %s to authenticated %s', t.tbl || '_' || op, t.tbl, op,
        case op when 'insert' then 'with check (' || gate || ')'
                when 'update' then 'using (' || gate || ') with check (' || gate || ')'
                else 'using (' || gate || ')' end);
      execute format('grant %s on app.%I to authenticated', op, t.tbl);
    end loop;
  end loop;
end $$;
