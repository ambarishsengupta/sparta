-- WO-0041 migration 4: ops tables for invitations, settings and daily counts, and the sign-up hook (LLD 4.1, 4.5, 4.9, 9.6).
-- `ops` is not exposed through the API and no client role has usage on it. Every table is deny-by-default.
create table ops.settings (
  key   text primary key,
  value text not null
);

create table ops.invitations (
  email       text primary key check (email = lower(email)),
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  note        text
);

-- a daily total with no user ID (LLD 9.6); written by app.handle_new_user() and the delete route
create table ops.daily_counts (
  day    date not null,
  metric text not null check (metric in ('signups', 'deletions')),
  n      int  not null default 0,
  primary key (day, metric)
);

alter table ops.settings    enable row level security;
alter table ops.settings    force row level security;
alter table ops.invitations enable row level security;
alter table ops.invitations force row level security;
alter table ops.daily_counts enable row level security;
alter table ops.daily_counts force row level security;

revoke all on ops.settings, ops.invitations, ops.daily_counts from public, anon, authenticated, service_role;

-- Seeded keys (LLD 4.9). Versions are placeholders until the legal pack fixes them; the web build's constants must equal them.
insert into ops.settings (key, value) values
  ('current_notice_version', '1'),
  ('current_terms_version', '1'),
  ('current_privacy_version', '1'),
  ('current_vendor_agreement_version', '1'),
  ('supported_countries', 'IN'),
  ('min_group_size', '10'),
  ('maintenance', 'off'),
  ('pilot_end_date', ''),
  ('pilot_outcome', ''),
  ('pilot_end_notice_sent_at', '')
on conflict (key) do nothing;

-- Before User Created hook (FR-8, LLD 4.9). Not security definer: it runs as supabase_auth_admin, which gets exactly
-- the usage, select grant and select policy below. Returns {} to allow, or the 403 error object the client shows.
create function ops.check_invitation(event jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from ops.invitations i where i.email = lower(event->'user'->>'email')) then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object('http_code', 403,
           'message', 'Sparta is invitation-only during the pilot.'))
  end $$;

revoke execute on function ops.check_invitation(jsonb) from public, anon, authenticated;
grant usage on schema ops to supabase_auth_admin;
grant execute on function ops.check_invitation(jsonb) to supabase_auth_admin;
grant select on ops.invitations to supabase_auth_admin;
create policy invitations_auth_admin_select on ops.invitations for select to supabase_auth_admin using (true);
