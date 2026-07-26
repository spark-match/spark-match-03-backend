import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createSecretsReader, type SecretsReader } from '@spark-match/shared/infra';
import { createSsmReader, type SsmReader } from '@spark-match/shared/infra';
import type { Database } from '../infra/user-repository.js';

interface DbCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

let cachedPool: Pool | null = null;
let cachedDb: Kysely<Database> | null = null;

export async function getDbConnection(secretArn?: string): Promise<Kysely<Database>> {
  if (cachedDb) return cachedDb;

  const secrets: SecretsReader = createSecretsReader();
  const ssm: SsmReader = createSsmReader();

  const resolvedSecretArn = secretArn ?? (await ssm.getRequiredString('/spark-match/db/secret-arn'));
  const creds = await secrets.getJson<DbCredentials>(resolvedSecretArn);

  cachedPool = new Pool({
    host: creds.host,
    port: creds.port,
    database: creds.database,
    user: creds.username,
    password: creds.password,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
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
