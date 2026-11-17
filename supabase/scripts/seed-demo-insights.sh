#!/usr/bin/env bash
# LOCAL DEMO ONLY (WO-0102, Release 0). Loads a SYNTHETIC consumer panel into the LOCAL database so the vendor dashboard has real-looking numbers after a real
# `analytics.run_aggregation()`: 150 invented eligible consumers (panel-001@example.test .. panel-150@example.test, auth rows by SQL, NO password, they can not sign in)
# with items, wishlist entries (some from Wardrobe unlock, which never count) and purchases over the last six months, six brands, H&M leading and five INVENTED ones (also inserted into catalog.lk_brand
# as demo rows, codes demo-*), the one vendor `H&M` (the demo's only vendor, legal/HM-DEMO-DECISION.md; its row is only a name, no H&M customer or transaction row is used for any figure) with a member row and the current agreement accepted for vendor-demo@example.test (a
# passwordless profile with role vendor if no such user exists yet; the demo-data script of WO-0097 gives that account its password), and a local admin profile
# demo-admin@example.test (no password) that is recorded as the reviewer of one report for the current month, marked reviewed with a direct update as postgres.
# The sizes are chosen so that some segments stay under the minimum group size (Activewear 7 owners, Ethnic wear 9, one colour 8, one condition band 5) and show as hidden.
# Prices are in USD so no exchange rate row is needed; some items have no price (Unknown band). Nothing here is real. Never part of config.toml seeding, never run by a gate.
# Idempotent: rows have fixed ids (re-running updates the same rows and adds nothing; only the aggregation run row is added each time, it is the audit of the run).
#
#   bash supabase/scripts/seed-demo-insights.sh [DATABASE_URL]    # default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   bash supabase/scripts/seed-demo-insights.sh --counts          # prints the row counts of everything this script owns (for the idempotence check)
#   bash supabase/scripts/seed-demo-insights.sh --remove          # deletes the panel, the vendor, the admin, the report and the demo brands, then runs the aggregation again
# The URL may also come from SPARTA_DEMO_DB_URL. It is REFUSED unless its host is 127.0.0.1, localhost or [::1] (no query string, no other host).
# Uses psql when it is installed, else `docker exec` into the local stack's database container. Hard time limit: 120 seconds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
mode="seed"; case "${1:-}" in --remove) mode="remove"; shift;; --counts) mode="counts"; shift;; esac
url="${1:-${SPARTA_DEMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
if ! printf '%s' "$url" | grep -Eq '^postgres(ql)?://[^@/?#[:space:]]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'; then
  echo "seed-demo-insights: refusing to run: the database URL must point at 127.0.0.1, localhost or [::1] (no query string)." >&2; exit 2
fi
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
if command -v psql >/dev/null 2>&1; then run_psql() { timeout 120 psql "$url" -v ON_ERROR_STOP=1 -q -At; }
else run_psql() { timeout 120 docker exec -i "supabase_db_${project:-sparta}" psql -U postgres -v ON_ERROR_STOP=1 -q -At; }; fi

if [ "$mode" = "counts" ]; then
  run_psql <<'SQL'
select 'panel=' || (select count(*) from auth.users where email ~ '^panel-[0-9]{3}@example\.test$')
  || ' items=' || (select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email ~ '^panel-[0-9]{3}@example\.test$')
  || ' wishlist=' || (select count(*) from app.wishlist_entries w join auth.users u on u.id = w.user_id where u.email ~ '^panel-[0-9]{3}@example\.test$')
  || ' purchases=' || (select count(*) from app.purchases p join auth.users u on u.id = p.user_id where u.email ~ '^panel-[0-9]{3}@example\.test$')
  || ' brands=' || (select count(*) from catalog.lk_brand where code like 'demo-%')
  || ' vendors=' || (select count(*) from catalog.vendors where name = 'H&M')
  || ' members=' || (select count(*) from catalog.vendor_members m join catalog.vendors v on v.id = m.vendor_id where v.name = 'H&M')
  || ' acceptances=' || (select count(*) from catalog.vendor_agreement_acceptances a join catalog.vendors v on v.id = a.vendor_id where v.name = 'H&M')
  || ' admins=' || (select count(*) from auth.users where email = 'demo-admin@example.test')
  || ' reports=' || (select count(*) from ops.reports r join auth.users u on u.id = r.reviewed_by where u.email = 'demo-admin@example.test')
  || ' cube_rows=' || (select count(*) from analytics.cube);
