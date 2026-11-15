#!/usr/bin/env bash
# LOCAL DEMO ONLY (WO-0097, Release 0). Builds the local demo state in ONE command: runs seed-demo-catalog.sh and seed-demo-insights.sh (SYNTHETIC catalogue, panel, vendor), then
# creates three consumer accounts through the local auth admin API (invited, confirmed, Terms/Privacy and pilot notice accepted; rich and thin also finish onboarding with the real app.complete_onboarding):
#   demo-rich@example.test  60 items (men's wardrobe, invented brands), 15 purchases, 4 planned wishlist entries
#   demo-thin@example.test  12 items (tops, bottoms, footwear only, so Wardrobe unlock has gaps to show), 2 purchases
#   demo-new@example.test   no items and onboarding NOT done: the first sign-in lands on the onboarding form, which offers 'Start from popular items'
# and gives the EXISTING passwordless vendor-demo@example.test profile (made by the insights seed) a password by UPDATING it. Passwords are generated at run time with openssl,
# PRINTED ONCE to the terminal, and never written to any file (a re-run makes new ones). The local secret key is read from `supabase status -o env` into shell variables only and
# reaches curl through its stdin, never an argument. Wardrobes use fixed ids and fixed rules (no randomness): invented names, brands and @example.test addresses, nothing real.
#   bash supabase/scripts/demo-data.sh [DATABASE_URL]    # default: postgresql://postgres:postgres@127.0.0.1:54322/postgres  (SPARTA_DEMO_DB_URL also works)
#   bash supabase/scripts/demo-data.sh --counts          # one line of row counts for the idempotence check
#   bash supabase/scripts/demo-data.sh --remove          # deletes the three consumers, un-passwords the vendor profile, then runs both seeds' --remove
#   bash supabase/scripts/demo-data.sh --hm              # WO-0122, LOCAL private demo (legal/HM-DEMO-DECISION.md): also loads the H&M demo catalogue (workflow/demo/hm/load_hm_demo_catalog.py, 1,500
#                                                        # articles read from $SPARTA_DATA_ROOT_HM at run time, nothing copied) and builds the 60 and 12 wardrobe items FROM those articles (origin
#                                                        # catalogue, with catalog_item_id, so tiles show the photographs), plus a few more purchases of them; --remove (with or without --hm) removes it all
# REFUSED unless the database host AND the auth API host are 127.0.0.1, localhost or [::1]. Stops at the first error. psql, else `docker exec` into the database container.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
hm=0; rest=(); for a in "$@"; do if [ "$a" = "--hm" ]; then hm=1; else rest+=("$a"); fi; done; set -- ${rest[@]+"${rest[@]}"}
mode="seed"; case "${1:-}" in --remove) mode="remove"; shift;; --counts) mode="counts"; shift;; esac
url="${1:-${SPARTA_DEMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
if ! printf '%s' "$url" | grep -Eq '^postgres(ql)?://[^@/?#[:space:]]*@(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'; then
  echo "demo-data: refusing to run: the database URL must point at 127.0.0.1, localhost or [::1] (no query string)." >&2; exit 2
fi
project="$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml | head -n1)"
if command -v psql >/dev/null 2>&1; then run_psql() { timeout 120 psql "$url" -v ON_ERROR_STOP=1 -q -At; }
else run_psql() { timeout 120 docker exec -i "supabase_db_${project:-sparta}" psql -U postgres -v ON_ERROR_STOP=1 -q -At; }; fi
die() { echo "demo-data: $*" >&2; exit 1; }
EMAILS="'demo-rich@example.test','demo-thin@example.test','demo-new@example.test'"

if [ "$mode" = "counts" ]; then
  run_psql <<SQL || exit 1
