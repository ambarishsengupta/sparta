-- WO-0092 (R6a fix loop 1 for WO-0080): write-once receipt confirmation, finite prices, skip lines checked for unknown keys.
-- New migration only; the WO-0080 migrations are untouched. Functions are replaced with create or replace (same signatures, same grants).
--
--  * app.receipts.confirmed_at and job_id are write-once (a BEFORE UPDATE trigger, for every role including the owner and service_role).
--    The column grant on confirmed_at is KEPT: app.confirm_receipt is SECURITY INVOKER (RLS decides everything), so the caller needs update
--    on that column; it cannot be revoked without making the function a definer. Write-once is what stops a later clear or change.
--  * price and amount must be finite and not negative: NaN passes `< 0` and fits numeric(12,2), so the builders now refuse it explicitly,
--    and a CHECK on app.purchases.price backs them for direct inserts.
--  * skip lines are checked for unknown keys like every other line (WO-0080 NOTES: "any other key is refused").

-- ---- 1. write-once confirmed_at and job_id ---------------------------------------------------------------------------------------------
create function app.receipts_write_once() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
     or (old.job_id is not null and new.job_id is distinct from old.job_id) then
    raise exception 'receipt_write_once' using errcode = '55000';
  end if;
  return new;
end $$;
revoke execute on function app.receipts_write_once() from public, anon, authenticated;
create trigger receipts_write_once before update on app.receipts
  for each row execute function app.receipts_write_once();

-- ---- 2. finite, non-negative price -------------------------------------------------------------------------------------------------------
-- Rows written before this migration could (in theory) hold NaN or a negative price, because no check existed: the constraint is added
-- NOT VALID (it binds every new row at once) and validated here only when no existing row violates it.
alter table app.purchases add constraint purchases_price_finite_chk
  check (price is null or (price >= 0 and price < 'Infinity'::numeric)) not valid;
do $$ begin
  if not exists (select 1 from app.purchases p where not (p.price is null or (p.price >= 0 and p.price < 'Infinity'::numeric))) then
    alter table app.purchases validate constraint purchases_price_finite_chk;
  end if;
end $$;

create or replace function app.insert_purchase_from_json(p_item uuid, p_purchase jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_purchase) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_purchase) k where k <> all (array['purchase_date', 'store', 'price', 'currency', 'quantity', 'notes']))
     or char_length(coalesce(p_purchase ->> 'store', '')) > 200 or char_length(coalesce(p_purchase ->> 'notes', '')) > 1000
     or (p_purchase ->> 'currency') !~ '^[A-Z]{3}$'
     or (p_purchase ->> 'price')::numeric < 0
     or (p_purchase ->> 'price')::numeric >= 'Infinity'::numeric   -- refuses NaN (which sorts above Infinity) and both infinities' upper side
     or coalesce((p_purchase ->> 'quantity')::int, 1) not between 1 and 999 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into app.purchases (user_id, item_id, purchase_date, store, price, currency, quantity, notes)
  values ((select auth.uid()), p_item, (p_purchase ->> 'purchase_date')::date, nullif(btrim(p_purchase ->> 'store'), ''),
          (p_purchase ->> 'price')::numeric, p_purchase ->> 'currency', coalesce((p_purchase ->> 'quantity')::int, 1), nullif(btrim(p_purchase ->> 'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---- 3. confirm_receipt: finite amount, skip lines checked ------------------------------------------------------------------------------
-- Same body as WO-0080 migration 3 with two additions (marked). A JSON number cannot be NaN or infinite, so the amount check is defensive.
create or replace function app.confirm_receipt(p_job_id bigint, p_lines jsonb) returns jsonb
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
  -- a skip line may carry the line keys, the item keys and `text` (the draft's printed text); nothing else
  v_skip_keys constant text[] := array['action', 'qty', 'amount', 'catalog_item_id', 'store', 'date', 'currency', 'text',
    'name', 'category', 'sub_type', 'colour_r', 'colour_g', 'colour_b', 'brand', 'fit', 'material', 'pattern', 'size_system', 'size_value',
    'seasons', 'occasions', 'condition'];
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
      if v_action = 'skip' then
        -- WO-0092: a skip line is checked for unknown keys too
        if exists (select 1 from jsonb_object_keys(ln) k where k <> all (v_skip_keys)) then
          raise exception 'invalid_lines' using errcode = '22023';
        end if;
        continue;
      end if;
      v_cat := (ln ->> 'catalog_item_id')::uuid;
      if (v_action = 'match') is distinct from (v_cat is not null) or ln -> 'amount' is null or jsonb_typeof(ln -> 'amount') <> 'number' then
        raise exception 'invalid_lines' using errcode = '22023';
      end if;
      v_qty := coalesce((ln ->> 'qty')::int, 1);
      v_amount := (ln ->> 'amount')::numeric;
      -- WO-0092: the amount must be finite (NaN sorts above Infinity, so `>= Infinity` refuses both)
      if v_qty not between 1 and 999 or v_amount < 0 or v_amount >= 'Infinity'::numeric then
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
