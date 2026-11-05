-- WO-0041 migration 6: helper functions (LLD 4.5), the onboarding and acceptance RPCs and the sign-up trigger (4.5, 4.9),
-- and the triggers of 4.2 to 4.4. Every function sets search_path = '' and schema-qualifies what it uses. Every function
-- is revoked from PUBLIC first, then granted explicitly. Trigger functions are granted to nobody: a trigger needs no
-- execute privilege at fire time, and they cannot be called as RPC.

-- ---- policy helpers ----------------------------------------------------------------------------------------------------
create function app.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from app.profiles p where p.id = (select auth.uid()) $$;

-- Eligible participant (LLD 4.5, extended by 4.9): pilot notice accepted at the current version; Terms and Privacy Policy
-- accepted at their current versions; age confirmed; country on the supported list. False for an unknown user.
create function ops.is_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.age_confirmed
       and p.country is not null
       and p.country::text = any (string_to_array((select s.value from ops.settings s where s.key = 'supported_countries'), ','))
       and exists (select 1 from app.consent_records c where c.user_id = p.id
                   and c.notice_version = (select s.value from ops.settings s where s.key = 'current_notice_version'))
       and exists (select 1 from app.document_acceptances d where d.user_id = p.id and d.document = 'terms'
                   and d.version = (select s.value from ops.settings s where s.key = 'current_terms_version'))
       and exists (select 1 from app.document_acceptances d where d.user_id = p.id and d.document = 'privacy_policy'
                   and d.version = (select s.value from ops.settings s where s.key = 'current_privacy_version'))
    from app.profiles p where p.id = p_user), false) $$;

-- The consent gate used by every consumer policy. Answers only for the caller; false for everyone in maintenance mode.
create function app.has_consent() returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.is_eligible((select auth.uid()))
     and coalesce((select s.value from ops.settings s where s.key = 'maintenance'), 'off') <> 'on' $$;

create function app.supported_countries() returns text[]
language sql stable security definer set search_path = '' as $$
  select string_to_array(s.value, ',') from ops.settings s where s.key = 'supported_countries' $$;

create function app.public_setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select s.value from ops.settings s
  where s.key = p_key
    and p_key in ('current_notice_version', 'current_terms_version', 'current_privacy_version',
                  'current_vendor_agreement_version', 'maintenance', 'pilot_end_date', 'pilot_outcome') $$;

revoke execute on function ops.is_eligible(uuid), app.current_role(), app.has_consent(), app.supported_countries(),
  app.public_setting(text) from public, anon, authenticated;
grant execute on function app.current_role(), app.has_consent(), app.public_setting(text) to authenticated;
grant execute on function app.supported_countries() to anon, authenticated;   -- the sign-up page shows the list (FR-8)