select 'consumers=' || (select count(*) from auth.users where email in ($EMAILS))
  || ' items=' || (select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email in ($EMAILS))
  || ' purchases=' || (select count(*) from app.purchases p join auth.users u on u.id = p.user_id where u.email in ($EMAILS))
  || ' wishlist=' || (select count(*) from app.wishlist_entries w join auth.users u on u.id = w.user_id where u.email in ($EMAILS))
  || ' consent=' || (select count(*) from app.consent_records c join auth.users u on u.id = c.user_id where u.email in ($EMAILS))
  || ' invitations=' || (select count(*) from ops.invitations where email in ($EMAILS))
  || ' vendor_users=' || (select count(*) from auth.users where email = 'vendor-demo@example.test')
  || ' catalogue=' || (select count(*) from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = 'demo')
  || ' hm_catalogue=' || (select count(*) from catalog.catalog_items i join catalog.sources s on s.id = i.source_id where s.name = 'hm-demo')
  || ' hm_items=' || (select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email in ($EMAILS) and i.origin = 'catalogue' and i.catalog_item_id is not null);
SQL
  bash supabase/scripts/seed-demo-insights.sh --counts "$url"; exit $?
fi

if [ "$mode" = "remove" ]; then
  run_psql <<SQL || exit 1
delete from auth.users where email in ($EMAILS);
delete from ops.invitations where email in ($EMAILS);
update auth.users set encrypted_password = null where email = 'vendor-demo@example.test';
delete from catalog.sources where name = 'hm-demo' and site_url = 'http://127.0.0.1/';
select 'demo consumers removed';
SQL
  bash supabase/scripts/seed-demo-insights.sh --remove "$url" && bash supabase/scripts/seed-demo-catalog.sh --remove "$url"; exit $?
fi

# the local stack's address and secret key: read now, kept in shell variables, never printed or written
st="$(supabase status -o env 2>/dev/null)" || die "the local Supabase stack is not running (supabase start)."
field() { printf '%s\n' "$st" | sed -n "s/^$1=\"\(.*\)\"\$/\1/p"; }   # one NAME="value" line of the status output
api="$(field API_URL)"; sk="$(field SECRET_KEY)"; st=""
printf '%s' "$api" | grep -Eq '^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$' || die "refusing to run: the auth API must be on 127.0.0.1, localhost or [::1]."
[ -n "$sk" ] || die "the local stack did not report a secret key."
# admin METHOD PATH JSON: the local auth admin API; URL, keys and body travel on curl's stdin (-K -), so no secret is in the process list
admin() { printf 'url = "%s%s"\nrequest = "%s"\nheader = "apikey: %s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata = "%s"\nsilent\nfail\nmax-time = 30\n' \
  "$api" "$2" "$1" "$sk" "$sk" "${3//\"/\\\"}" | curl -K - >/dev/null; }
newpw() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20; }
uid() { printf "select id from auth.users where email = '%s'" "$1" | run_psql; }

# a seed of the other kind may already be there (fixed ids: a re-run would keep those items): say so BEFORE anything is changed, and change nothing
# only the rows this script seeds count (its own fixed ids, md5('demo-data:' || email || ':' || i)); items a presenter added by hand are ignored. A seeded row is H&M-made when its article is of the hm-demo source.
held="$(printf "select count(*) filter (where s.name is distinct from 'hm-demo') || ' ' || count(*) filter (where s.name = 'hm-demo') from app.items i join auth.users u on u.id = i.user_id
  left join catalog.catalog_items ci on ci.id = i.catalog_item_id left join catalog.sources s on s.id = ci.source_id
  where u.email in (%s) and i.id in (select md5('demo-data:' || e || ':' || n)::uuid from unnest(array[%s]) e, generate_series(1, 60) n)" "$EMAILS" "$EMAILS" | run_psql)" || exit 1
read -r plain_items catalogue_items <<< "$held"
if [ "$hm" = 1 ] && [ "${plain_items:-0}" -gt 0 ]; then
  echo "demo-data: the demo accounts still hold the PLAIN demo wardrobe (${plain_items} seeded items not made from hm-demo articles), so --hm would keep it and show illustrations, not photographs. Nothing was changed. Run: bash supabase/scripts/demo-data.sh --remove   and then   bash supabase/scripts/demo-data.sh --hm" >&2; exit 3
