-- WO-0080 (R6a) migration 3: app.wishlist_bought (FR-35) and app.confirm_receipt (FR-44, LLD 9.4), with the two small builders they share.
--
-- All four functions are SECURITY INVOKER with the empty search_path: they run with the caller's rights, so RLS and the consent gate decide
-- everything (another user's entry, job or receipt simply is not visible), and every write is one statement sequence in the caller's
-- transaction: any failure leaves nothing behind. Validation failures raise a FIXED message and never echo the input: a data or integrity
-- error from deeper down (a bad cast, an unknown category, a missing colour) is caught and replaced by 'invalid_input' / 'invalid_lines'.
-- Permission errors (42501) pass through untouched; their text names a table, never a value.
--
-- Decisions for the app (WO-0081, WO-0091):
--  * the builders are executable by `authenticated` only because an invoker function must be callable by its caller; they do what a direct
--    insert already allows;
--  * a receipt line's `amount` is the printed LINE total; the purchase it creates stores the unit price round(amount / qty, 2) and quantity qty,
--    so "spend" = price * quantity everywhere; the receipt's `total` is the sum of the confirmed lines' amounts;
--  * a line may carry store, date and currency (the draft's header values); missing ones come from the job's result, then (currency) the job's input.

-- ---- builders -------------------------------------------------------------------------------------------------------------------------
create function app.insert_item_from_json(p_item jsonb, p_origin text, p_catalog uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_item) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_item) k where k <> all (array['name', 'category', 'sub_type', 'colour_r', 'colour_g', 'colour_b',
        'brand', 'fit', 'material', 'pattern', 'size_system', 'size_value', 'seasons', 'occasions', 'condition']))
     or char_length(coalesce(btrim(p_item ->> 'name'), '')) not between 1 and 200
     or char_length(coalesce(p_item ->> 'brand', '')) > 100 or char_length(coalesce(p_item ->> 'size_value', '')) > 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into app.items (user_id, catalog_item_id, name, category, sub_type, colour_r, colour_g, colour_b, brand, fit, material, pattern,
                         size_system, size_value, seasons, occasions, condition, origin)
  values ((select auth.uid()), p_catalog, btrim(p_item ->> 'name'), p_item ->> 'category', p_item ->> 'sub_type',
          (p_item ->> 'colour_r')::smallint, (p_item ->> 'colour_g')::smallint, (p_item ->> 'colour_b')::smallint,
          nullif(btrim(p_item ->> 'brand'), ''), p_item ->> 'fit', p_item ->> 'material', p_item ->> 'pattern',
          p_item ->> 'size_system', nullif(btrim(p_item ->> 'size_value'), ''),
          array(select jsonb_array_elements_text(p_item -> 'seasons')), array(select jsonb_array_elements_text(p_item -> 'occasions')),
          (p_item ->> 'condition')::smallint, p_origin)
  returning id into v_id;
  return v_id;
end $$;

