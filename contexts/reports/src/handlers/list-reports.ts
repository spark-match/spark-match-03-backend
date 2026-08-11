// =============================================================================
// GET /v1/reports - the caller's own reports, newest first
// =============================================================================
// Not in the original phase-5 plan, and it earns its place: the ADR (D2) left
// the two UXes open -- one report that gets replaced, or a list by date -- and
// said the design should not have to choose now. A list endpoint is what keeps
// that promise; without it the decision is made by omission.
//
// No filters and no cursor. Identity's audit log has both because an admin
// browses thousands of rows; a student has a handful of reports and paging
// them would be machinery in search of a problem. The repository caps the
// limit anyway, so a caller asking for ten thousand gets two hundred.
//
// Since 2026-08-11 it also answers whether another report can be requested
// (`eligibility`). That is what lets the agent ask BEFORE delegating instead of
// finding out at `POST /v1/reports`, i.e. after a full report has been written.
// See `ReportEligibility` in the service for why it rides along here rather
// than on a route of its own.
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicReport } from '../domain/to-public-report.js';
import {
  ListReportsInputSchema,
  ListReportsOutputSchema,
  type Report,
  type ReportEligibility,
} from '../schemas/report.schema.js';

interface ListReportsResponse {
  reports: Report[];
  eligibility: ReportEligibility | null;
}

export const handler = buildHandler<unknown, ListReportsResponse>({
  name: 'reports-list-reports',
  inputSchema: ListReportsInputSchema,
  outputSchema: ListReportsOutputSchema,
  logger: createLogger('reports-list-reports'),
  tracer: new Tracer({ serviceName: 'reports-list-reports' }),
  requireAuth: true,
  handler: async (_input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const crudo = event.queryStringParameters?.limit;
    const limit = crudo === undefined ? undefined : Number(crudo);
    if (limit !== undefined && !Number.isInteger(limit)) {
      throw ApiError.badRequest('limit must be an integer');
    }

    const ctx = await buildContext();
    const { reports, eligibility } = await ctx.reportService.list({
      actorUserId: auth.userId,
      limit,
    });
    return { reports: reports.map(toPublicReport), eligibility };
  },
});
