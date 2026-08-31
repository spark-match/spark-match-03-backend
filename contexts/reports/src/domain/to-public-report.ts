// =============================================================================
// Public projection of an orientation report
// =============================================================================
// Mirrors `schemas/report.schema.ts`. Kept in sync manually, same convention
// as identity's `toPublicUser` (ADR-013).
//
// What it drops matters more than what it keeps:
//
//   - `userId`, because the caller is the owner and the service already
//     refused to hand over anyone else's report.
//   - `bucket`, because the client never talks to S3 -- it downloads through
//     the backend with its JWT -- so the bucket name is of no use to it and
//     publishing it hands half a resource ARN to anyone reading a response.
//   - `modelId` and `langsmithRunId`, which are operational trace, not part of
//     the student's report.
// =============================================================================

import type { Report } from '../schemas/report.schema.js';
import type { OrientationReport } from './orientation-report.js';

export function toPublicReport(informe: OrientationReport): Report {
  return {
    id: informe.id,
    status: informe.status,
    createdAt: informe.createdAt.toISOString(),
    updatedAt: informe.updatedAt.toISOString(),
    objects: informe.objects,
    schemaVersion: informe.schemaVersion,
    riasecCode: informe.riasecCode,
    profileCompleteness: informe.profileCompleteness,
    topCareers: informe.topCareers,
    datasetSource: informe.datasetSource,
    datasetSnapshotDate: informe.datasetSnapshotDate,
    generationMs: informe.generationMs,
    failureReason: informe.failureReason,
  };
}