SQL
  exit $?
fi

if [ "$mode" = "remove" ]; then
  run_psql <<'SQL'
begin;
delete from ops.reports where reviewed_by in (select id from auth.users where email = 'demo-admin@example.test');
delete from catalog.vendors where name = 'H&M';
delete from auth.users where email ~ '^panel-[0-9]{3}@example\.test$' or email = 'demo-admin@example.test' or (email = 'vendor-demo@example.test' and encrypted_password is null);
delete from catalog.lk_brand where code like 'demo-%';
select 'cube refreshed by run ' || analytics.run_aggregation();
commit;
select 'demo insights removed';
SQL
  exit $?
fi

run_psql <<'SQL'
begin;
create function pg_temp.pid(n int) returns uuid language sql immutable as $f$ select md5('demo-insights-panel:' || n)::uuid $f$;
insert into catalog.lk_brand (code, label, sort) values ('demo-h-and-m', 'H&M', 1), ('demo-zor-vane', 'Zor Vane', 2), ('demo-marlow-thistle', 'Marlow Thistle', 3),
  ('demo-pellam-ridge', 'Pellam Ridge', 4), ('demo-corvin-hale', 'Corvin Hale', 5), ('demo-brindle-quay', 'Brindle Quay', 6) on conflict (code) do nothing;

-- the panel: eligible consumers (supported country, age confirmed, notice and both documents at the current version)
insert into auth.users (id, email) select pg_temp.pid(n), 'panel-' || lpad(n::text, 3, '0') || '@example.test' from generate_series(1, 150) n on conflict (id) do nothing;
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select pg_temp.pid(n) from generate_series(1, 150) n);
insert into app.consent_records (user_id, notice_version) select pg_temp.pid(n), (select value from ops.settings where key = 'current_notice_version') from generate_series(1, 150) n
  where not exists (select 1 from app.consent_records c where c.user_id = pg_temp.pid(n));
insert into app.document_acceptances (user_id, document, version) select pg_temp.pid(n), d.doc, (select value from ops.settings where key = d.key)
  from generate_series(1, 150) n, (values ('terms', 'current_terms_version'), ('privacy_policy', 'current_privacy_version')) d(doc, key)
  where not exists (select 1 from app.document_acceptances a where a.user_id = pg_temp.pid(n) and a.document = d.doc);

-- items: category k is owned by the users its rule picks (Tops by all, Activewear by 7 and Ethnic wear by 9 users, so those two stay hidden)
with cat(k, category, subs, base) as (values
  (1, 'Tops', '{T-shirt,Shirt,Sweater,Polo,Hoodie,Cardigan}'::text[], 25), (2, 'Bottoms', '{Chinos,Jeans,Joggers,Shorts,Trousers}', 45), (3, 'Footwear', '{Boots,Formal shoes,Sandals,Sneakers}', 70),
  (4, 'Outerwear', '{Blazer,Coat,Jacket}', 110), (5, 'Accessories', '{Bag,Belt,Cap,Scarf,Watch}', 25), (6, 'Activewear', '{Sports T-shirt,Track pants}', 30), (7, 'Ethnic wear', '{Kurta,Nehru jacket}', 40)),
