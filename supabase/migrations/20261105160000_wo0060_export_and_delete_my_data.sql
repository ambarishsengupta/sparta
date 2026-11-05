-- WO-0060 (R2c): data rights in the database. app.export_my_data() (FR-62) and app.delete_my_account() (FR-63, FR-66), and
-- `not deleting` in the eligibility test. Cascade audit result: every app table already reaches auth.users through a chain of
-- ON DELETE CASCADE keys (app.profiles.id -> auth.users.id, every other table -> app.profiles or its parent), so no table
-- needs a new cascade; 008_data_rights.test.sql proves it from the catalog and a new table without a chain fails there.
--
-- Both functions are security definer with the empty search_path, callable by `authenticated` only, and refuse every caller who
-- is not a consumer. They are definer (not invoker) on purpose: a participant who fails the consent gate (stale notice after a
-- version change, unsupported country, maintenance mode, `deleting` set) sees no rows of the gated tables through RLS, but must
-- still be able to export and delete everything (FR-4, FR-9, LLD 4.9). Each function acts on auth.uid() and nothing else.

-- A participant whose deletion has started is not an eligible participant (NOTES.md R2a, LATER). The only change is the extra
-- `not p.deleting`; the signature, owner and grants are unchanged (create or replace keeps them).
create or replace function ops.is_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.age_confirmed
       and not p.deleting
       and p.country is not null
       and p.country::text = any (string_to_array((select s.value from ops.settings s where s.key = 'supported_countries'), ','))
       and exists (select 1 from app.consent_records c where c.user_id = p.id
                   and c.notice_version = (select s.value from ops.settings s where s.key = 'current_notice_version'))
       and exists (select 1 from app.document_acceptances d where d.user_id = p.id and d.document = 'terms'
                   and d.version = (select s.value from ops.settings s where s.key = 'current_terms_version'))
       and exists (select 1 from app.document_acceptances d where d.user_id = p.id and d.document = 'privacy_policy'
                   and d.version = (select s.value from ops.settings s where s.key = 'current_privacy_version'))
    from app.profiles p where p.id = p_user), false) $$;

-- ---- export -----------------------------------------------------------------------------------------------------------------
-- One jsonb document: format_version, generated_at, account (id, email, created_at from auth.users), and one key per table of
-- the app schema holding the caller's rows (the owner column is id on profiles and user_id elsewhere). The table list comes
-- from the catalog, so a table added later is exported automatically; a table with no owner column raises
-- export_uncovered_table instead of being silently left out (the pgTAP suite fails on it first). Rows are sorted by their
-- JSON text so the output is stable. Every table name is quoted with %I from pg_class; the only value is the caller's id.
create function app.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
  v_rows jsonb;
  v_col text;
  t record;
begin
  if v_uid is null or not exists (select 1 from app.profiles p where p.id = v_uid and p.role = 'consumer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_out := jsonb_build_object(
    'format_version', 1,
    'generated_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at) from auth.users u where u.id = v_uid));
  for t in select c.oid, c.relname::text as tbl from pg_class c
           where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p') order by c.relname loop
    v_col := case when t.tbl = 'profiles' then 'id' else 'user_id' end;
    if not exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = v_col and a.attnum > 0 and not a.attisdropped) then
      raise exception 'export_uncovered_table: %', t.tbl;
    end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), %L::jsonb) from app.%I x where x.%I = $1',
                   '[]', t.tbl, v_col) into v_rows using v_uid;
    v_out := v_out || jsonb_build_object(t.tbl, v_rows);
  end loop;
  return v_out;
end $$;

-- ---- delete -----------------------------------------------------------------------------------------------------------------
-- Deletes the caller's auth.users row; every app row, session, refresh token and identity goes by cascade. Also removes the
-- caller's ops.invitations entry (FR-63 names it; it holds the email address). Counts the deletion in ops.daily_counts (a day
-- and a number, no user ID, no email). Returns 'deleted', or 'already_deleted' when no such user exists any more (a second call
-- with the same token), so a retry is harmless and counts once: the row delete and the count are one statement sequence in one
-- transaction, and a concurrent second call waits for the row lock and then finds nothing. Refuses anon (no execute grant, and
-- a null auth.uid() here) and any profile whose role is not consumer. It never accepts a user ID: only auth.uid() is deleted.
create function app.delete_my_account() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_email text;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select p.role into v_role from app.profiles p where p.id = v_uid;
  if v_role is not null and v_role <> 'consumer' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from auth.users u where u.id = v_uid returning u.email into v_email;
  if not found then
    return 'already_deleted';
  end if;
  if v_email is not null then
    delete from ops.invitations i where i.email = lower(v_email);
  end if;
  insert into ops.daily_counts (day, metric, n) values (current_date, 'deletions', 1)
  on conflict (day, metric) do update set n = ops.daily_counts.n + 1;
  return 'deleted';
end $$;

revoke execute on function app.export_my_data(), app.delete_my_account() from public, anon, authenticated;
grant execute on function app.export_my_data(), app.delete_my_account() to authenticated;
