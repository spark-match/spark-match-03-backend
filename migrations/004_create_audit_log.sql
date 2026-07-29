-- =============================================================================
-- 004_create_audit_log.sql
-- =============================================================================
-- Append-only audit trail for sensitive identity events (login, role change,
-- deactivation, ...). Inserted by the service layer (Phase 3+) from the
-- same transaction as the change, so a failed write rolls back the change.
--
-- Notes:
--   - actor_user_id is the user who performed the action (NULL for system
--     actions like cron jobs). subject_user_id is the user the action
--     targets (may be the same as actor for self-service events like
--     change-password).
--   - action is a free-form short identifier (`user.login`, `user.role_changed`,
--     `user.deactivated`, ...). We don't use a CHECK constraint here on
--     purpose: new actions are added in code faster than migrations ship.
--   - metadata is JSONB for action-specific context (e.g. `{ "ip": "...",
--     "userAgent": "..." }` for logins; `{ "oldRole": "admin",
--     "newRole": "supervisor" }` for role changes).
--   - No UPDATE/DELETE: append-only. Revoke UPDATE/DELETE in a future
--     migration if compliance requires it.
-- =============================================================================

CREATE TABLE identity.audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT current_timestamp,
  action          TEXT         NOT NULL,
  actor_user_id   UUID         NULL REFERENCES identity.users(id) ON DELETE SET NULL,
  subject_user_id UUID         NULL REFERENCES identity.users(id) ON DELETE SET NULL,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX identity_audit_log_occurred_at_idx
  ON identity.audit_log (occurred_at DESC);

CREATE INDEX identity_audit_log_subject_idx
  ON identity.audit_log (subject_user_id, occurred_at DESC)
  WHERE subject_user_id IS NOT NULL;

CREATE INDEX identity_audit_log_action_idx
  ON identity.audit_log (action, occurred_at DESC);

COMMENT ON TABLE  identity.audit_log                IS 'Append-only audit trail for sensitive identity events. No UPDATE/DELETE.';
COMMENT ON COLUMN identity.audit_log.id              IS 'BIGSERIAL monotonic id; primary key.';
COMMENT ON COLUMN identity.audit_log.occurred_at     IS 'Cuando ocurrio el evento (default: now()).';
COMMENT ON COLUMN identity.audit_log.action          IS 'Identificador corto del evento (`user.login`, `user.role_changed`, ...).';
COMMENT ON COLUMN identity.audit_log.actor_user_id   IS 'Quien realizo la accion; NULL para acciones del sistema.';
COMMENT ON COLUMN identity.audit_log.subject_user_id IS 'Usuario objetivo de la accion; puede ser igual a actor para self-service.';
COMMENT ON COLUMN identity.audit_log.metadata        IS 'Contexto adicional JSONB (IP, user agent, old/new role, ...).';

-- Auto-prune at write time: revocar UPDATE/DELETE para el role de la app
-- (mitigado en este MVP con un comment; refuerzo en un futuro migration de
-- compliance).
