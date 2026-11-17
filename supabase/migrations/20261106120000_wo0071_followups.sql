-- WO-0071 (R5b) follow-ups from the WO-0070 security review. No table or policy changes.
--
-- 1. app.is_recent_sign_in(): the account storage purge route (/api/account/purge-storage) must refuse to delete files unless the caller could
--    also pass app.delete_my_account()'s re-authentication check; otherwise a stale session could destroy files and then fail to leave. The
--    check is the same as the one inside delete_my_account (primary method in the token's own amr claim, timestamp inside the window of
--    ops.settings.reauth_window_seconds, default 300, at most 60 seconds in the future). It is a separate copy because delete_my_account is
--    not changed here; pgTAP 008 runs every refused and accepted token of the deletion tests through both and requires the same answer.
-- 2. MINOR-1, MINOR-5: comments that said more than the database does are replaced with exact ones (COMMENT ON, so the earlier migration files
--    stay as they were committed).

create function app.is_recent_sign_in() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw text;
  v_window int;
  v_now numeric := extract(epoch from now());
  v_amr jsonb;
  v_fresh boolean;
begin
  if v_uid is null then
    return false;
  end if;
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
  return coalesce(v_fresh, false);
end $$;
revoke execute on function app.is_recent_sign_in() from public, anon;
grant execute on function app.is_recent_sign_in() to authenticated;
comment on function app.is_recent_sign_in() is
  'WO-0071: true when the caller''s token proves a primary sign-in inside the re-authentication window; the same test as app.delete_my_account() (pgTAP 008 requires equal answers). Used by the account storage purge route before it deletes any file.';

comment on function app.jobs_state_machine() is
  'WO-0070: the job status machine. A BEFORE INSERT OR UPDATE row trigger, so it runs for every role that writes through a normal session: authenticated, worker_role, the secret-key client (service_role) and the table owner. It does NOT run when session_replication_role is replica (a superuser setting used by logical replication and some restore tools), because the trigger is in the default ENABLE state, not ENABLE ALWAYS; those paths are not used by the application.';
comment on trigger jobs_state_machine on app.jobs is
  'WO-0070: status machine (see app.jobs_state_machine()). Skipped only under session_replication_role = replica, which only a superuser can set.';

comment on role worker_role is
  'WO-0070: the limited worker login (LLD 7.1). Created without a password; set outside the repository. It is a member of no role. Its creator (postgres on the local stack) holds ADMIN membership of it without INHERIT and without SET (pg_auth_members), and a superuser can always switch to any role; no other role, and none of the API roles (authenticator, anon, authenticated, service_role), is a member of it.';
