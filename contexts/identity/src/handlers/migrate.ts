// =============================================================================
// migrate.ts - Standalone Lambda that runs node-pg-migrate against RDS
// =============================================================================
// INVOCATION MODEL
//   This function is NOT exposed via HTTP. It is invoked directly via the
//   AWS SDK (or `sam local invoke` in dev) by the CI/CD pipeline:
//
//     aws lambda invoke \
//       --function-name spark-match-identity-migrate-dev \
//       --payload '{"direction":"up"}' \
//       --cli-binary-format raw-in-base64-out \
//       out.json
//
//   Authentication is IAM-based: the caller (CI/CD role, dev workstation)
//   needs `lambda:InvokeFunction` permission. No static tokens, no HTTP
//   surface, no CORS.
//
// EVENT SHAPE
//   Input (JSON):  { "direction": "up" | "down" | "status" }
//   Output (JSON): { "direction", "applied": string[], "log": string[] }
//
// CONFIG
//   El DSN se lee en runtime del SecureString /spark-match/{env}/config/
//   db-connection-url (contrato ADR-0002), descifrandolo con
//   getRequiredSecureString.
//
//   Antes se leia de la env var MIGRATE_DATABASE_URL poblada con
//   `{{resolve:ssm:...}}` en el template SAM. Eso no podia funcionar:
//   `{{resolve:ssm:}}` NO descifra SecureString (devuelve el ciphertext), y
//   `{{resolve:ssm-secure:}}` no es una propiedad soportada dentro de
//   Environment.Variables de una Lambda. MIGRATE_DATABASE_URL sigue
//   respetandose como override para correr las migraciones en local contra
//   un Postgres de docker.
//
// VPC
//   The Lambda is attached to the same VPC + security group as the other
//   identity functions so it can reach the RDS instance over the private
//   network.
// =============================================================================

import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { createSsmReader, ssmConfigPath } from '@spark-match/shared/infra';
import { runner } from 'node-pg-migrate';
import { resolve } from 'node:path';
import { z } from 'zod';

const logger = createLogger('identity-migrate');

const MigrateInputSchema = z.object({
  direction: z.enum(['up', 'down', 'status']).default('up'),
});

function parseMigrateInput(input: unknown): z.infer<typeof MigrateInputSchema> {
  const result = MigrateInputSchema.safeParse(input ?? {});
  if (!result.success) {
    throw ApiError.fromZodError(result.error);
  }
  return result.data;
}

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');
const TRACKING_TABLE = 'spark_match_migrations';
const TRACKING_SCHEMA = 'public';

/**
 * DSN de Postgres. Prioriza MIGRATE_DATABASE_URL (override local contra un
 * Postgres de docker) y si no esta, lee el SecureString del contrato
 * ADR-0002 y lo descifra.
 */
async function resolveDatabaseUrl(): Promise<string> {
  const override = process.env.MIGRATE_DATABASE_URL;
  if (override) return withSslMode(override);

  const ssm = createSsmReader();
  const dsn = await ssm.getRequiredSecureString(ssmConfigPath('db-connection-url'));
  return withSslMode(dsn);
}

/**
 * Terraform arma la URL sin parametros de TLS
 * (`postgres://user:pass@host:port/db`), pero RDS PostgreSQL 15+ rechaza
 * conexiones sin cifrar. `no-verify` cifra el transporte sin validar la
 * cadena del certificado, igual que el `rejectUnauthorized: false` de
 * db-connection.ts: el trafico no sale de la VPC. Validar contra el CA
 * bundle de AWS es follow-up explicito del plan de despliegue.
 */
function withSslMode(dsn: string): string {
  if (dsn.includes('sslmode=')) return dsn;
  return `${dsn}${dsn.includes('?') ? '&' : '?'}sslmode=no-verify`;
}

export interface MigrateOutput {
  direction: 'up' | 'down' | 'status';
  applied: string[];
  log: string[];
}

export const handler = async (input: unknown): Promise<MigrateOutput> => {
  try {
    const parsed = parseMigrateInput(input);
    const databaseUrl = await resolveDatabaseUrl();
    const log: string[] = [];

    const baseOptions = {
      databaseUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: TRACKING_TABLE,
      schema: TRACKING_SCHEMA,
      migrationsSchema: TRACKING_SCHEMA,
      migrationFileLanguage: 'sql' as const,
      singleTransaction: true,
      checkOrder: true,
      verbose: true,
      logger: {
        info: (msg: string) => log.push(`[info] ${msg}`),
        warn: (msg: string) => log.push(`[warn] ${msg}`),
        error: (msg: string) => log.push(`[error] ${msg}`),
        debug: (msg: string) => log.push(`[debug] ${msg}`),
      },
    };

    if (parsed.direction === 'status') {
      const applied = (await runner({
        ...baseOptions,
        direction: 'up',
        dryRun: true,
        noLock: true,
      })) as Array<{ name: string }>;
      return {
        direction: 'status',
        applied: applied.map((m) => m.name),
        log,
      };
    }

    // `up` sin count: aplica TODAS las migraciones pendientes en una sola
    // invocacion. Antes baseOptions traia `count: 1`, lo que obligaba a
    // invocar la Lambda una vez por migracion -- con 4 archivos en
    // migrations/, un deploy limpio quedaba a medio migrar salvo que
    // alguien se acordara de invocarla 4 veces.
    //
    // `down` SI conserva count: 1: revertir el historial completo de un
    // golpe ante un `{"direction":"down"}` sin argumentos borraria el schema
    // entero. Un rollback profundo se hace invocando varias veces, a
    // proposito.
    const result = (await runner({
      ...baseOptions,
      direction: parsed.direction,
      ...(parsed.direction === 'down' ? { count: 1 } : {}),
    })) as Array<{ name: string }>;

    logger.info(`Migration ${parsed.direction} completed`, {
      applied: result.map((m) => m.name),
    });

    return {
      direction: parsed.direction,
      applied: result.map((m) => m.name),
      log,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error('Migration run failed', { err });
    throw ApiError.internal('Migration run failed', err);
  }
};
