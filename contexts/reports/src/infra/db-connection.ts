// =============================================================================
// DB connection (kysely) for the reports context
// =============================================================================
// Lo unico que vive aqui es el `Kysely<Database>` tipado contra el schema de
// ESTE contexto. Abrir el pool -- resolver el ARN por SSM, descifrar las
// credenciales, configurar TLS y el tamaño -- es infraestructura compartida y
// vive en `@spark-match/shared/infra`.
//
// El pool se cachea por contenedor de Lambda: el coste de SSM y Secrets
// Manager se paga en el arranque en frio y no en cada peticion.
// =============================================================================

import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import { createDbPool } from '@spark-match/shared/infra';
import type { Database } from './database.js';

let cachedPool: Pool | null = null;
let cachedDb: Kysely<Database> | null = null;

export async function getDbConnection(options?: { secretArn?: string }): Promise<Kysely<Database>> {
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
