// =============================================================================
// withTransaction - thin wrapper around kysely's transaction() for service
// operations that touch multiple tables.
// =============================================================================
// Kysely natively supports `db.transaction().execute(async (tx) => {...})`,
// but the callback signature returns `Transaction<Database>`, which the
// repository factories must accept. This helper:
//
//   1. Sets the default isolation level to READ COMMITTED (Postgres default,
//      suitable for short-lived service-layer transactions).
//   2. Runs the callback with the transaction handle.
//   3. Lets thrown errors propagate; Kysely rolls back automatically on
//      any thrown error and commits on successful return.
//
// The repos (`user-repository.ts`, `audit-repository.ts`) accept either
// `Kysely<Database>` or `Transaction<Database>` so the service layer can
// pass the `tx` handle to both repos in a single transaction.
//
// Usage:
//   await withTransaction(db, async (tx) => {
//     const user = await userRepository.withDb(tx).update(...);
//     await auditRepository.withDb(tx).insert({...});
//   });
//
// Note: the current repos are factories that capture `db` by closure. To
// support per-call transactions, the repos expose a `withDb()` rebuilder
// method (see user-repository.ts and audit-repository.ts) that swaps the
// handle.
// =============================================================================

import type { Kysely, Transaction } from 'kysely';
import type { Database } from './database.js';

export type TxOrDb = Kysely<Database> | Transaction<Database>;

const READ_COMMITTED = 'read committed';

export async function withTransaction<T>(
  db: Kysely<Database>,
  fn: (tx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db
    .transaction()
    .setIsolationLevel(READ_COMMITTED)
    .execute(fn);
}