-- ---- RPCs (security definer: they write columns and tables the client cannot) -----------------------------------------
-- LLD 4.9: the Terms and Privacy Policy tick. Raises stale_version / age_not_confirmed; sets profiles.age_confirmed.
create function app.accept_documents(p_terms_version text, p_privacy_version text, p_age_confirmed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_terms text := (select s.value from ops.settings s where s.key = 'current_terms_version');
  v_privacy text := (select s.value from ops.settings s where s.key = 'current_privacy_version');
begin
  if v_uid is null or not exists (select 1 from app.profiles p where p.id = v_uid and p.role = 'consumer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_terms is null or v_privacy is null or p_terms_version is distinct from v_terms or p_privacy_version is distinct from v_privacy then
    raise exception 'stale_version';
  end if;
  if p_age_confirmed is not true then
    raise exception 'age_not_confirmed';
  end if;
  insert into app.document_acceptances (user_id, document, version)
  values (v_uid, 'terms', v_terms), (v_uid, 'privacy_policy', v_privacy)
  on conflict do nothing;
  update app.profiles set age_confirmed = true where id = v_uid;
end $$;

-- LLD 4.9: stores the caller's country, hemisphere, currency and occasions; 'unsupported_country' keeps the declared country.
create function app.complete_onboarding(p_country text, p_hemisphere text, p_currency text, p_occasions text[] default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_country text := upper(p_country);
  v_currency text := upper(p_currency);
begin
  if v_uid is null or not exists (select 1 from app.profiles p where p.id = v_uid and p.role = 'consumer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_country is null or v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country'; end if;
  if p_hemisphere is null or p_hemisphere not in ('north', 'south') then raise exception 'invalid_hemisphere'; end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  update app.profiles
     set country = v_country, hemisphere = p_hemisphere, currency = v_currency, occasions = coalesce(p_occasions, '{}')
   where id = v_uid;
  if v_country = any (coalesce(app.supported_countries(), '{}'::text[])) then return 'ok'; end if;
  return 'unsupported_country';
end $$;

revoke execute on function app.accept_documents(text, text, boolean), app.complete_onboarding(text, text, text, text[])
  from public, anon, authenticated;
grant execute on function app.accept_documents(text, text, boolean), app.complete_onboarding(text, text, text, text[]) to authenticated;

-- ---- sign-up trigger (LLD 4.5): creates the profile, marks the invitation, counts the sign-up. Never refuses a sign-up. ----
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.profiles (id) values (new.id) on conflict (id) do nothing;
  update ops.invitations set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  insert into ops.daily_counts (day, metric, n) values (current_date, 'signups', 1)
  on conflict (day, metric) do update set n = ops.daily_counts.n + 1;
  return new;
end $$;
revoke execute on function app.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- ---- row triggers ------------------------------------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- LLD 4.2: seasons and occasions arrays hold only codes of lk_season / lk_occasion (arrays cannot carry foreign keys)
create function app.check_taxonomy_arrays() returns trigger language plpgsql set search_path = '' as $$
declare j jsonb := to_jsonb(new);
begin
  if jsonb_typeof(j->'seasons') = 'array' and exists (
       select 1 from jsonb_array_elements_text(j->'seasons') v(x) where x is null or x not in (select code from catalog.lk_season)) then
    raise exception 'unknown season in seasons' using errcode = '23514';
  end if;
  if jsonb_typeof(j->'occasions') = 'array' and exists (
       select 1 from jsonb_array_elements_text(j->'occasions') v(x) where x is null or x not in (select code from catalog.lk_occasion)) then
    raise exception 'unknown occasion in occasions' using errcode = '23514';
  end if;
  return new;
end $$;

-- Defence in depth for the column grants of migration 7: only the server roles may change these profile columns.
create function app.protect_profile_columns() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') and (
        new.id is distinct from old.id or new.role is distinct from old.role
     or new.age_confirmed is distinct from old.age_confirmed or new.deleting is distinct from old.deleting
     or new.deletion_requested_at is distinct from old.deletion_requested_at or new.created_at is distinct from old.created_at) then
    raise exception 'protected profile column' using errcode = '42501';
  end if;
  return new;
end $$;

-- FR-51: archiving an item flags every outfit that contains it
create function app.flag_outfits_on_archive() returns trigger language plpgsql set search_path = '' as $$
begin
  update app.outfits o set needs_attention = true
   where o.user_id = new.user_id and not o.needs_attention
     and o.id in (select oi.outfit_id from app.outfit_items oi where oi.item_id = new.id);
  return null;
end $$;

-- LLD 4.4: only active items can be added to an outfit
create function app.check_outfit_item_active() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from app.items i where i.id = new.item_id and i.status = 'active') then
    raise exception 'item_not_active' using errcode = '23514';
  end if;
  return new;
end $$;

-- LLD 4.4: an item_features row must carry the same user_id as its item (an item of another user is invisible to the caller
-- and, for any role that can see it, fails the comparison)
create function app.check_item_features_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from app.items i where i.id = new.item_id and i.user_id = new.user_id) then
    raise exception 'item_features must belong to the owner of the item' using errcode = '23503';
  end if;
  return new;
end $$;

revoke execute on function app.touch_updated_at(), app.check_taxonomy_arrays(), app.protect_profile_columns(),
  app.flag_outfits_on_archive(), app.check_outfit_item_active(), app.check_item_features_owner() from public, anon, authenticated;

create trigger profiles_protect before update on app.profiles for each row execute function app.protect_profile_columns();
create trigger profiles_taxonomy before insert or update on app.profiles for each row execute function app.check_taxonomy_arrays();
create trigger items_taxonomy before insert or update on app.items for each row execute function app.check_taxonomy_arrays();
create trigger wishlist_entries_taxonomy before insert or update on app.wishlist_entries for each row execute function app.check_taxonomy_arrays();
create trigger outfits_taxonomy before insert or update on app.outfits for each row execute function app.check_taxonomy_arrays();

create trigger items_colour before insert or update on app.items for each row execute function catalog.set_colour_fields();
create trigger wishlist_entries_colour before insert or update on app.wishlist_entries for each row execute function catalog.set_colour_fields();

create trigger items_touch before update on app.items for each row execute function app.touch_updated_at();
create trigger item_features_touch before update on app.item_features for each row execute function app.touch_updated_at();
create trigger collections_touch before update on app.collections for each row execute function app.touch_updated_at();
create trigger purchases_touch before update on app.purchases for each row execute function app.touch_updated_at();
create trigger wishlist_entries_touch before update on app.wishlist_entries for each row execute function app.touch_updated_at();
create trigger outfits_touch before update on app.outfits for each row execute function app.touch_updated_at();

create trigger items_archive_flag after update of status on app.items for each row
  when (new.status = 'archived' and old.status is distinct from 'archived') execute function app.flag_outfits_on_archive();
create trigger outfit_items_active before insert or update of item_id on app.outfit_items for each row execute function app.check_outfit_item_active();
create trigger item_features_owner before insert or update on app.item_features for each row execute function app.check_item_features_owner();
