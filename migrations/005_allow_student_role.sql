-- =============================================================================
-- 005_allow_student_role.sql
-- =============================================================================
-- Adds `student` as a role and makes it the DEFAULT, so that registering
-- through the public endpoint no longer grants administrative privileges.
--
-- WHY THIS IS A SECURITY FIX, not a modelling tweak
--
-- Migration 003 pinned the role to a single value with `CHECK (role IN
-- ('admin'))` and `DEFAULT 'admin'`. Its header said, correctly at the time:
--
--     For now the application does NOT read these columns; this migration
--     only ensures the schema is ready when Phase 3 lands.
--
-- Phase 3 landed. The service layer now reads the column for real -- see
-- service/audit-service.ts:47 and service/user-service.ts:221, :253, :295 --
-- but nobody revisited this migration. The result was an access control that
-- is written, reviewed and tested, and can never deny anything: every branch
-- guarding `role === 'admin'` is unreachable because every row is 'admin'.
--
-- Since POST /v1/auth/register is public by design (Authorizer: NONE in
-- contexts/identity/template.yaml), any visitor who signed up could list every
-- user with their email, read the full audit log -- which stores IP and user
-- agent of other people's logins -- and deactivate third-party accounts.
--
-- ORDERING. An earlier version of this header said to apply the migration
-- BEFORE deploying the code that sets DEFAULT_ROLE = 'student'. That advice
-- was impossible to follow and has been removed.
--
-- It is impossible because the .sql files travel INSIDE the migration
-- Lambda's own artefact: scripts/bundle-migrate.mjs copies migrations/ into
-- the bundle and the handler reads them at runtime from /var/task/migrations.
-- Invoking the Lambda before `sam deploy` therefore runs the OLD artefact,
-- which has never heard of this file and answers `{"applied":[]}` -- success
-- with nothing applied. That is exactly what happened on 2026-08-08.
--
-- The hazard the old header described is real, though. Between the moment the
-- new code goes live and the moment this migration lands, every registration
-- inserts role='student' against the old single-value CHECK and fails. The
-- window cannot be eliminated by reordering; it can only be made short.
--
-- So it is now automated instead: .github/workflows/deploy.yml runs the step
-- `apply-database-migrations` immediately after `sam deploy`, in the same job,
-- and fails the deploy if any migration errors or if anything is still
-- pending afterwards. The window is the seconds between those two steps.
--
-- EXISTING ROWS ARE LEFT AS 'admin' ON PURPOSE.
--
-- This migration closes the hole for every future registration but does not
-- demote the accounts already created. That is deliberate: there is currently
-- no way to grant a role through the API -- `setRole` exists in
-- infra/user-repository.ts:156 but no handler calls it, and
-- UpdateProfileInputSchema only accepts fullName and age -- so a blanket
-- demotion with nobody left as admin would lock the project out of its own
-- administrative endpoints, recoverable only by direct SQL.
--
-- The demotion is a separate, deliberate step that needs one human decision
-- (which account keeps admin) and will land as its own migration. Until then,
-- any account created before this migration retains administrative access.
-- =============================================================================

ALTER TABLE identity.users
  DROP CONSTRAINT users_role_check;

ALTER TABLE identity.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'student'));

ALTER TABLE identity.users
  ALTER COLUMN role SET DEFAULT 'student';

COMMENT ON COLUMN identity.users.role IS
  'RBAC role. `student` is the default for self-registration; `admin` is granted deliberately and is NOT reachable through the public API.';
