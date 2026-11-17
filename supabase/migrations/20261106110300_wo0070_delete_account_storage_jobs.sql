-- WO-0070 (R5b): app.delete_my_account() also deletes the caller's storage objects and (by cascade) their jobs. Everything else is the
-- WO-0062 function unchanged: same signature, owner and grants (create or replace keeps them), the same re-authentication proof from the signed
-- token's amr claim, the same refusal of non-consumers and of an auth user without a profile row, the same Auth audit-log purge (also on the
-- retry), the same 'already_deleted' answer and the same single count in ops.daily_counts. The storage delete sits after the checks and before
-- the auth.users delete, and runs on the retry path too, so an interrupted deletion that left objects behind is finished by the next call.

create or replace function app.delete_my_account() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_email text;
  v_raw text;
  v_window int;
  v_now numeric := extract(epoch from now());
  v_amr jsonb;
  v_fresh boolean;
  v_deleted boolean;
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

  -- WO-0070: the caller's storage objects go first (every bucket, any depth under their folder), also on the retry path. A trigger on
  -- storage.objects refuses direct deletes unless storage.allow_delete_query is 'true'; it is set for this transaction only and set back
  -- at once. This removes the object ROWS; whether the stored file bytes go too is a gap documented in the evidence notes (the Storage API
  -- deletes bytes, SQL cannot). The caller's jobs go with the auth.users row below: app.jobs references app.profiles on delete cascade.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where (storage.foldername(o.name))[1] = v_uid::text;
  perform set_config('storage.allow_delete_query', 'false', true);

  delete from auth.users u where u.id = v_uid returning u.email into v_email;
  v_deleted := found;
  -- F2: the Auth audit log names the user (id and address) in its payload. The id check also runs for a retry (no user, no address).
  delete from auth.audit_log_entries a
   where position(v_uid::text in lower(a.payload::text)) > 0
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