elif [ "$hm" = 0 ] && [ "${catalogue_items:-0}" -gt 0 ]; then
  echo "demo-data: the demo accounts still hold the --hm wardrobe (${catalogue_items} seeded items made from hm-demo articles), so a plain seed would keep it. Nothing was changed. Run: bash supabase/scripts/demo-data.sh --remove   and then   bash supabase/scripts/demo-data.sh" >&2; exit 3
fi
bash supabase/scripts/seed-demo-catalog.sh "$url" || die "the catalogue seed failed."
bash supabase/scripts/seed-demo-insights.sh "$url" || die "the insights seed failed."
if [ "$hm" = 1 ]; then   # the loader refuses a non-local URL itself and only reads the H&M folder; python3 is enough (standard library only)
  py="${SPARTA_VENV_PYTHON:-$(sed -n 's/^SPARTA_VENV_PYTHON=//p' workflow/local.env 2>/dev/null | head -n1)}"; [ -x "${py:-}" ] || py=python3
  "$py" -B workflow/demo/hm/load_hm_demo_catalog.py --db-url "$url" || die "the hm-demo catalogue could not be loaded (is SPARTA_DATA_ROOT_HM set?)."
fi

declare -a creds=()
for e in demo-rich demo-thin demo-new vendor-demo; do
  email="$e@example.test"; pw="$(newpw)"; [ "${#pw}" -ge 16 ] || die "could not generate a password."
  id="$(uid "$email")" || exit 1
  if [ -z "$id" ]; then
    [ "$e" != vendor-demo ] || die "vendor-demo@example.test is missing: the insights seed should have created it."
    printf "insert into ops.invitations (email) select '%s' where not exists (select 1 from ops.invitations where email = '%s')" "$email" "$email" | run_psql || exit 1
    admin POST /auth/v1/admin/users "{\"email\":\"$email\",\"password\":\"$pw\",\"email_confirm\":true}" || die "creating $email failed."
  else
    # the insights seed makes a bare auth row (no instance, audience or token strings), which the auth API can not find: give it the shape the API gives its own users, then set the password
    [ "$e" != vendor-demo ] || printf "update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated', confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '', email_change_token_current = '', reauthentication_token = '', phone_change = '', phone_change_token = '', raw_app_meta_data = '{\"provider\": \"email\", \"providers\": [\"email\"]}', raw_user_meta_data = '{\"email_verified\": true}', email_confirmed_at = coalesce(email_confirmed_at, now()), created_at = coalesce(created_at, now()), updated_at = now() where id = '%s'" "$id" | run_psql || exit 1
    admin PUT "/auth/v1/admin/users/$id" "{\"password\":\"$pw\",\"email_confirm\":true}" || die "setting the password of $email failed."
  fi
  creds+=("$email  $pw")
done

{ echo "\\set hm $hm"; cat <<'SQL'; } | run_psql || exit 1
begin;
-- consent and documents (age confirmed) for the three consumers; onboarding (rich and thin) uses the real function with the user's id as the caller
insert into app.document_acceptances (user_id, document, version) select u.id, d.doc, (select value from ops.settings where key = d.key)
  from auth.users u, (values ('terms', 'current_terms_version'), ('privacy_policy', 'current_privacy_version')) d(doc, key)
  where u.email in ('demo-rich@example.test', 'demo-thin@example.test', 'demo-new@example.test') and not exists (select 1 from app.document_acceptances a where a.user_id = u.id and a.document = d.doc);
insert into app.consent_records (user_id, notice_version) select u.id, (select value from ops.settings where key = 'current_notice_version') from auth.users u
  where u.email in ('demo-rich@example.test', 'demo-thin@example.test', 'demo-new@example.test') and not exists (select 1 from app.consent_records c where c.user_id = u.id);
update app.profiles set age_confirmed = true where id in (select id from auth.users where email in ('demo-rich@example.test', 'demo-thin@example.test', 'demo-new@example.test'));
do $$ declare r record; begin
  for r in select id from auth.users where email in ('demo-rich@example.test', 'demo-thin@example.test') loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    perform app.complete_onboarding('IN', 'north', 'INR', array['Casual', 'Work']);
  end loop;
