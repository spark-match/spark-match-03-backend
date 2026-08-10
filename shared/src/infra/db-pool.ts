// =============================================================================
// db-pool - the one place that knows how to reach the Spark Match database
// =============================================================================
// Resolving the secret ARN from SSM, decrypting the credentials from Secrets
// Manager and configuring the pg Pool is infrastructure, not domain. It lived
// duplicated in every context that needed a database, which is 35 identical
// lines per context and, worse, 35 places to forget when the TLS settings or
// the pool size change.
//
// What stays in each context is the part that is genuinely theirs: the
// `Kysely<Database>` typed against their own schema. That is the coupling the
// bounded-context split exists to avoid, and it does not live here.
// =============================================================================

import { Pool } from 'pg';
import { createSecretsReader, type SecretsReader } from './secrets-reader.js';
import { createSsmReader, type SsmReader } from './ssm-reader.js';
import { ssmConfigPath } from './ssm-config-path.js';
import { withAwsErrorMapping } from './aws-wrapper.js';

interface DbCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/** Clave del contrato cross-repo de ADR-0002. */
const SSM_DB_SECRET_ARN_KEY = 'db-secret-arn';

/**
 * Abre un pool contra la base de datos del proyecto.
 *
 * El caller decide si lo cachea: en Lambda se guarda por contenedor para que
 * el coste de SSM y Secrets Manager se pague en el arranque en frio y no en
 * cada peticion.
 *
 * @param options.secretArn Salta la consulta a SSM. Para tests y para las
 *   Lambdas que ya reciben el ARN por otra via.
 */
export async function createDbPool(options?: { secretArn?: string }): Promise<Pool> {
  const secrets: SecretsReader = createSecretsReader();
  const ssm: SsmReader = createSsmReader();

  const resolvedSecretArn =
    options?.secretArn ??
    (await withAwsErrorMapping('SSM', () =>
      ssm.getRequiredString(ssmConfigPath(SSM_DB_SECRET_ARN_KEY)),
    ));

  const creds = await withAwsErrorMapping('Secrets Manager', () =>
    secrets.getJson<DbCredentials>(resolvedSecretArn),
  );

  return new Pool({
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
    // opcional. `rejectUnauthorized: false` cifra el transporte pero NO valida
    // la cadena del certificado: la conexion viaja dentro de la VPC, de la ENI
    // de la Lambda al endpoint de RDS, sin pasar por internet. Validar con el
    // CA bundle de AWS es follow-up explicito del plan de despliegue -- hoy no
    // hay ningun .pem en el repositorio, pese a que el template SAM referencia
    // uno via NODE_EXTRA_CA_CERTS.
    ssl: { rejectUnauthorized: false },
  });
}
