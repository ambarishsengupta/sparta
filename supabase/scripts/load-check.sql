-- WO-0165 (R8b): the SQL of supabase/scripts/load-check.sh (NFR-7, BR-42; LLD 14 M6; HLD 6.4). LOCAL stack only; the script refuses any other database.
-- Run through psql with  -v phase=<snapshot|load|measure|aggregate|sessions|cleanup>  (the script does that; nothing here is meant to be run by hand).
-- Every row it creates is SYNTHETIC: users loadcheck-001@example.test .. loadcheck-500@example.test (auth rows by SQL, NO password, they can not sign in), fixed ids from md5('load-check:...'),
-- values derived from md5 hashes so the same data is built every time (the fixed seed is the text 'load-check:v1' inside those md5 inputs). Nothing here is real.
select :'phase' = 'snapshot' as is_snapshot, :'phase' = 'load' as is_load, :'phase' = 'measure' as is_measure, :'phase' = 'aggregate' as is_aggregate, :'phase' = 'sessions' as is_sessions, :'phase' = 'cleanup' as is_cleanup \gset

\if :is_snapshot
-- one line of facts the script compares before and after: the row counts of what the load touches, a checksum of analytics.cube, the signup counter of today and the aggregate-run sequence
select 'items=' || (select count(*) from app.items)
  || ' profiles=' || (select count(*) from app.profiles)
  || ' users=' || (select count(*) from auth.users)
  || ' consents=' || (select count(*) from app.consent_records)
  || ' acceptances=' || (select count(*) from app.document_acceptances)
  || ' wishlist=' || (select count(*) from app.wishlist_entries)
  || ' purchases=' || (select count(*) from app.purchases)
  || ' invites_accepted=' || (select count(*) from ops.invitations where accepted_at is not null)
  || ' runs=' || (select count(*) from ops.aggregate_runs)
  || ' facts=' || (select count(*) from analytics_private.facts)
  || ' cube_stage=' || (select count(*) from analytics_private.cube_stage)
  || ' cube_rows=' || (select count(*) from analytics.cube)
  || ' cube_md5=' || (select md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) from analytics.cube t)
  || ' leftover=' || (select count(*) from auth.users where email ~ '^loadcheck-[0-9]{3}@example\.test$')
  || ' signups_day=' || current_date
  || ' signups_n=' || coalesce((select d.n::text from ops.daily_counts d where d.day = current_date and d.metric = 'signups'), '-')
  || ' seq_last=' || (select last_value from ops.aggregate_runs_id_seq)
  || ' seq_called=' || (select case when is_called then 't' else 'f' end from ops.aggregate_runs_id_seq);
\endif

\if :is_load
-- 500 consumers x 100 items = 50,000 items, 10 wishlist entries and 30 purchases per user, in ONE transaction (any failure leaves nothing)
select clock_timestamp() as t0 \gset
begin;
insert into auth.users (id, email)
select md5('load-check:user:' || n)::uuid, 'loadcheck-' || lpad(n::text, 3, '0') || '@example.test' from generate_series(1, 500) n;
-- the sign-up trigger made the profiles; make every user eligible (supported country, age confirmed, notice and both documents at the current version)
update app.profiles set country = 'IN', hemisphere = 'north', age_confirmed = true where id in (select md5('load-check:user:' || n)::uuid from generate_series(1, 500) n);
insert into app.consent_records (user_id, notice_version)
select md5('load-check:user:' || n)::uuid, (select value from ops.settings where key = 'current_notice_version') from generate_series(1, 500) n;
insert into app.document_acceptances (user_id, document, version)
select md5('load-check:user:' || n)::uuid, d.doc, (select value from ops.settings where key = d.key)
from generate_series(1, 500) n, (values ('terms', 'current_terms_version'), ('privacy_policy', 'current_privacy_version')) d(doc, key);

with st as (select category, code, row_number() over (order by category, sort, code) rn from catalog.lk_sub_type where active),
     cnt as (select count(*) c from st)
