-- WO-0158 (R8a): the end of the pilot in the database (FR-69, BR-45; LLD 4.9, 6 /api/admin/settings and /api/admin/pilot/end, 13.4).
-- The routes of WO-0160 run as service_role, which has no grant on ops.settings, so they reach the pilot settings and the deletion of
-- participants only through the four functions below. Every function is security definer, pins search_path = '', and has execute revoked from
-- public, anon and authenticated; the four admin functions are granted to service_role alone, ops.delete_participant to nobody.
--
-- Files (spec QC finding 1): the database removes storage object ROWS, not file bytes. The route purges a participant's files through the
-- Storage API first. So the batch function only marks the next participants and hands out their ids; a second function deletes ONE marked
-- participant. The deletion steps are one shared function, ops.delete_participant, used by this path and by the self-service
-- app.delete_my_account(), so the two cannot drift.
--
-- Who is deleted: only consumers (vendors and admins are never marked). Outcome `close`: every consumer. Outcome `continue`: every consumer
-- who has not accepted the CURRENT notice version (app.consent_records against ops.settings.current_notice_version). A consumer who accepts
-- the current notice after being marked is unmarked and kept, by the next batch call and again by the delete call (Re-check D).
-- "Today" is current_date of the database server (UTC on the hosted stack).

-- ---- 1. the per-user deletion, moved out of app.delete_my_account() --------------------------------------------------------------------
-- The body is the one of 20261106110300: storage object rows, the auth.users row, the Auth audit-log purge (also on the retry path), the
-- invitation row, and one count in ops.daily_counts. Returns 'deleted' or 'already_deleted'. Granted to no role at all.
create function ops.delete_participant(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_deleted boolean;
begin
  -- the user's storage objects go first (every bucket, any depth under their folder), also on the retry path. A trigger on storage.objects
  -- refuses direct deletes unless storage.allow_delete_query is 'true'; it is set for this transaction only and set back at once.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where (storage.foldername(o.name))[1] = p_user::text;
  perform set_config('storage.allow_delete_query', 'false', true);

  delete from auth.users u where u.id = p_user returning u.email into v_email;
  v_deleted := found;
  -- the Auth audit log names the user (id and address) in its payload. The id check also runs for a retry (no user, no address).
  delete from auth.audit_log_entries a
   where position(p_user::text in lower(a.payload::text)) > 0
      or (v_email is not null and v_email <> '' and position(lower(v_email) in lower(a.payload::text)) > 0);
  if not v_deleted then
    return 'already_deleted';
  end if;
  if v_email is not null then
    delete from ops.invitations i where i.email = lower(v_email);
  end if;
  insert into ops.daily_counts (day, metric, n) values (current_date, 'deletions', 1)
  on conflict (day, metric) do update set n = ops.daily_counts.n + 1;
  return 'deleted';
end $$;
revoke execute on function ops.delete_participant(uuid) from public, anon, authenticated, service_role;

-- app.delete_my_account(): same signature, owner and grants (create or replace keeps them), the same checks; only the tail is the call above.
create or replace function app.delete_my_account() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_raw text;
  v_window int;
  v_now numeric := extract(epoch from now());
  v_amr jsonb;
  v_fresh boolean;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.role into v_role from app.profiles p where p.id = v_uid;
  if v_role is not null and v_role <> 'consumer' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- F1: a primary sign-in within the window, read from the signed token's own amr claim
  select s.value into v_raw from ops.settings s where s.key = 'reauth_window_seconds';
  v_window := case when v_raw ~ '^[0-9]{1,6}$' then v_raw::int else 300 end;
  v_amr := (select auth.jwt()) -> 'amr';
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end) as e(entry)
    cross join lateral (select case when jsonb_typeof(e.entry) = 'object' and jsonb_typeof(e.entry -> 'method') = 'string'
                                     and jsonb_typeof(e.entry -> 'timestamp') = 'number' then e.entry ->> 'method' end as method,
                               case when jsonb_typeof(e.entry) = 'object' and jsonb_typeof(e.entry -> 'method') = 'string'
                                     and jsonb_typeof(e.entry -> 'timestamp') = 'number' then (e.entry ->> 'timestamp')::numeric end as ts) c
    where c.method in ('password', 'otp', 'oauth', 'magiclink', 'sso/saml')
      and c.ts between v_now - v_window and v_now + 60) into v_fresh;
  if not coalesce(v_fresh, false) then
    raise exception 'reauthentication_required' using errcode = '42501', hint = 'Sign in again with your password, then retry.';
  end if;

  if v_role is null and exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'forbidden' using errcode = '42501';   -- an account without a profile row cannot be shown to be a consumer
  end if;

  return ops.delete_participant(v_uid);
end $$;