create function app.insert_purchase_from_json(p_item uuid, p_purchase jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_purchase) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_purchase) k where k <> all (array['purchase_date', 'store', 'price', 'currency', 'quantity', 'notes']))
     or char_length(coalesce(p_purchase ->> 'store', '')) > 200 or char_length(coalesce(p_purchase ->> 'notes', '')) > 1000
     or (p_purchase ->> 'currency') !~ '^[A-Z]{3}$'
     or (p_purchase ->> 'price')::numeric < 0
     or coalesce((p_purchase ->> 'quantity')::int, 1) not between 1 and 999 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into app.purchases (user_id, item_id, purchase_date, store, price, currency, quantity, notes)
  values ((select auth.uid()), p_item, (p_purchase ->> 'purchase_date')::date, nullif(btrim(p_purchase ->> 'store'), ''),
          (p_purchase ->> 'price')::numeric, p_purchase ->> 'currency', coalesce((p_purchase ->> 'quantity')::int, 1), nullif(btrim(p_purchase ->> 'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---- FR-35: a wishlist entry becomes an item and a purchase -----------------------------------------------------------------------------
-- The item starts from the entry's attributes; p_item overrides them (same keys as the builder). Origin is `catalogue` when the entry came
-- from the catalogue, else `manual`. Returns the new item's id. entry_not_found covers a missing entry and another user's entry alike.
create function app.wishlist_bought(p_entry uuid, p_item jsonb, p_purchase jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  e app.wishlist_entries;
  v_item uuid;
begin
  select w.* into e from app.wishlist_entries w where w.id = p_entry and w.user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'entry_not_found';
  end if;
  if e.status <> 'open' then
    raise exception 'already_bought';
  end if;
  begin
    v_item := app.insert_item_from_json(
      jsonb_build_object('name', e.name, 'category', e.category, 'sub_type', e.sub_type, 'colour_r', e.colour_r, 'colour_g', e.colour_g,
                         'colour_b', e.colour_b, 'brand', e.brand, 'fit', e.fit, 'size_system', e.size_system, 'size_value', e.size_value,
                         'seasons', to_jsonb(e.seasons)) || coalesce(p_item, '{}'::jsonb),
      case when e.catalog_item_id is null then 'manual' else 'catalogue' end, e.catalog_item_id);
    perform app.insert_purchase_from_json(v_item, coalesce(p_purchase, '{}'::jsonb));
    update app.wishlist_entries w set status = 'bought' where w.id = e.id;
  exception when data_exception or integrity_constraint_violation then
    raise exception 'invalid_input' using errcode = '22023';
  end;
  return v_item;
end $$;

-- ---- FR-44: confirm a scanned receipt ---------------------------------------------------------------------------------------------------
-- p_lines is an array of 1 to 200 lines: {action: 'new' | 'match' | 'skip', qty, amount, catalog_item_id (match only), store, date, currency,
-- and the item keys of the builder}. new and match each create an item (origin `receipt`; `match` keeps catalog_item_id), a purchase and the
-- link; skip creates nothing. The job must be the caller's, type receipt, status done; the receipt is the caller's unconfirmed row whose
-- storage_path is the job's input path. All or nothing; a second call raises already_confirmed. Returns {receipt_id, items, purchases}.
create function app.confirm_receipt(p_job_id bigint, p_lines jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  j app.jobs;
  r app.receipts;
  ln jsonb;
  v_action text; v_cat uuid; v_qty int; v_amount numeric; v_item uuid; v_pur uuid;
  v_def_store text; v_def_date date; v_def_cur text;
  v_store text; v_date date; v_cur text;
  v_h_store text; v_h_date date; v_h_cur text; v_first boolean := true;
  v_total numeric := 0; v_items uuid[] := '{}'; v_purs uuid[] := '{}';
begin
  select x.* into j from app.jobs x where x.id = p_job_id and x.user_id = (select auth.uid()) and x.type = 'receipt';
  if not found then
    raise exception 'job_not_found';
  end if;
  if j.status <> 'done' then
    raise exception 'job_not_done';
  end if;
  select x.* into r from app.receipts x where x.user_id = (select auth.uid()) and x.storage_path = j.input ->> 'path' for update;
  if not found then
    raise exception 'receipt_not_found';
  end if;
  if r.confirmed_at is not null then
    raise exception 'already_confirmed';
  end if;
  begin
    if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
      raise exception 'invalid_lines' using errcode = '22023';
    end if;
    v_def_store := nullif(btrim(j.result ->> 'store'), '');
    v_def_date := (nullif(j.result ->> 'date', ''))::date;
    v_def_cur := coalesce(nullif(j.result ->> 'currency', ''), j.input ->> 'currency');
    for ln in select e from jsonb_array_elements(p_lines) e loop
      if jsonb_typeof(ln) is distinct from 'object' or (ln ->> 'action') is null or (ln ->> 'action') not in ('new', 'match', 'skip') then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_action := ln ->> 'action';
      continue when v_action = 'skip';
      v_cat := (ln ->> 'catalog_item_id')::uuid;
      if (v_action = 'match') is distinct from (v_cat is not null) or ln -> 'amount' is null or jsonb_typeof(ln -> 'amount') <> 'number' then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_qty := coalesce((ln ->> 'qty')::int, 1);
      v_amount := (ln ->> 'amount')::numeric;
      if v_qty not between 1 and 999 or v_amount < 0 then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_store := coalesce(nullif(btrim(ln ->> 'store'), ''), v_def_store);
      v_date := coalesce((ln ->> 'date')::date, v_def_date);
      v_cur := coalesce(ln ->> 'currency', v_def_cur);
      v_item := app.insert_item_from_json(ln - array['action', 'qty', 'amount', 'catalog_item_id', 'store', 'date', 'currency'], 'receipt', v_cat);
      v_pur := app.insert_purchase_from_json(v_item, jsonb_build_object('purchase_date', v_date, 'store', v_store,
                 'price', round(v_amount / v_qty, 2), 'currency', v_cur, 'quantity', v_qty));
      insert into app.purchase_receipts (purchase_id, receipt_id, user_id) values (v_pur, r.id, (select auth.uid()));
      v_items := v_items || v_item;
      v_purs := v_purs || v_pur;
      v_total := v_total + v_amount;
      if v_first then
        v_h_store := v_store; v_h_date := v_date; v_h_cur := v_cur; v_first := false;
      end if;
    end loop;
    update app.receipts x set store = case when v_first then v_def_store else v_h_store end,
                              receipt_date = case when v_first then v_def_date else v_h_date end,
                              currency = case when v_first then v_def_cur else v_h_cur end,
                              total = v_total, job_id = j.id, confirmed_at = now()
     where x.id = r.id;
  exception when data_exception or integrity_constraint_violation then
    raise exception 'invalid_lines' using errcode = '22023';
  end;
  return jsonb_build_object('receipt_id', r.id, 'items', to_jsonb(v_items), 'purchases', to_jsonb(v_purs));
end $$;

revoke execute on function app.insert_item_from_json(jsonb, text, uuid), app.insert_purchase_from_json(uuid, jsonb),
  app.wishlist_bought(uuid, jsonb, jsonb), app.confirm_receipt(bigint, jsonb) from public, anon;
grant execute on function app.insert_item_from_json(jsonb, text, uuid), app.insert_purchase_from_json(uuid, jsonb),
  app.wishlist_bought(uuid, jsonb, jsonb), app.confirm_receipt(bigint, jsonb) to authenticated;