insert into app.items (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, brand, price, currency, seasons, condition, origin, created_at)
select md5('load-check:item:' || n || ':' || j)::uuid, md5('load-check:user:' || n)::uuid, 'Load ' || st.code || ' ' || j, st.category, st.code,
  (array[17, 0, 244, 46, 217, 200])[get_byte(h.b, 0) % 6 + 1], (array[17, 0, 244, 139, 199, 30])[get_byte(h.b, 0) % 6 + 1], (array[17, 128, 240, 87, 160, 40])[get_byte(h.b, 0) % 6 + 1],   -- six swatches, as wardrobes are mostly a few colours
  (array['Loadco', 'Zor Vane', 'Marlow Thistle', 'Pellam Ridge', 'Corvin Hale', 'Brindle Quay'])[get_byte(h.b, 3) % 6 + 1],
  10 + get_byte(h.b, 4), 'USD',
  (array['{Summer}', '{All year}', '{Spring,Summer}', '{Autumn,Winter}'])[get_byte(h.b, 5) % 4 + 1]::text[],
  get_byte(h.b, 6) % 101, 'manual',
  timestamptz '2026-06-01 00:00:00+00' - j * interval '1 hour' - n * interval '1 second'
from generate_series(1, 500) n cross join generate_series(1, 100) j
cross join lateral (select decode(md5('load-check:bytes:' || n || ':' || j), 'hex') b) h
cross join cnt join st on st.rn = (n * 7 + j * 13) % cnt.c + 1;

insert into app.purchases (id, user_id, item_id, purchase_date, price, currency, quantity)
select md5('load-check:purchase:' || n || ':' || j)::uuid, md5('load-check:user:' || n)::uuid, md5('load-check:item:' || n || ':' || j)::uuid,
  date '2026-06-01' - (j * 5), 10 + j, 'USD', 1
from generate_series(1, 500) n cross join generate_series(1, 30) j;

insert into app.wishlist_entries (id, user_id, name, category, sub_type, colour_r, colour_g, colour_b, target_price, currency, status, origin)
select md5('load-check:wish:' || n || ':' || j)::uuid, md5('load-check:user:' || n)::uuid, 'Wish Jacket ' || j, 'Outerwear', 'Jacket', 17, 17, 17, 40 + j, 'USD', 'open', 'user'
from generate_series(1, 500) n cross join generate_series(1, 10) j;
-- fresh statistics, as autovacuum would have made them before a real user reads the list
analyze app.items; analyze app.purchases; analyze app.wishlist_entries; analyze app.profiles;
commit;
select 'LOAD|' || round(extract(epoch from clock_timestamp() - :'t0'::timestamptz)::numeric, 2)
  || '|' || (select count(*) from auth.users where email ~ '^loadcheck-[0-9]{3}@example\.test$')
  || '|' || (select count(*) from app.items i join auth.users u on u.id = i.user_id where u.email ~ '^loadcheck-[0-9]{3}@example\.test$')
  || '|' || (select count(*) from app.wishlist_entries w join auth.users u on u.id = w.user_id where u.email ~ '^loadcheck-[0-9]{3}@example\.test$')
  || '|' || (select count(*) from app.purchases p join auth.users u on u.id = p.user_id where u.email ~ '^loadcheck-[0-9]{3}@example\.test$');
\endif

\if :is_measure
-- the size of the whole local database with the load in it
select 'SIZE|' || pg_database_size(current_database());

-- as ONE signed-in synthetic user under RLS (role authenticated, the JWT claims set for this transaction): the three queries of the wardrobe screen, each run twice (cold, then warm) under explain (analyze)
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('load-check:user:1')::uuid::text, 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', md5('load-check:user:1')::uuid::text, true);
do $body$
declare
  v_fam text; v_out text := ''; q record; j json; cold numeric; warm numeric; n int; v_own bigint;
begin
  select count(*) into v_own from app.items;
  if v_own <> 100 then raise exception 'rls_not_applied: the user sees % items, expected 100', v_own; end if;
  v_out := 'RLS|' || v_own || E'\n';
  select i.colour_family into v_fam from app.items i where i.category = 'Tops' order by i.created_at limit 1;
  for q in select * from (values
    ('wardrobe_first_page', $q$select id,name,category,sub_type,colour_hex,colour_family,seasons,condition,status,created_at from app.items where status = 'active' order by created_at desc limit 50$q$),
    ('wardrobe_filtered', format($q$select id,name,category,sub_type,colour_hex,colour_family,seasons,condition,status,created_at from app.items where status = 'active' and category = 'Tops' and colour_family = %L order by created_at desc limit 50$q$, v_fam)),
    ('item_count', $q$select count(*) from app.items$q$)) v(name, sql)
  loop
    for n in 1..2 loop
      execute 'explain (analyze, format json) ' || q.sql into j;
      if n = 1 then cold := (j->0->>'Planning Time')::numeric + (j->0->>'Execution Time')::numeric;
      else warm := (j->0->>'Planning Time')::numeric + (j->0->>'Execution Time')::numeric; end if;
    end loop;
    v_out := v_out || 'Q|' || q.name || '|' || round(cold, 3) || '|' || round(warm, 3) || '|' || (j->0->'Plan'->>'Actual Rows') || '|'
      || (case when j::text ~ '"Node Type": ?"(Index Scan|Index Only Scan|Bitmap Index Scan)"' then 'yes' else 'no' end) || '|'
      || coalesce(substring(j::text from '"Index Name": ?"([^"]+)"'), '-') || E'\n';
  end loop;
  perform set_config('loadcheck.q', v_out, true);
