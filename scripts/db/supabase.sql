-- SalesFlow on Supabase: lock down the Data API roles and create the application role
-- (docs/deployment-vercel.md § Database). Run AFTER `prisma migrate deploy`, as the
-- `postgres` user over the session pooler, with the password from your secret store:
--   psql "$SUPABASE_SESSION_URL" -v app_password="$APP_DB_PASSWORD" -f scripts/db/supabase.sql
-- Safe to run again after later migrations (it re-applies the grants).
\set ON_ERROR_STOP on

-- 1. Supabase's Data API (PostgREST/GraphQL) serves the public schema to the roles
--    anon and authenticated, and by default grants them ALL on every new table.
--    SalesFlow never uses the Data API: remove that access entirely, now and for
--    tables future migrations create. (Also turn the Data API off in the dashboard.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2. Application role: read and write rows only (no DDL, can't drop or alter tables,
--    triggers or functions; deletes of invoices, payments and audit events stay
--    refused by triggers). Connects through the pooler as salesflow_app.<project-ref>.
SELECT format('CREATE ROLE salesflow_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salesflow_app') \gexec
SELECT format('ALTER ROLE salesflow_app PASSWORD %L', :'app_password') \gexec
ALTER ROLE salesflow_app CONNECTION LIMIT 60;
ALTER ROLE salesflow_app SET statement_timeout = '30s';
ALTER ROLE salesflow_app SET lock_timeout = '10s';
ALTER ROLE salesflow_app SET idle_in_transaction_session_timeout = '60s';

GRANT USAGE ON SCHEMA public TO salesflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salesflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salesflow_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO salesflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salesflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO salesflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO salesflow_app;
-- Migration history is read by /api/health; it must not be writable by the app.
REVOKE INSERT, UPDATE, DELETE ON _prisma_migrations FROM salesflow_app;

-- 3. Report: what the Data API roles and the app role can do on SalesFlow tables.
SELECT grantee, count(*) AS table_privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'salesflow_app')
GROUP BY grantee ORDER BY grantee;
