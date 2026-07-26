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
//   The database URL is read from the MIGRATE_DATABASE_URL env var, which
//   is resolved by Terraform at deploy time from the same RDS instance the
//   other identity Lambdas connect to. The node-pg-migrate CLI resolves
//   `{{resolve:ssm:...}}` placeholders too, so we keep the Lambda env
//   config identical to what `npm run migrate:up` would use locally.
//
// VPC
//   The Lambda is attached to the same VPC + security group as the other
//   identity functions so it can reach the RDS instance over the private
//   network. Node 24 requires `NODE_EXTRA_CA_CERTS` to be set explicitly
//   (see template.yaml).
// =============================================================================

import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
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

export interface MigrateOutput {
  direction: 'up' | 'down' | 'status';
  applied: string[];
  log: string[];
}

export const handler = async (input: unknown): Promise<MigrateOutput> => {
  try {
    const parsed = parseMigrateInput(input);
    const databaseUrl = process.env.MIGRATE_DATABASE_URL;
    if (!databaseUrl) {
      throw ApiError.internal('MIGRATE_DATABASE_URL env var is not set');
    }
    const log: string[] = [];

    const baseOptions = {
      databaseUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: TRACKING_TABLE,
      schema: TRACKING_SCHEMA,
      migrationsSchema: TRACKING_SCHEMA,
      useGlob: true,
      migrationFileLanguage: 'sql' as const,
      count: 1,
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

    const result = (await runner({
      ...baseOptions,
      direction: parsed.direction,
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
