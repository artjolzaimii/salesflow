-- SalesFlow production database roles, step 1 of 2 (cluster-wide; docs/deployment.md § Database).
-- Run once as the server administrator, connected to any database:
--   psql "$ADMIN_DATABASE_URL" -v app_password="$APP_DB_PASSWORD" -v migrator_password="$MIGRATOR_DB_PASSWORD" -f scripts/db/roles.sql
-- Then create the database owned by the migrator and run step 2 (grants.sql) inside it.
-- Passwords come from psql variables (your secret store), never from this file.
--
-- salesflow_migrator  owns the schema; used only by `prisma migrate deploy` in the release job.
-- salesflow_app       what the running application uses: read and write rows, nothing else
--                     (no DDL, no TRUNCATE, can't drop or alter tables, triggers or functions).
\set ON_ERROR_STOP on

CREATE ROLE salesflow_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE salesflow_app LOGIN PASSWORD :'app_password' CONNECTION LIMIT 100;

-- Safety nets against runaway sessions of the application role.
ALTER ROLE salesflow_app SET statement_timeout = '30s';
ALTER ROLE salesflow_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE salesflow_app SET lock_timeout = '10s';

CREATE DATABASE salesflow OWNER salesflow_migrator;
