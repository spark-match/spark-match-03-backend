// =============================================================================
// Audit repository - kysely queries against identity.audit_log
// =============================================================================
// Writes the audit trail entries described in ADR-015. Follows the same
// pattern as user-repository.ts: factory function, `withDbErrorMapping`,
// schema-qualified via `withSchema()`, snake_case DB row -> camelCase
// domain type via mapRowToEntry.
//
// The repository accepts a `Kysely<Database> | Transaction<Database>` so
// the service layer can wrap a user mutation + audit insert in a single
// transaction (see withTransaction() in ./transaction.ts).
//
// Note: there is no `update` or `delete` method. The audit_log table is
// append-only by design (V004:20-21). No SELECT either: the audit log is
// out of scope for the user-facing API; future admin endpoints (P3) will
// read it directly via Kysely, bypassing this repository.
// =============================================================================

import type { Kysely, Transaction } from 'kysely';
import { withDbErrorMapping } from '@spark-match/shared/infra';
import type { AuditEntry } from '../domain/audit.js';
import type { Database } from './database.js';

export type { Database } from './database.js';

const IDENTITY = 'identity';

export interface AuditRepository {
  withDb(db: Kysely<Database> | Transaction<Database>): AuditRepository;
  insert(entry: AuditEntry): Promise<void>;
}

export function createAuditRepository(
  db: Kysely<Database> | Transaction<Database>,
): AuditRepository {
  return {
    withDb(newDb: Kysely<Database> | Transaction<Database>): AuditRepository {
      return createAuditRepository(newDb);
    },
    async insert(entry: AuditEntry): Promise<void> {
      await withDbErrorMapping('audit_log.insert', async () => {
        await db
          .withSchema(IDENTITY)
          .insertInto('audit_log')
          .values({
            action: entry.action,
            actor_user_id: entry.actorUserId,
            subject_user_id: entry.subjectUserId,
            metadata: JSON.stringify(entry.metadata),
          })
          .execute();
      });
    },
  };
}
