-- Database roles for app.agentor.dk (produktspecifikation §10.3).
-- Run as a superuser with psql. Idempotent: safe to re-run; it also resets role attributes.
--
--   psql -v owner_password=... -v web_password=... -v worker_password=... \
--        -v support_password=... -v ops_password=... -v db_name=agentor -f roles.sql
--
-- agentor_owner         owns the schema; used only by migrations.
-- agentor_web           web + ingest. CRUD under RLS. No SELECT on secrets.
-- agentor_worker        worker + scheduler. CRUD under RLS + SELECT on secrets.
-- agentor_support       no table privileges; EXECUTE on audited break-glass functions only.
-- agentor_readonly_ops  aggregates and metrics only, never RLS tables.
--
-- No runtime role is a superuser, owns objects, or has BYPASSRLS. Table-level grants
-- live in the migrations (packages/db/drizzle) so every database gets the same set.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN', r)
FROM unnest(ARRAY['agentor_owner', 'agentor_web', 'agentor_worker', 'agentor_support', 'agentor_readonly_ops']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE agentor_owner        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT   PASSWORD :'owner_password';
ALTER ROLE agentor_web          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'web_password';
ALTER ROLE agentor_worker       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'worker_password';
ALTER ROLE agentor_support      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'support_password';
ALTER ROLE agentor_readonly_ops LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'ops_password';

-- Runtime roles get a short statement timeout so a runaway query can't hold locks.
ALTER ROLE agentor_web    SET statement_timeout = '15s';
ALTER ROLE agentor_worker SET statement_timeout = '60s';

SELECT format('CREATE DATABASE %I OWNER agentor_owner', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO agentor_web, agentor_worker, agentor_support, agentor_readonly_ops', :'db_name') \gexec
