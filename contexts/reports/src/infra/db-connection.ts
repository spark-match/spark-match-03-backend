// =============================================================================
// DB connection (kysely + node-postgres pool) for the reports context
// =============================================================================
// Same shape as contexts/identity/src/infra/db-connection.ts, typed against
// this context's `Database`. Duplicated rather than shared on purpose: the two
// contexts own different schemas, and a single connection module would have to
// be generic over the row types, which is exactly the coupling the bounded
// context split exists to avoid.
//
// The credentials are the same RDS instance and the same secret. That is not a
// contradiction: one database, one schema per context, and each context
// reaching it with its own types.
// =============================================================================

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  createSecretsReader,
  createSsmReader,
  ssmConfigPath,
  withAwsErrorMapping,
  type SecretsReader,
  type SsmReader,
} from '@spark-match/shared/infra';
import type { Database } from './database.js';

interface DbCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

let cachedPool: Pool | null = null;
let cachedDb: Kysely<Database> | null = null;

export async function getDbConnection(options?: { secretArn?: string }): Promise<Kysely<Database>> {
  if (cachedDb) return cachedDb;

  const secrets: SecretsReader = createSecretsReader();
  const ssm: SsmReader = createSsmReader();

  const resolvedSecretArn =
    options?.secretArn ??
    (await withAwsErrorMapping('SSM', () => ssm.getRequiredString(ssmConfigPath('db-secret-arn'))));

  const creds = await withAwsErrorMapping('Secrets Manager', () =>
    secrets.getJson<DbCredentials>(resolvedSecretArn),
  );

  cachedPool = new Pool({
    host: creds.host,
    port: creds.port,
    database: creds.database,
    user: creds.username,
    password: creds.password,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'spark-match-backend',
    // Igual que en identity: RDS 15+ rechaza conexiones sin TLS, y
    // `rejectUnauthorized: false` cifra sin validar la cadena porque el
    // trafico no sale de la VPC. Validar con el CA bundle de AWS sigue siendo
    // follow-up del plan de despliegue, alli y aqui.
    ssl: { rejectUnauthorized: false },
  });

  cachedDb = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: cachedPool }),
  });

  return cachedDb;
}

export async function closeDbConnection(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = null;
    cachedDb = null;
  }
}
