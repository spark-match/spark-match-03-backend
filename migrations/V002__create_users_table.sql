-- =============================================================================
-- V002__create_users_table.sql
-- =============================================================================
-- Base `identity.users` table. Mirrors the `Database` type in
--   contexts/identity/src/infra/user-repository.ts
-- and the `User` domain model in
--   contexts/identity/src/domain/user.ts
--
-- Notes:
--   - id is a UUID generated server-side via gen_random_uuid() (provided by
--     pgcrypto, which RDS Postgres enables by default).
--   - email is stored as VARCHAR(255) with a UNIQUE constraint. Case-folding
--     is handled at the application layer (the repository lowercases the
--     input before insert/lookup) to keep collation deterministic.
--   - password_hash stores the scrypt encoding produced by
--     shared/src/auth/hash-password.ts: `scrypt$N$r$p$<salt>b64u$<hash>b64u`.
--   - V003 will add `role` and `active` columns. V004 will add audit_log.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE identity.users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  age           SMALLINT     NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT current_timestamp,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT current_timestamp
);

COMMENT ON TABLE  identity.users              IS 'Spark Match identity context: user accounts.';
COMMENT ON COLUMN identity.users.id            IS 'Identificador universal (UUID v4) generado server-side.';
COMMENT ON COLUMN identity.users.email         IS 'Email unico, lowercased en la app antes de insert/lookup.';
COMMENT ON COLUMN identity.users.full_name     IS 'Nombre completo del usuario.';
COMMENT ON COLUMN identity.users.password_hash IS 'Hash del password (scrypt async, formato V$addN$r$p$salt$hash base64url).';
COMMENT ON COLUMN identity.users.age           IS 'Edad declarada al registro; NULL si no se proporciono.';
COMMENT ON COLUMN identity.users.created_at    IS 'Timestamp de creacion.';
COMMENT ON COLUMN identity.users.updated_at    IS 'Timestamp de ultima actualizacion.';

-- Trigger para mantener updated_at al hacer UPDATE
CREATE OR REPLACE FUNCTION identity.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = current_timestamp;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON identity.users
  FOR EACH ROW
  EXECUTE FUNCTION identity.touch_updated_at();
