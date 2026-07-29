// =============================================================================
// Audit domain types
// =============================================================================
// Domain types for the audit_log write path. The schema is defined in
// migrations/V004__create_audit_log.sql; this file defines the TypeScript
// projection (camelCase) and the action taxonomy (ADR-015).
//
// All audit writes are sync and inside the same transaction as the user
// mutation that triggered them. See user-service.ts.
// =============================================================================

/**
 * Closed set of audit actions. Each action maps to a specific
 * service-layer operation. Adding a new action requires updating:
 *   1. this union (here)
 *   2. the AuditMetadataByAction map (here)
 *   3. the corresponding user-service method (the trigger)
 *   4. docs/event-catalog.md (documentation)
 */
export type AuditAction =
  | 'user.registered'
  | 'user.login'
  | 'user.profile_viewed'
  | 'user.profile_updated'
  | 'user.password_changed'
  | 'user.deactivated'
  | 'user.activated'
  | 'user.role_changed'
  | 'user.list_viewed';

/**
 * Metadata payload for each action. Keeping this as a discriminated union
 * (rather than `Record<string, unknown>`) catches typos at compile time
 * and makes the audit shape self-documenting.
 *
 * Privacy note: no password values, no JWT tokens, no PII beyond what
 * is already public (email, role). The metadata JSONB stays small
 * (typically < 200 bytes).
 */
export type AuditMetadata = AuditMetadataByAction[AuditAction];

export interface AuditMetadataByAction {
  'user.registered': {
    readonly email: string;
    readonly role: string;
  };
  'user.login': {
    readonly ip: string;
    readonly userAgent: string;
  };
  'user.profile_viewed': Record<string, never>;
  'user.profile_updated': {
    readonly changedFields: readonly string[];
    readonly old: { fullName?: string; age?: number | null };
    readonly new: { fullName?: string; age?: number | null };
  };
  'user.password_changed': Record<string, never>;
  'user.deactivated': Record<string, never>;
  'user.activated': Record<string, never>;
  'user.role_changed': {
    readonly oldRole: string;
    readonly newRole: string;
  };
  'user.list_viewed': {
    readonly filterCount: number;
    readonly returnedCount: number;
  };
}

/**
 * Domain projection of an audit_log row.
 * `id` and `occurredAt` are populated by the DB; the rest are set by the
 * service layer before insert.
 */
export interface AuditEntry {
  readonly id?: number;
  readonly occurredAt?: Date;
  readonly action: AuditAction;
  readonly actorUserId: string | null;
  readonly subjectUserId: string | null;
  readonly metadata: AuditMetadata;
}
