// =============================================================================
// audit.ts handler - GET /v1/audit (admin only)
// =============================================================================
// Lists identity.audit_log with filters + cursor pagination.
//
// SECURITY: this endpoint requires the actor to have `role === 'admin'`.
// The check happens inside `auditService.listAuditEntries()` (not here)
// so the protection covers any future caller (CLI tools, internal jobs).
//
// The handler:
//   1. Receives the parsed query (handled by buildHandler's `inputSchema`)
//   2. Builds the filters from `event.queryStringParameters`
//   3. Calls `auditService.listAuditEntries(auth, filters)`
//   4. Returns the result serialized via the envelope
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import {
  AuditListInputSchema,
  AuditListOutputSchema,
  type AuditListInput,
  type AuditListOutput,
} from '../schemas/audit.schema.js';

export const handler = buildHandler<AuditListInput, AuditListOutput>({
  name: 'identity-audit',
  inputSchema: AuditListInputSchema,
  outputSchema: AuditListOutputSchema,
  logger: createLogger('identity-audit'),
  tracer: new Tracer({ serviceName: 'identity-audit' }),
  requireAuth: true,
  handler: async (_input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const q = event.queryStringParameters ?? {};
    const filters = {
      actorUserId: q.actorUserId,
      subjectUserId: q.subjectUserId,
      action: q.action,
      since: q.since,
      until: q.until,
      limit: q.limit ? Number(q.limit) : undefined,
      cursor: q.cursor,
    };

    const ctx = await buildContext();
    const result = await ctx.auditService.listAuditEntries(auth, filters);

    return {
      entries: result.entries.map((e) => ({
        id: e.id!,
        action: e.action,
        actorUserId: e.actorUserId,
        subjectUserId: e.subjectUserId,
        metadata: e.metadata,
        occurredAt: e.occurredAt!.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  },
});
