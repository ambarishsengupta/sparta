-- WO-0159 (R8a): the close outcome of the pilot ends vendor access (FR-69, BR-45; LLD 6 /api/admin/pilot/end, 13.4).
-- The single-vendor end route is not built (R7 owner item O1), so what "ending each vendor" means for the close outcome is built here, in the
-- database: every vendor-owned catalogue row leaves the consumer catalogue (status withdrawn, never deleted), the vendor query log is deleted in
-- full, and the vendor users go (their invitation rows, then their auth.users rows; profiles, memberships, agreement acceptances and usage
-- events follow by cascade). Collector items (source_id is not null), admins and consumers are never touched.
-- Refused with pilot_not_ended before the end date, not_closing unless the outcome is close, participants_remaining while any consumer is
-- left (so it runs after the batches of WO-0158), invalid_limit unless p_limit is 1 to 100. Re-running changes nothing.
-- security definer, search_path = '', execute revoked from public, anon, authenticated and granted to service_role alone.
create function app.admin_end_pilot_vendors(p_admin uuid, p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw text := (select s.value from ops.settings s where s.key = 'pilot_end_date');
  v_end date;
  v_outcome text := (select s.value from ops.settings s where s.key = 'pilot_outcome');
  v_items bigint;
  v_users bigint := 0;
  v_remaining bigint;
  v_ids uuid[];
  v_emails text[];
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_end := case when v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_raw::date end;
  if v_end is null or current_date < v_end then
    raise exception 'pilot_not_ended' using errcode = '55000';
  end if;
  if v_outcome is distinct from 'close' then
    raise exception 'not_closing' using errcode = '55000';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if exists (select 1 from app.profiles p where p.role = 'consumer') then
    raise exception 'participants_remaining' using errcode = '55000';
  end if;

  -- 1. the vendors' feed items leave the consumer catalogue (the rows stay, withdrawn)
  update catalog.catalog_items ci set status = 'withdrawn' where ci.vendor_id is not null and ci.status <> 'withdrawn';
  get diagnostics v_items = row_count;

  -- 2. the vendor query log, in full
  delete from ops.vendor_query_log where true;

  -- 3. up to p_limit vendor users: invitation rows, the Auth audit-log entries that name them, then the auth.users rows
  select coalesce(array_agg(x.id), '{}'), coalesce(array_agg(lower(x.email)) filter (where x.email is not null and x.email <> ''), '{}')
    into v_ids, v_emails
    from (select p.id, u.email from app.profiles p left join auth.users u on u.id = p.id
           where p.role = 'vendor' order by p.id limit p_limit) x;
  if cardinality(v_ids) > 0 then
    delete from ops.invitations i where i.email = any (v_emails);
    delete from auth.users u where u.id = any (v_ids);
    get diagnostics v_users = row_count;
    delete from auth.audit_log_entries a
     where exists (select 1 from unnest(v_ids) d(id) where position(d.id::text in lower(a.payload::text)) > 0)
        or exists (select 1 from unnest(v_emails) e(addr) where position(e.addr in lower(a.payload::text)) > 0);
  end if;
  select count(*) into v_remaining from app.profiles p where p.role = 'vendor';

  perform app.write_admin_audit(p_admin, 'pilot.end_vendors', v_items::text || ':' || v_users::text || ':' || v_remaining::text);
  return jsonb_build_object('vendor_items_withdrawn', v_items, 'vendor_users_deleted', v_users, 'remaining', v_remaining);
end $$;

revoke execute on function app.admin_end_pilot_vendors(uuid, int) from public, anon, authenticated;
grant execute on function app.admin_end_pilot_vendors(uuid, int) to service_role;
