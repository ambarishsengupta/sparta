-- WO-0182 (R8b follow-up of WO-0164; NFR-8; LLD 4.5, 13.3): backup_role reads the schemas analytics and analytics_private, so the backup covers them.
-- Only usage on the two schemas, plain select on their tables and sequences, and matching default privileges (LLD 4.5). Both schemas and all their
-- tables are owned by postgres (usage with grant option checked 2026-11-21), so this migration role can grant on them.
-- Deliberately NOT done: no create on either schema, no insert, update, delete, truncate, references or trigger, no execute on analytics.run_aggregation,
-- no membership of any role (above all never pg_read_all_data: it exposes password verifiers, see the WO-0163 migration), and nothing at all for anon,
-- authenticated or service_role: analytics is an exposed API schema whose tables carry no API grant (LLD 4.1, 4.5), and that stays so.
grant usage on schema analytics, analytics_private to backup_role;
grant select on all tables in schema analytics, analytics_private to backup_role;
grant select on all sequences in schema analytics, analytics_private to backup_role;

-- a table or sequence a LATER migration creates (run as postgres) in these schemas is readable too
alter default privileges for role postgres in schema analytics, analytics_private grant select on tables to backup_role;
alter default privileges for role postgres in schema analytics, analytics_private grant select on sequences to backup_role;
