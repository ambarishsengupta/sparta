-- WO-0110 (R7a fix loop 1) migration 2: the query log holds no participant data (LLD 5.7). p_filter_value and p_category reached ops.vendor_query_log as free
-- text (up to 100 characters) whenever they were well formed but matched nothing. The one guard now checks them against the allowlists BEFORE it logs and
-- raises invalid_dimension for anything else. Order stays: role, agreement, maintenance, allowlists, log. Values are the ones the cube can hold
-- (build_facts): size is 'system:code' of catalog.lk_size, 'Other' or 'Unknown'; season is a lk_season code or 'Multi-season'; price band is a lk_price_band code (the list includes 'Unknown'); region is
-- 'Unknown' or a lk_region code; a category is a lk_category code. Nothing else is accepted, so an invented name or an email never reaches the log.
create or replace function analytics_private.vendor_guard(p_fn text, p_params jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_fd text := p_params->>'filter_dim'; v_fv text := p_params->>'filter_value'; v_cat text := p_params->>'category';
begin
  if (select app.current_role()) is distinct from 'vendor' then raise exception 'forbidden' using errcode = '42501'; end if;   -- a caller with no profile has a null role
  if not exists (select 1 from catalog.vendor_agreement_acceptances a where a.user_id = (select auth.uid())
                 and a.version = (select s.value from ops.settings s where s.key = 'current_vendor_agreement_version')) then
    raise exception 'agreement_required';
  end if;
  if coalesce((select s.value from ops.settings s where s.key = 'maintenance'), 'on') <> 'off' then raise exception 'maintenance'; end if;
  if v_fv is not null and not coalesce(case v_fd
       when 'size' then v_fv in ('Other', 'Unknown') or exists (select 1 from catalog.lk_size z where z.size_system || ':' || z.code = v_fv)
       when 'season' then v_fv = 'Multi-season' or exists (select 1 from catalog.lk_season z where z.code = v_fv)
       when 'price_band' then exists (select 1 from catalog.lk_price_band z where z.code = v_fv)
       when 'region' then v_fv = 'Unknown' or exists (select 1 from catalog.lk_region z where z.code = v_fv) end, false)
     or v_cat is not null and not exists (select 1 from catalog.lk_category z where z.code = v_cat) then
    raise exception 'invalid_dimension';
  end if;
  perform analytics.log_and_limit(p_fn, p_params);
end $$;
revoke execute on function analytics_private.vendor_guard(text, jsonb) from public, anon, authenticated, service_role;
