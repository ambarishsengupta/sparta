-- WO-0062 (R2c fix loop 1): app.delete_my_account() learns three things.
--   F1  The database checks for itself that the caller signed in recently. The page asks for the password again, but a script holding a
--       stolen or stale access token (an hour long) could call the function directly. GoTrue puts `amr`, a list of {method, timestamp}
--       entries, into every access token it signs; `timestamp` is the second of the primary sign-in and is kept when the token is refreshed.
--       The function refuses with `reauthentication_required` unless an entry with a primary method (password, otp, oauth, magiclink,
--       sso/saml) is not older than the window `reauth_window_seconds` in ops.settings (seeded 300; a missing or non-numeric value means 300)
--       and not more than 60 seconds in the future. The claim is read at the top level of the signed token only, never from user_metadata,
--       which the person can edit. Every malformed shape (no amr, not a list, entries that are not objects, a method that is not text, a
--       timestamp that is not a JSON number) is a refusal, never an error from a cast.
--   F2  Supabase Auth keeps an audit log (auth.audit_log_entries) whose payload holds the e-mail address and the user id. The same
--       transaction now removes every entry whose payload text contains the caller's id or the caller's e-mail address (any case). That is a
--       plain substring test on purpose: a deletion must not leave the address behind, and the cost is that an entry that mentions a longer
--       address ending in this one (joann@x.test for ann@x.test) goes too. The hosted setting that switches this log off still has to be verified at deployment (NOTES).
--   F8  A caller whose auth user exists but who has no profile row is refused (fail closed): such a person cannot be shown to be a consumer.
--       A token for a user that no longer exists still answers `already_deleted` (a retry after a success). export_my_data() already refuses
--       a caller without a consumer profile; 008 now tests that too.
-- Same signature, owner, grants and security definer as before (create or replace keeps owner and grants).

insert into ops.settings (key, value) values ('reauth_window_seconds', '300') on conflict (key) do nothing;

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
