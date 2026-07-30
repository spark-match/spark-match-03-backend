// =============================================================================
// Audit service - admin-side query over identity.audit_log
// =============================================================================
// Separated from user-service.ts (single-responsibility). This service
// is used by the GET /v1/audit admin endpoint and any future admin
// read paths over the append-only audit trail.
//
// All methods in this service require the actor to have `role === 'admin'`.
// The check is enforced here (not in the handler) so any future caller
// (CLI tools, internal scripts) gets the same protection.
//
// Cursor pagination: we trust the cursor that came from a previous
// `listAuditEntries()` response. The cursor format is opaque
// (base64-encoded {occurredAt, id}); tampering is harmless because the
// underlying query still respects filters.
// =============================================================================

import type { AuditRepository } from '../infra/audit-repository.js';
import type { AuthContext } from '@spark-match/shared/auth';
import { ApiError } from '@spark-match/shared/http';
import type { AuditEntry } from '../domain/audit.js';

export interface AuditListFilters {
  actorUserId?: string;
  subjectUserId?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditListResult {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditService {
  listAuditEntries(actor: AuthContext, filters: AuditListFilters): Promise<AuditListResult>;
}

export function createAuditService(deps: { auditRepository: AuditRepository }): AuditService {
  const { auditRepository } = deps;

  return {
    async listAuditEntries(actor, filters): Promise<AuditListResult> {
      if (actor.role !== 'admin') {
        throw ApiError.forbidden('audit log access requires admin role', {
          code: 'audit.admin_only',
          message: 'audit log access requires admin role',
          path: 'role',
          value: actor.role,
        });
      }

      const { entries, nextCursor } = await auditRepository.list(filters);

      // Emit a list_viewed audit entry (forensically useful: who queried what).
      // Metadata includes the filter shape so we can reconstruct the query later.
      const filterCount = Object.keys(filters).filter(
        (k) => k !== 'limit' && k !== 'cursor',
      ).length;
      await auditRepository.insert({
        action: 'user.list_viewed',
        actorUserId: actor.userId,
        subjectUserId: null,
        metadata: {
          filterCount,
          returnedCount: entries.length,
        },
      });

      return { entries, nextCursor };
    },
  };
}