end $$;

-- wardrobes: slot k of a fixed pattern picks the sub-type, colour and brand by arithmetic on i (no randomness); ids are md5 of the owner and i, so a re-run adds nothing
with acct(email, n, pat) as (values ('demo-rich@example.test', 60, '{1,1,2,1,3,2,1,4,2,5,1,3,2,1,5,4,1,2,3,5}'::int[]), ('demo-thin@example.test', 12, '{1,2,3,1,2,1,3,2,1,3,2,1}'::int[])),
cat(k, category, subs, base) as (values (1, 'Tops', '{T-shirt,Shirt,Polo,Sweater,Hoodie,Cardigan}'::text[], 799), (2, 'Bottoms', '{Jeans,Chinos,Trousers,Shorts,Joggers}', 1499), (3, 'Footwear', '{Sneakers,Formal shoes,Boots,Sandals}', 2999),
  (4, 'Outerwear', '{Jacket,Blazer,Coat}', 3999), (5, 'Accessories', '{Watch,Belt,Cap,Scarf,Bag}', 899)),
col(c, label, r, g, b) as (values (1, 'Ink black', 17, 17, 17), (2, 'Chalk white', 244, 244, 240), (3, 'Harbour navy', 31, 42, 68), (4, 'Sage green', 46, 139, 87), (5, 'Dune beige', 217, 199, 160),
  (6, 'Slate grey', 110, 120, 130), (7, 'Rust', 160, 70, 40), (8, 'Olive', 107, 107, 47), (9, 'Denim blue', 60, 90, 140)),
brand(b, label) as (values (1, 'Aster Loom'), (2, 'Zor Vane'), (3, 'Marlow Thistle'), (4, 'Pellam Ridge'), (5, 'Corvin Hale'), (6, 'Brindle Quay')),
gen as (select a.email, i, c.*, c.subs[(i * 7 + c.k) % cardinality(c.subs) + 1] sub, (i * 5 + c.k * 3) % 9 + 1 ci, count(*) over (partition by a.email, c.k order by i) - 1 j
        from acct a, generate_series(1, 60) i, lateral (select * from cat where k = a.pat[(i - 1) % cardinality(a.pat) + 1]) c where i <= a.n),
-- with --hm (:hm = 1) slot j of a category is the j-th H&M demo article of that category in an order that differs per account: the item is made FROM the article (name, sub-type, colour, brand)
sel as (select g.*, p.id cid, p.name pname, p.colour_r pr, p.colour_g pg, p.colour_b pb, coalesce(p.sub_type, g.sub) esub from gen g left join lateral (
          select ci.id, ci.name, ci.sub_type, ci.colour_r, ci.colour_g, ci.colour_b from catalog.catalog_items ci join catalog.sources s on s.id = ci.source_id
          where s.name = 'hm-demo' and ci.status = 'active' and ci.category = g.category order by md5(ci.sku || g.email) offset g.j limit 1) p on :hm = 1)
insert into app.items (id, user_id, catalog_item_id, name, category, sub_type, colour_r, colour_g, colour_b, pattern, fit, size_system, size_value, brand, price, currency, seasons, occasions, condition, origin)
select md5('demo-data:' || g.email || ':' || g.i)::uuid, u.id, g.cid, coalesce(g.pname, col.label || ' ' || lower(g.sub)), g.category, g.esub, coalesce(g.pr, col.r), coalesce(g.pg, col.g), coalesce(g.pb, col.b), 'Solid',
  case when g.k in (3, 5) then null else (array['Regular', 'Slim', 'Relaxed'])[g.i % 3 + 1] end,
  case when g.k in (1, 2, 4) then 'Letter' end, case when g.k in (1, 2, 4) then (array['S', 'M', 'M', 'L', 'L', 'XL'])[g.i % 6 + 1] end,
  case when g.cid is not null then 'H&M' else (select label from brand where b = (g.i + g.k) % 6 + 1) end, g.base + g.i * 37 % 5 * (g.base / 4), 'INR',
  case when g.k = 4 then '{Autumn,Winter}' when g.esub in ('Shorts', 'Sandals', 'T-shirt') then '{Spring,Summer}' else '{All year}' end::text[],
  case when g.esub in ('Shirt', 'Chinos', 'Trousers', 'Watch', 'Belt') then '{Casual,Work,Date}' when g.esub in ('Formal shoes', 'Blazer') then '{Work,Formal,Date}' else '{Casual,Travel}' end::text[],
  (g.i * 37 + g.k * 11) % 85, case when g.cid is not null then 'catalogue' else 'manual' end
