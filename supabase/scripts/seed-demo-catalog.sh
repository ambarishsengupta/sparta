#!/usr/bin/env bash
# LOCAL DEMO ONLY (WO-0083, Release 0). Loads a SYNTHETIC demo catalogue into the LOCAL database: one source named `demo` (allowed = false, site
# http://127.0.0.1/, so no collector ever fetches it) and 40 active items with INVENTED brands, invented barcodes (GS1 prefix 290, the range reserved for
# in-store numbers, so no real product can carry them) and product links that point at 127.0.0.1. Nothing here is real or scraped. It is never part of
# config.toml seeding and never run by a gate. Idempotent: running it again updates the same 40 rows (key: source, sku) and adds nothing.
#
#   bash supabase/scripts/seed-demo-catalog.sh [DATABASE_URL]       # default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   bash supabase/scripts/seed-demo-catalog.sh --remove             # deletes the demo source and its items again
# The URL may also come from SPARTA_DEMO_DB_URL. It is REFUSED unless its host is 127.0.0.1, localhost or [::1] (no query string, no other host).
# Uses psql when it is installed, else `docker exec` into the local stack's database container. Hard time limit: 60 seconds.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
mode="seed"; if [ "${1:-}" = "--remove" ]; then mode="remove"; shift; fi
url="${1:-${SPARTA_DEMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
if ! printf '%s' "$url" | grep -Eq '^postgres(ql)?://[^@/?#[:space:]]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'; then
  echo "seed-demo-catalog: refusing to run: the database URL must point at 127.0.0.1, localhost or [::1] (no query string)." >&2; exit 2
fi
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
if command -v psql >/dev/null 2>&1; then run_psql() { timeout 60 psql "$url" -v ON_ERROR_STOP=1 -q -At; }
else run_psql() { timeout 60 docker exec -i "supabase_db_${project:-sparta}" psql -U postgres -v ON_ERROR_STOP=1 -q -At; }; fi

if [ "$mode" = "remove" ]; then
  echo "delete from catalog.sources where name = 'demo' and site_url = 'http://127.0.0.1/'; select 'demo source and its items removed';" | run_psql; exit $?
fi

run_psql <<'SQL'
begin;
-- GTIN-13 check digit of a 12-digit body (weights 1 and 3 from the left), then the code is padded to the 14 digits the table stores
create function pg_temp.gtin14(p_body text) returns text language sql immutable as $f$
  select '0' || p_body || ((10 - (select sum(substr(p_body, i, 1)::int * case when i % 2 = 1 then 1 else 3 end) from generate_series(1, 12) i) % 10) % 10)::text $f$;

insert into catalog.sources (name, site_url, robots_allowed, terms_note, allowed, checked_on)
select 'demo', 'http://127.0.0.1/', false, 'SYNTHETIC DEMO DATA: invented brands, invented barcodes, no real source. Never collected, never allowed.', false, current_date
where not exists (select 1 from catalog.sources where name = 'demo' and site_url = 'http://127.0.0.1/');

with brands(n, b) as (values (1, 'Zorvane'), (2, 'Quillibrook'), (3, 'Pemberlow'), (4, 'Wexmarrow'), (5, 'Ostrelle'), (6, 'Brindlewick'), (7, 'Fenwrath'), (8, 'Tallowmere')),
tpl(n, category, sub_type, label, fit, material, price, seasons) as (values
  (1, 'Tops', 'T-shirt', 'Crew tee', 'Regular', 'Cotton', 799, '{Spring,Summer}'),
  (2, 'Tops', 'Shirt', 'Oxford shirt', 'Slim', 'Cotton', 1499, '{Spring,Summer,Autumn}'),
  (3, 'Tops', 'Sweater', 'Knit jumper', 'Regular', 'Wool', 2299, '{Autumn,Winter}'),
  (4, 'Bottoms', 'Jeans', 'Straight jeans', 'Regular', 'Denim', 2499, '{All year}'),
  (5, 'Bottoms', 'Chinos', 'Tapered chinos', 'Slim', 'Cotton', 1899, '{Spring,Summer,Autumn}'),
  (6, 'Outerwear', 'Jacket', 'Field jacket', 'Regular', 'Cotton', 3999, '{Autumn,Winter}'),
  (7, 'Footwear', 'Sneakers', 'Court sneakers', null, 'Leather', 3499, '{All year}'),
  (8, 'Accessories', 'Bag', 'Canvas tote', null, 'Cotton', 999, '{All year}')),
col(n, label, r, g, b) as (values (1, 'Ink black', 17, 17, 17), (2, 'Chalk white', 244, 244, 240), (3, 'Harbour navy', 31, 42, 68), (4, 'Sage green', 46, 139, 87), (5, 'Dune beige', 217, 199, 160)),
src as (select id from catalog.sources where name = 'demo' and site_url = 'http://127.0.0.1/')
insert into catalog.catalog_items (source_id, sku, name, brand, gtin, category, sub_type, colour_r, colour_g, colour_b, fit, material, pattern, price, currency, seasons, occasions,
                                   product_url, status, missed_runs)
select src.id, 'DEMO-' || lpad(k::text, 4, '0'), t.label || ' - ' || c.label, br.b, pg_temp.gtin14('290' || lpad((5000 + k)::text, 9, '0')), t.category, t.sub_type, c.r, c.g, c.b,
       t.fit, t.material, 'Solid', t.price, 'INR', t.seasons::text[], '{Casual}', 'http://127.0.0.1/demo/DEMO-' || lpad(k::text, 4, '0'), 'active', 0
from src, tpl t, col c, brands br, lateral (select (t.n - 1) * 5 + c.n as k) kk(k)
where br.n = (t.n + c.n - 2) % 8 + 1
on conflict (source_id, vendor_id, sku) do update set name = excluded.name, brand = excluded.brand, gtin = excluded.gtin, category = excluded.category, sub_type = excluded.sub_type,
  colour_r = excluded.colour_r, colour_g = excluded.colour_g, colour_b = excluded.colour_b, fit = excluded.fit, material = excluded.material, price = excluded.price,
  seasons = excluded.seasons, product_url = excluded.product_url, status = 'active', missed_runs = 0;
select 'demo catalogue (SYNTHETIC): ' || count(*) || ' active items from the source named demo' from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = 'demo' and i.status = 'active';
commit;
SQL
