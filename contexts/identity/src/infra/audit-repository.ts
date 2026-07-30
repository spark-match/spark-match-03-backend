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
// `list()` returns audit entries filtered by admin-supplied criteria.
// Cursor pagination is stable: (occurred_at DESC, id DESC) gives a total
// order on emitted rows, regardless of insertion order.
//
// `id` is BIGSERIAL in the DB (not UUID). `occurredAt` is server-side
// timestamp with default current_timestamp() on insert.
//
// Note: there is no `update` or `delete` method. The audit_log table is
// append-only by design (V004:20-21).
// =============================================================================

import type { Kysely, Transaction } from 'kysely';
import { withDbErrorMapping } from '@spark-match/shared/infra';
import type { AuditEntry } from '../domain/audit.js';
import type { Database } from './database.js';

export type { Database } from './database.js';

const IDENTITY = 'identity';

export interface AuditListFilters {
  actorUserId?: string;
  subjectUserId?: string;
  action?: string;
  since?: string; // ISO datetime (inclusive)
  until?: string; // ISO datetime (inclusive)
  limit?: number;
  cursor?: string;
}

export interface AuditRepository {
  withDb(db: Kysely<Database> | Transaction<Database>): AuditRepository;
  insert(entry: AuditEntry): Promise<void>;
  list(filters: AuditListFilters): Promise<{ entries: AuditEntry[]; nextCursor: string | null }>;
}

interface AuditRow {
  id: string;
  occurred_at: Date;
  action: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  metadata: unknown;
}

function mapRowToEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action as AuditEntry['action'],
    actorUserId: row.actor_user_id,
    subjectUserId: row.subject_user_id,
    metadata: row.metadata as AuditEntry['metadata'],
  };
}

/** Encode cursor as base64(JSON({occurredAt, id})) so the format is opaque to clients. */
function encodeCursor(occurredAt: Date, id: string): string {
  const payload = JSON.stringify({ t: occurredAt.toISOString(), i: id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/** Decode and validate cursor. Returns null on malformed input. */
function decodeCursor(cursor: string): { occurredAt: Date; id: string } | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null;
    const occurredAt = new Date(parsed.t);
    if (Number.isNaN(occurredAt.getTime())) return null;
    return { occurredAt, id: parsed.i };
  } catch {
    return null;
  }
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

    async list(filters) {
      return withDbErrorMapping('audit_log.list', async () => {
        const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
        // Fetch limit+1 to detect "has more" without a separate count query
        const pageLimit = limit + 1;

        let query = db
          .withSchema(IDENTITY)
          .selectFrom('audit_log')
          .selectAll()
          .orderBy('occurred_at', 'desc')
          .orderBy('id', 'desc')
          .limit(pageLimit);

        if (filters.actorUserId) {
          query = query.where('actor_user_id', '=', filters.actorUserId);
        }
        if (filters.subjectUserId) {
          query = query.where('subject_user_id', '=', filters.subjectUserId);
        }
        if (filters.action) {
          query = query.where('action', '=', filters.action);
        }
        if (filters.since) {
          query = query.where('occurred_at', '>=', new Date(filters.since));
        }
        if (filters.until) {
          query = query.where('occurred_at', '<=', new Date(filters.until));
        }

        // Cursor-based pagination: skip the row at (cursor.occurredAt,
        // cursor.id) and everything after it in the (occurred_at DESC, id
        // DESC) ordering. Implemented with a tuple comparison in SQL.
        if (filters.cursor) {
          const decoded = decodeCursor(filters.cursor);
          if (!decoded) {
            return { entries: [], nextCursor: null };
          }
          query = query.where(({ eb, fn }) =>
            eb.or([
              eb('occurred_at', '<', decoded.occurredAt),
              eb.and([eb('occurred_at', '=', decoded.occurredAt), eb('id', '<', decoded.id)]),
            ]),
          );
        }

        const rows = (await query.execute()) as unknown as AuditRow[];
        const entries = rows.slice(0, limit).map(mapRowToEntry);
        const hasMore = rows.length > limit;

        const lastEntry = entries.at(-1);
        const nextCursor =
          hasMore && lastEntry
            ? encodeCursor(lastEntry.occurredAt!, lastEntry.id!)
            : null;

        return { entries, nextCursor };
      });
    },
  };
}
