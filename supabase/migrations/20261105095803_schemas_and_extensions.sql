-- WO-0040 migration 1: schemas, extensions and schema usage (LLD 4.1, section 2).
create schema if not exists app;               -- per-user data (exposed, protected by RLS)
create schema if not exists catalog;           -- taxonomy lookups, catalogue, vendors (exposed, read by policy)
create schema if not exists ops;               -- settings, runs, audit (not exposed)
create schema if not exists analytics;         -- vendor aggregates (R5): empty, no grants yet
create schema if not exists analytics_private; -- anonymised facts (R5): empty, no grants, never exposed

-- LLD section 2: pgcrypto and pg_trgm live in the extensions schema; callers schema-qualify them.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;        -- jobs arrive in R7; Supabase installs it in its own schema

-- LLD 4.1: usage on app and catalog for signed-in users and the secret-key client; anon gets usage on app
-- only (for app.supported_countries(), added later). ops, analytics and analytics_private get no grants.
grant usage on schema app, catalog to authenticated, service_role;
grant usage on schema app to anon;