-- ---- 2. the setter ---------------------------------------------------------------------------------------------------------------------
-- Writes pilot_end_date and pilot_outcome. The outcome is `close` or `continue`. A date before today is refused only when the call CHANGES
-- the stored date, so the outcome alone can be changed at any time, also after the end date. One audit row: the action and the new values
-- (date:outcome), never an email.
create function app.admin_set_pilot_end(p_admin uuid, p_end_date date, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old_raw text;
  v_old date;
  v_text text;
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('close', 'continue') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_end_date is null then
    raise exception 'invalid_end_date' using errcode = '22023';
  end if;
  perform 1 from ops.settings s where s.key in ('pilot_end_date', 'pilot_outcome') order by s.key for update;
  select s.value into v_old_raw from ops.settings s where s.key = 'pilot_end_date';
  v_old := case when v_old_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_old_raw::date end;
  if v_old is distinct from p_end_date and p_end_date < current_date then
    raise exception 'invalid_end_date' using errcode = '22023';
  end if;
  v_text := to_char(p_end_date, 'YYYY-MM-DD');
  insert into ops.settings (key, value) values ('pilot_end_date', v_text), ('pilot_outcome', p_outcome)
  on conflict (key) do update set value = excluded.value;
  perform app.write_admin_audit(p_admin, 'pilot.set_end', v_text || ':' || p_outcome);
  return jsonb_build_object('pilot_end_date', v_text, 'pilot_outcome', p_outcome);
end $$;

-- ---- 3. the preview (read-only) --------------------------------------------------------------------------------------------------------
-- {consumers_to_delete, unused_invitations, vendor_users} for the current outcome: `close` counts every consumer and every vendor user;
-- `continue` counts the consumers without the current notice and no vendor user (nothing vendor-side changes). With no outcome set the
-- counts are those of `close` (the upper bound) and `outcome_unset` is true. It takes no user id and returns no row, only counts.
create function app.admin_end_pilot_preview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_outcome text := (select s.value from ops.settings s where s.key = 'pilot_outcome');
  v_notice text := (select s.value from ops.settings s where s.key = 'current_notice_version');
  v_consumers bigint;
  v_vendors bigint;
  v_invitations bigint;
begin
  select count(*) into v_consumers from app.profiles p
   where p.role = 'consumer'
     and (v_outcome is distinct from 'continue'
          or not exists (select 1 from app.consent_records c where c.user_id = p.id and c.notice_version = v_notice));
  select count(*) into v_vendors from app.profiles p where p.role = 'vendor' and v_outcome is distinct from 'continue';
  select count(*) into v_invitations from ops.invitations i where i.accepted_at is null;
  return jsonb_build_object('consumers_to_delete', v_consumers, 'unused_invitations', v_invitations, 'vendor_users', v_vendors)
      || case when v_outcome in ('close', 'continue') then '{}'::jsonb else jsonb_build_object('outcome_unset', true) end;
end $$;

-- ---- 4. the batch: mark the next participants and hand out their ids ----------------------------------------------------------------------
-- Refused with pilot_not_ended before pilot_end_date (or with no date) and with outcome_unset while no outcome is set; p_limit is 1 to 100.
-- Under `continue`, a consumer who is marked but has accepted the current notice since is unmarked first. Then up to p_limit selectable
-- consumers are picked, the ones already marked first, and marked (deleting = true, deletion_requested_at = now(); an existing mark keeps its time).
-- Returns {user_ids, remaining, done, invitations_deleted}: remaining counts the selectable consumers not in this batch; done is true (with the
-- unused invitations deleted) only when nothing was selected and nothing remains. One audit row with the count. With `continue` and an empty
-- current_notice_version it raises notice_unset.
create function app.admin_end_pilot_next(p_admin uuid, p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw text := (select s.value from ops.settings s where s.key = 'pilot_end_date');
  v_end date;
  v_outcome text := (select s.value from ops.settings s where s.key = 'pilot_outcome');
  v_notice text := (select s.value from ops.settings s where s.key = 'current_notice_version');
  v_ids uuid[];
  v_remaining bigint;
  v_inv bigint := 0;
  v_done boolean := false;
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_end := case when v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_raw::date end;
  if v_end is null or current_date < v_end then
    raise exception 'pilot_not_ended' using errcode = '55000';
  end if;
  if v_outcome is null or v_outcome not in ('close', 'continue') then
    raise exception 'outcome_unset' using errcode = '55000';
  end if;
  if v_outcome = 'continue' and coalesce(v_notice, '') = '' then
    raise exception 'notice_unset' using errcode = '55000';   -- no current notice version: the rule cannot be applied, so nothing is selected
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  if v_outcome = 'continue' then
    update app.profiles p set deleting = false, deletion_requested_at = null
     where p.role = 'consumer' and p.deleting
       and exists (select 1 from app.consent_records c where c.user_id = p.id and c.notice_version = v_notice);
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select p.id from app.profiles p
     where p.role = 'consumer'
       and (v_outcome = 'close'
            or not exists (select 1 from app.consent_records c where c.user_id = p.id and c.notice_version = v_notice))
     order by p.deleting desc, p.deletion_requested_at nulls last, p.id
     limit p_limit) x;
  update app.profiles p set deleting = true, deletion_requested_at = now()
   where p.id = any (v_ids) and not p.deleting;
  select count(*) into v_remaining from app.profiles p
   where p.role = 'consumer' and p.id <> all (v_ids)
     and (v_outcome = 'close'
          or not exists (select 1 from app.consent_records c where c.user_id = p.id and c.notice_version = v_notice));

  perform app.write_admin_audit(p_admin, 'pilot.end_next', cardinality(v_ids)::text);
  -- nothing selected and nothing remaining: the end is complete, also when no marked consumer was left for the delete call to finish on
  -- (everyone accepted the notice under continue, or the last one left by self-service). Same done step as in app.admin_end_pilot_delete:
  -- the unused invitations go, and one pilot.end_done audit row is written when any were deleted. A repeat call deletes nothing more and
  -- writes no second end_done row.
  if cardinality(v_ids) = 0 and v_remaining = 0 then
    v_done := true;
    delete from ops.invitations i where i.accepted_at is null;
    get diagnostics v_inv = row_count;
    if v_inv > 0 then
      perform app.write_admin_audit(p_admin, 'pilot.end_done', v_inv::text);
    end if;
  end if;
  return jsonb_build_object('user_ids', to_jsonb(v_ids), 'remaining', v_remaining, 'done', v_done, 'invitations_deleted', v_inv);
end $$;

-- ---- 5. delete ONE marked participant ----------------------------------------------------------------------------------------------------
-- Refused with not_marked unless the pilot has ended, an outcome is set, and the user is a consumer marked by the batch. The route has
-- purged the user's files before it calls this. Under `continue` the selection rule is applied again: a marked user who has accepted the
-- current notice since is unmarked and NOT deleted. When no selectable consumer is left, every ops.invitations row with a null accepted_at
-- is deleted (used ones are kept), and one pilot.end_done audit row is written when any were deleted. app.admin_end_pilot_next runs the same step when nothing is selected. Returns {deleted, unmarked, done, invitations_deleted}.
create function app.admin_end_pilot_delete(p_admin uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw text := (select s.value from ops.settings s where s.key = 'pilot_end_date');
  v_end date;
  v_outcome text := (select s.value from ops.settings s where s.key = 'pilot_outcome');
  v_notice text := (select s.value from ops.settings s where s.key = 'current_notice_version');
  v_marked uuid;
  v_deleted boolean := false;
  v_unmarked boolean := false;
  v_done boolean := false;
  v_inv bigint := 0;
begin
  if p_admin is null or not exists (select 1 from app.profiles p where p.id = p_admin and p.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_end := case when v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_raw::date end;
  if v_end is null or current_date < v_end or v_outcome is null or v_outcome not in ('close', 'continue') then
    raise exception 'not_marked' using errcode = '55000';
  end if;
  if v_outcome = 'continue' and coalesce(v_notice, '') = '' then
    raise exception 'notice_unset' using errcode = '55000';
  end if;
  select p.id into v_marked from app.profiles p where p.id = p_user and p.role = 'consumer' and p.deleting for update;
  if v_marked is null then
    raise exception 'not_marked' using errcode = '55000';
  end if;

  if v_outcome = 'continue'
     and exists (select 1 from app.consent_records c where c.user_id = p_user and c.notice_version = v_notice) then
    update app.profiles p set deleting = false, deletion_requested_at = null where p.id = p_user;
    v_unmarked := true;
  else
    perform ops.delete_participant(p_user);
    v_deleted := true;
  end if;

  if not exists (
       select 1 from app.profiles p
        where p.role = 'consumer'
          and (v_outcome = 'close'
               or not exists (select 1 from app.consent_records c where c.user_id = p.id and c.notice_version = v_notice))) then
    v_done := true;
    delete from ops.invitations i where i.accepted_at is null;
    get diagnostics v_inv = row_count;
    if v_inv > 0 then
      perform app.write_admin_audit(p_admin, 'pilot.end_done', v_inv::text);
    end if;
  end if;
  return jsonb_build_object('deleted', v_deleted, 'unmarked', v_unmarked, 'done', v_done, 'invitations_deleted', v_inv);
end $$;

revoke execute on function app.admin_set_pilot_end(uuid, date, text), app.admin_end_pilot_preview(), app.admin_end_pilot_next(uuid, int),
  app.admin_end_pilot_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function app.admin_set_pilot_end(uuid, date, text), app.admin_end_pilot_preview(), app.admin_end_pilot_next(uuid, int),
  app.admin_end_pilot_delete(uuid, uuid) to service_role;
