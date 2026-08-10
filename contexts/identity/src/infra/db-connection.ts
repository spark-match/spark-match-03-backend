// =============================================================================
// DB connection (kysely) for the identity context
// =============================================================================
// What lives here is the `Kysely<Database>` typed against THIS context's
// schema. Opening the pool -- resolving the ARN from SSM, decrypting the
// credentials, configuring TLS and sizing -- moved to
// `@spark-match/shared/infra` when the reports context needed the same 35
// lines. See shared/src/infra/db-pool.ts for why they are not here.
//
// The pool is cached per Lambda container so cold starts pay the connection
// cost only once.
// =============================================================================

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { createDbPool } from '@spark-match/shared/infra';
import type { Database } from './user-repository.js';

let cachedPool: Pool | null = null;
let cachedDb: Kysely<Database> | null = null;

export async function getDbConnection(options?: {
  secretArn?: string;
  defaultSchema?: string;
}): Promise<Kysely<Database>> {
  if (cachedDb) return cachedDb;

  cachedPool = await createDbPool(options);
  cachedDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: cachedPool }) });

  return cachedDb;
}

export async function closeDbConnection(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
    cachedDb = null;
  }
}