from sel g join auth.users u on u.email = g.email join col on col.c = g.ci
on conflict (id) do nothing;

-- some purchases of the items just made (rich: every fourth item, thin: two) and four planned wishlist entries for the rich account
-- with --hm the purchases are of catalogue-origin items (store H&M or H&M Online), and the rich account has three more
insert into app.purchases (id, user_id, item_id, purchase_date, price, currency, quantity, store)
select md5('demo-data-purchase:' || i.id)::uuid, i.user_id, i.id, current_date - (row_number() over (partition by i.user_id order by i.id)::int * 9 % 170), i.price, i.currency, 1,
  case when i.catalog_item_id is not null then (array['H&M', 'H&M Online'])[row_number() over (partition by i.user_id order by i.id)::int % 2 + 1]
    else (array['Harbour Row Outfitters', 'Lantern Street Menswear', 'Quill and Cotton'])[row_number() over (partition by i.user_id order by i.id)::int % 3 + 1] end
from app.items i join auth.users u on u.id = i.user_id
where (u.email = 'demo-rich@example.test' and i.id in (select md5('demo-data:demo-rich@example.test:' || n)::uuid from generate_series(4, 60, 4) n))
   or (:hm = 1 and u.email = 'demo-rich@example.test' and i.id in (select md5('demo-data:demo-rich@example.test:' || n)::uuid from generate_series(2, 58, 28) n))
   or (u.email = 'demo-thin@example.test' and i.id in (select md5('demo-data:demo-thin@example.test:' || n)::uuid from generate_series(3, 6, 3) n))
on conflict (id) do nothing;
insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, target_price, currency, priority, planned_month, budget, origin)
select md5('demo-data-wish:' || w.n)::uuid, u.id, w.name, w.category, w.sub, w.r, w.g, w.b, w.price, 'INR', w.prio, (date_trunc('month', current_date) + make_interval(months => w.n))::date, w.price + 500, 'user'
from auth.users u, (values (1, 'Navy overcoat', 'Outerwear', 'Coat', 31, 42, 68, 6500, 'high'), (2, 'White court sneakers', 'Footwear', 'Sneakers', 244, 244, 240, 3500, 'medium'),
  (3, 'Olive field jacket', 'Outerwear', 'Jacket', 107, 107, 47, 4200, 'medium'), (4, 'Grey wool jumper', 'Tops', 'Sweater', 110, 120, 130, 2300, 'low')) w(n, name, category, sub, r, g, b, price, prio)
where u.email = 'demo-rich@example.test' on conflict (id) do nothing;
-- the insights seed accepts the vendor agreement for vendor-demo; the walk-through shows that step, so the demo account starts without it (a re-run of this script puts it back to that state)
delete from catalog.vendor_agreement_acceptances where user_id = (select id from auth.users where email = 'vendor-demo@example.test');
commit;
SQL

echo "Demo accounts are ready (SYNTHETIC data, local stack only). Passwords are shown ONCE and stored nowhere; run the script again for new ones."
for c in "${creds[@]}"; do echo "  $c"; done
echo "  (demo-rich: 60 items, purchases, wishlist | demo-thin: 12 items | demo-new: empty, onboarding still to do | vendor-demo: vendor portal, agreement not yet accepted)"
