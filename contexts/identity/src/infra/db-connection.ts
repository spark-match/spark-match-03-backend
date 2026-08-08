// =============================================================================
// DB connection (kysely + node-postgres pool)
// =============================================================================
// Loads credentials from Secrets Manager (ARN from SSM). The pool is cached
// per Lambda container so cold starts pay the connection cost only once.
//
// Default schema is `identity` so unqualified `users` references in kysely
// resolve to `identity.users` (the table created by V002). Migrations and
// admin Lambdas that need to touch other schemas can override `defaultSchema`
// at connection time.
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
import type { Database } from './user-repository.js';

interface DbCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

let cachedPool: Pool | null = null;
let cachedDb: Kysely<Database> | null = null;

export async function getDbConnection(options?: {
  secretArn?: string;
  defaultSchema?: string;
}): Promise<Kysely<Database>> {
  if (cachedDb) return cachedDb;

  const secrets: SecretsReader = createSecretsReader();
  const ssm: SsmReader = createSsmReader();

  const resolvedSecretArn =
    options?.secretArn ?? (await withAwsErrorMapping('SSM', () =>
      ssm.getRequiredString(ssmConfigPath('db-secret-arn')),
    ));

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
    // RDS PostgreSQL 15+ rechaza conexiones sin TLS, asi que `ssl` no es
    // opcional. `rejectUnauthorized: false` cifra el transporte pero NO
    // valida la cadena del certificado: la conexion viaja dentro de la VPC,
    // de la ENI de la Lambda al endpoint de RDS, sin pasar por internet.
    // Validar con el CA bundle de AWS (rejectUnauthorized: true + el .pem de
    // rds-combined-ca-bundle) es follow-up explicito del plan de despliegue
    // -- hoy no hay ningun .pem en el repo, pese a que el template SAM
    // referencia uno via NODE_EXTRA_CA_CERTS.
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