col(i, r, g, b) as (values (1, 17, 17, 17), (2, 0, 0, 128), (3, 244, 244, 240), (4, 46, 139, 87), (5, 217, 199, 160), (6, 200, 30, 40)),
own as (select n, k, category, subs, base, case when v < 6 then 1 when v < 11 then 2 when v < 14 then 3 when v < 17 then 4 when v < 19 then 5 else 6 end ci
        from generate_series(1, 150) n join cat on case cat.k when 1 then true when 2 then n % 5 <> 0 when 3 then n % 5 < 3 when 4 then n % 4 = 0 when 5 then n % 7 = 0 when 6 then n <= 7 else n between 141 and 149 end,
        lateral (select (n * 3 + cat.k * 5) % 20 v) q)
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, fit, size_system, size_value, brand, price, currency, seasons, condition, origin)
select md5('demo-insights-item:' || o.n || ':' || o.k)::uuid, pg_temp.pid(o.n), 'Demo ' || o.subs[o.n % cardinality(o.subs) + 1], o.category, o.subs[o.n % cardinality(o.subs) + 1], c.r, c.g, c.b,
  case when o.k in (3, 5) then null else (array['Regular', 'Slim', 'Relaxed', 'Regular', 'Oversized'])[o.n / 2 % 5 + 1] end,
  case when o.k in (1, 2, 4) then 'Letter' end, case when o.k in (1, 2, 4) then (array['S', 'M', 'M', 'L', 'L', 'XL', 'XS'])[o.n / 3 % 7 + 1] end,
  case when o.n % 11 = 0 then null when o.n % 9 = 0 then 'Hand Made' else (select label from catalog.lk_brand where code like 'demo-%' and sort = case when (o.n + o.k) % 10 < 4 then 1 when (o.n + o.k) % 10 < 6 then 2 else (o.n + o.k) % 4 + 3 end) end,
  case when o.n % 13 = 0 then null else o.base + o.n * 7 % 5 * (o.base / 4) end, 'USD',
  case when o.k = 4 then '{Autumn,Winter}' else (array['{Summer}', '{All year}', '{Spring,Summer}', '{Autumn,Winter}'])[o.n % 4 + 1] end::text[],
  case when o.n % 10 = 0 then null when o.n % 30 = 7 then 90 else (o.n * 37 + o.k * 11) % 85 end, 'manual'
from own o join col c on c.i = o.ci
on conflict (id) do nothing;

-- one purchase per item, spread over the last half year and leaning to recent months; re-running moves them with the date
insert into app.purchases (id, user_id, item_id, purchase_date, price, currency, quantity)
select md5('demo-insights-purchase:' || i.id)::uuid, i.user_id, i.id, current_date - h.v * h.v / 150, i.price, i.currency, 1
from app.items i join auth.users u on u.id = i.user_id, lateral (select abs(hashtext(i.id::text)) % 150 v) h where u.email ~ '^panel-[0-9]{3}@example\.test$'
on conflict (id) do update set purchase_date = excluded.purchase_date;

-- wishlist: six rules of users who want a category (Outerwear grows, Activewear has no visible ownership, Ethnic wear stays hidden), a few already bought, and entries from
-- Wardrobe unlock (origin unlock) that no vendor figure may count; the month created follows a fixed pattern that leans to the current month
with rule(k, category, sub_type, r, g, b) as (values (1, 'Outerwear', 'Jacket', 0, 0, 128), (2, 'Footwear', 'Sneakers', 244, 244, 240), (3, 'Accessories', 'Bag', 17, 17, 17),
  (4, 'Activewear', 'Sports T-shirt', 17, 17, 17), (5, 'Tops', 'Hoodie', 46, 139, 87), (6, 'Ethnic wear', 'Kurta', 217, 199, 160), (7, 'Bottoms', 'Chinos', 217, 199, 160), (8, 'Tops', 'T-shirt', 17, 17, 17)),
