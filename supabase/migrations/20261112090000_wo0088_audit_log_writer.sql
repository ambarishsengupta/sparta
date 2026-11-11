-- WO-0088 (R6c): the writer of ops.admin_audit_log (LLD 4.1: server routes reach `ops` only through security definer functions in `app` whose
-- execute is granted to service_role alone; LLD 6: every /api/admin/* call writes one audit row).
--
-- The caller is the secret-key client (service_role) after the route has checked the session and the admin role. This function does not trust that
-- check alone: it refuses an admin id that is not an admin profile, an action that is not a lower-case dotted word, and a target that is not a row id
-- or a count (no free text, no spaces, no at sign). It returns the new row id and nothing else, and never reads or returns the log.
create function app.write_admin_audit(p_admin uuid, p_action text, p_target text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_]{0,30}(\.[a-z][a-z0-9_]{0,30}){1,3}$' or length(p_action) > 64 then
    raise exception 'invalid_audit_action' using errcode = '22023';
  end if;
  if p_target is not null and p_target !~ '^[A-Za-z0-9_:+-]{1,64}$' then
    raise exception 'invalid_audit_target' using errcode = '22023';
  end if;
  insert into ops.admin_audit_log (admin_id, action, target) values (p_admin, p_action, p_target) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.write_admin_audit(uuid, text, text) from public, anon, authenticated;
grant execute on function app.write_admin_audit(uuid, text, text) to service_role;
