// =============================================================================
// GET /v1/reports/{reportId} - poll one report
// =============================================================================
// The other half of ADR-019 D4: the frontend calls this until `status` stops
// being `pending`. The "Generando tu reporte..." screen becomes true instead of
// a white lie.
//
// A report belonging to someone else answers 404, not 403 -- see the reasoning
// in service/report-service.ts. A missing path parameter is a 400: it means
// the route was wired wrong, not that the report is missing.
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicReport } from '../domain/to-public-report.js';
import {
  GetReportInputSchema,
  GetReportOutputSchema,
  type Report,
} from '../schemas/report.schema.js';

export const handler = buildHandler<unknown, Report>({
  name: 'reports-get-report',
  inputSchema: GetReportInputSchema,
  outputSchema: GetReportOutputSchema,
  logger: createLogger('reports-get-report'),
  tracer: new Tracer({ serviceName: 'reports-get-report' }),
  requireAuth: true,
  handler: async (_input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const reportId = event.pathParameters?.reportId;
    if (!reportId) {
      throw ApiError.badRequest('Missing reportId path parameter');
    }
    const ctx = await buildContext();
    const informe = await ctx.reportService.get({ actorUserId: auth.userId, reportId });
    return toPublicReport(informe);
  },
});
