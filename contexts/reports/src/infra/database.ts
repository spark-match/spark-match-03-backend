// =============================================================================
// Database - shared Kysely schema for the reports context
// =============================================================================
// Single source of truth for the table-row types Kysely uses to type queries.
//
// Convention: snake_case columns match the Postgres schema exactly (see
// migrations/006). Each context that owns its own schema has its own
// database.ts at the same path -- this one is the `reports` schema, the
// identity one is at contexts/identity/src/infra/database.ts.
//
// Generated columns (DEFAULT gen_random_uuid(), DEFAULT current_timestamp)
// use Kysely's `Generated<T>` so inserts don't require them.
//
// `objects` and `top_careers` are JSONB: `ColumnType<unknown, string, string>`
// -- string at the DB boundary (we hand `JSON.stringify` to pg), `unknown` on
// the way out because the shape is validated in the domain, not asserted here.
// Typing the select side as the parsed shape would be a lie: nothing stops a
// row written by an older version from having a different one.
// =============================================================================

import type { ColumnType, Generated } from 'kysely';
import type { ReportStatus } from '../domain/orientation-report.js';

export interface Database {
  orientation_report: {
    id: Generated<string>;
    user_id: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    status: Generated<ReportStatus>;

    s3_bucket: string | null;
    objects: ColumnType<unknown, string | null, string | null>;

    schema_version: string | null;
    riasec_code: string | null;
    profile_completeness: ColumnType<string | null, number | null, number | null>;
    top_careers: ColumnType<unknown, string | null, string | null>;

    dataset_source: string | null;
    dataset_snapshot_date: ColumnType<Date | string | null, string | null, string | null>;

    model_id: string | null;
    langsmith_run_id: string | null;
    generation_ms: number | null;
    failure_reason: string | null;
  };
}
