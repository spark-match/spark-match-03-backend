-- =============================================================================
-- V001__create_identity_schema_and_tracking.sql
-- =============================================================================
-- Creates the `identity` schema for the Identity bounded context. All identity
-- tables (users, sessions, audit_log, ...) live under this schema.
--
-- The `public.spark_match_migrations` table is the migration tracking table
-- managed by node-pg-migrate. We pre-create it here so that the migrate
-- Lambda can verify the schema exists before running the up-migrations, and
-- so that ad-hoc `psql` queries against the DB show a populated tracking
-- table from the moment V001 is applied.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS identity;

COMMENT ON SCHEMA identity IS 'Spark Match: Identity bounded context (users, sessions, audit).';

CREATE TABLE IF NOT EXISTS public.spark_match_migrations (
  name        TEXT        PRIMARY KEY,
  run_on      TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
);

COMMENT ON TABLE public.spark_match_migrations IS 'node-pg-migrate tracking table. Pre-created here so the table exists from the first V001 apply.';
