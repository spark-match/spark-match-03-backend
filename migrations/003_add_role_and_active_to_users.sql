-- =============================================================================
-- 003_add_role_and_active_to_users.sql
-- =============================================================================
-- Adds RBAC fields to `identity.users` ahead of the Phase 3 service-layer
-- refactor (see BACKEND-UPGRADE.md). For now the application does NOT read
-- these columns; this migration only ensures the schema is ready when
-- Phase 3 lands.
--
-- Notes:
--   - role is constrained to the single allowed value for the MVP (`admin`).
--     Future roles (e.g. `docente`, `graduado`) will be added via a new
--     migration that updates the CHECK constraint.
--   - active defaults to TRUE so existing rows are not locked out.
--   - An index on (active, email) supports the list-users query in Phase 4
--     (filter active=TRUE, sort by email) without a sequential scan.
-- =============================================================================

ALTER TABLE identity.users
  ADD COLUMN role   TEXT        NOT NULL DEFAULT 'admin',
  ADD COLUMN active BOOLEAN     NOT NULL DEFAULT TRUE;

ALTER TABLE identity.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin'));

CREATE INDEX identity_users_active_email_idx
  ON identity.users (active, email);

COMMENT ON COLUMN identity.users.role   IS 'RBAC role (MVP: solo `admin`; valores adicionales requieren nueva migration).';
COMMENT ON COLUMN identity.users.active IS 'FALSE deshabilita el login sin borrar la fila (preserva FKs historicas).';