w as (select n, rule.*, case when n * 13 % 17 < 8 then 0 when n * 13 % 17 < 12 then 1 when n * 13 % 17 < 15 then 2 else 3 end off
      from generate_series(1, 150) n join rule on case rule.k when 1 then n % 5 in (0, 1) when 2 then n % 3 = 0 when 3 then n % 6 = 1 when 4 then n % 7 = 3 when 5 then n % 10 = 4
        when 6 then n between 20 and 28 when 7 then n % 9 = 0 else n % 11 = 0 end)
insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, target_price, currency, status, origin, created_at)
select md5('demo-insights-wish:' || w.n || ':' || w.k)::uuid, pg_temp.pid(w.n), 'Wish ' || w.sub_type, w.category, w.sub_type, w.r, w.g, w.b, case when w.n % 4 = 0 then null else 40 + w.n % 5 * 20 end, 'USD',
  case when w.n % 8 = 0 and w.k < 7 then 'bought' else 'open' end, case when w.k >= 7 then 'unlock' else 'user' end,
  (date_trunc('month', timezone('UTC', now())) - make_interval(months => w.off) + interval '1 hour') at time zone 'UTC'
from w on conflict (id) do update set created_at = excluded.created_at;

-- the vendor row, its member (a passwordless profile unless the account already exists), the current agreement, and the local admin profile
insert into catalog.vendors (id, name) values (md5('demo-insights-vendor')::uuid, 'H&M') on conflict (id) do nothing;
insert into auth.users (id, email) select md5('demo-insights-vendor-user')::uuid, 'vendor-demo@example.test' where not exists (select 1 from auth.users where email = 'vendor-demo@example.test');
insert into auth.users (id, email) select md5('demo-insights-admin')::uuid, 'demo-admin@example.test' where not exists (select 1 from auth.users where email = 'demo-admin@example.test');
update app.profiles set role = 'vendor' where id = (select id from auth.users where email = 'vendor-demo@example.test');
update app.profiles set role = 'admin' where id = (select id from auth.users where email = 'demo-admin@example.test');
insert into catalog.vendor_members (vendor_id, user_id) select md5('demo-insights-vendor')::uuid, id from auth.users where email = 'vendor-demo@example.test' on conflict do nothing;
insert into catalog.vendor_agreement_acceptances (vendor_id, user_id, version) select md5('demo-insights-vendor')::uuid, u.id, (select value from ops.settings where key = 'current_vendor_agreement_version')
  from auth.users u where u.email = 'vendor-demo@example.test'
  and not exists (select 1 from catalog.vendor_agreement_acceptances a where a.user_id = u.id and a.version = (select value from ops.settings where key = 'current_vendor_agreement_version'));
commit;

-- a real aggregation run over everything in the database, then one report for the current month, reviewed by the local admin (kept if it already exists)
begin;
select analytics.run_aggregation() as run_id \gset
select case when (select status from ops.aggregate_runs where id = :run_id) = 'ok' then 'aggregation run ' || :run_id || ' ok' else 'aggregation run FAILED: ' || (select error_code from ops.aggregate_runs where id = :run_id) end;
do $$
declare v_admin uuid := (select id from auth.users where email = 'demo-admin@example.test'); v_id uuid;
begin
  if (select status from ops.aggregate_runs order by id desc limit 1) <> 'ok' then raise exception 'aggregation did not finish ok'; end if;
  if not exists (select 1 from ops.reports r where r.reviewed_by = v_admin and r.period = date_trunc('month', current_date)::date) then
    v_id := analytics.build_report(current_date);
    update ops.reports set reviewed_by = v_admin, reviewed_at = now() where id = v_id;
  end if;
end $$;
commit;
select 'demo insights (SYNTHETIC) loaded: ' || (select count(*) from auth.users where email ~ '^panel-[0-9]{3}@example\.test$') || ' panel users, '
  || (select count(*) from analytics.cube) || ' published cube rows, ' || (select count(*) from ops.reports where reviewed_at is not null) || ' reviewed report(s)';
SQL