end $body$;
reset role;
select current_setting('loadcheck.q');
rollback;

\endif

\if :is_aggregate
-- one analytics.run_aggregation() inside a transaction that is ROLLED BACK (the function runs in the caller's transaction: it takes a transaction-level advisory lock and writes
-- ops.aggregate_runs, the cube and analytics_private.facts, all of which the rollback undoes; the identity sequence of aggregate_runs is the one thing that is not transactional, the script puts it back)
begin;
do $body$
declare t0 timestamptz := clock_timestamp(); v_run bigint; r record; v_cube bigint;
begin
  v_run := analytics.run_aggregation();
  select a.status, a.users_included, a.items_included, a.error_code into r from ops.aggregate_runs a where a.id = v_run;
  select count(*) into v_cube from analytics.cube;
  perform set_config('loadcheck.agg', 'AGG|' || round(extract(epoch from clock_timestamp() - t0)::numeric * 1000, 1) || '|' || coalesce(r.status, '?') || '|'
    || coalesce(r.users_included::text, '') || '|' || coalesce(r.items_included::text, '') || '|' || v_cube || '|' || coalesce(r.error_code, '-'), true);
end $body$;
select current_setting('loadcheck.agg');
rollback;
\endif

\if :is_sessions
-- sessions of this run (application_name) that are not idle; with kill=t they are ended first
select :'kill' = 't' as do_kill \gset
\if :do_kill
select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = :'app' and pid <> pg_backend_pid() and datname = current_database();
\endif
select count(*) from pg_stat_activity where application_name = :'app' and pid <> pg_backend_pid() and datname = current_database() and state <> 'idle';
\endif

\if :is_cleanup
-- remove every row the load created (the foreign keys cascade from the user to the profile, the items, the purchases, the wishlist and the consent rows), then put the counter and the sequence back
select :'sig_day' = '' as rm_mode, (:'sig_day' = '' or :'sig_n' = '-') as drop_zero, :'seq_last' = '' as no_seq \gset
begin;
-- the day the counter was raised: the one the snapshot saw, or (--remove) the day the users were created
select coalesce(nullif(:'sig_day', '')::date, (select min(created_at)::date from auth.users where email ~ '^loadcheck-[0-9]{3}@example\.test$'), current_date) as sday \gset
with gone as (delete from auth.users where email ~ '^loadcheck-[0-9]{3}@example\.test$' returning id) select count(*) as removed from gone \gset
-- lower the counter by the users this run removed (other sessions' sign-ups are kept); a row this run created and that is now 0 goes
update ops.daily_counts set n = greatest(n - :removed, 0) where day = :'sday'::date and metric = 'signups';
\if :drop_zero
delete from ops.daily_counts where day = :'sday'::date and metric = 'signups' and n = 0;
\endif
-- the identity sequence is put back only where that can not hand out an id twice (nothing in the table is above the saved value); --remove has no saved value and sets it to the highest id in use
\if :no_seq
select setval('ops.aggregate_runs_id_seq', greatest(coalesce(max(id), 0), 1), coalesce(max(id), 0) > 0) from ops.aggregate_runs \gset
\else
select coalesce(max(id), 0) <= :'seq_last'::bigint as seq_ok from ops.aggregate_runs \gset
\if :seq_ok
select setval('ops.aggregate_runs_id_seq', :'seq_last'::bigint, :'seq_called' = 't') \gset
\endif
\endif
commit;
-- dead rows of the load out of the tables again (vacuum can not run inside a transaction)
vacuum analyze app.items, app.purchases, app.wishlist_entries, app.profiles, app.consent_records, app.document_acceptances;
select 'CLEANUP|removed users=' || :removed;
\endif
