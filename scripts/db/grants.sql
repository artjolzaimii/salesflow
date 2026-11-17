-- SalesFlow production database roles, step 2 of 2 (per database; docs/deployment.md § Database).
-- Run as the server administrator CONNECTED TO THE SALESFLOW DATABASE, before the first
-- migration (privileges and default privileges are stored per database):
--   psql "$ADMIN_URL_TO_SALESFLOW_DB" -f scripts/db/grants.sql
-- Safe to re-run after migrations; the final GRANT also covers tables that already exist.
\set ON_ERROR_STOP on

ALTER SCHEMA public OWNER TO salesflow_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO salesflow_app;

-- Every table, sequence and function the migrator creates is usable by the application
-- for row access only. Deletes that matter are still refused by triggers (invoices,
-- payments, audit log), which the application role can't disable: it doesn't own the tables.
ALTER DEFAULT PRIVILEGES FOR ROLE salesflow_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salesflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE salesflow_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO salesflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE salesflow_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO salesflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salesflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salesflow_app;
