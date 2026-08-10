// =============================================================================
// POST /v1/reports/{reportId}/fail - the generator says it went wrong
// =============================================================================
// Without this route a failed generation is indistinguishable from a slow one
// until the ten-minute sweep in the service catches it. The student would sit
// in front of "Generando tu reporte de orientacion..." for a quarter of an
// hour before anything told them it was never coming. The sweep exists for the
// cases nobody can report -- the container dies, the tab closes -- not for the
// ones the generator knows about and can say out loud.
//
// See complete-report.ts for why this is a POST on a sub-resource rather than
// a PATCH carrying a status.
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicReport } from '../domain/to-public-report.js';
import {
  FailReportInputSchema,
  FailReportOutputSchema,
  type FailReportBody,
  type Report,
} from '../schemas/report.schema.js';

export const handler = buildHandler<FailReportBody, Report>({
  name: 'reports-fail-report',
  inputSchema: FailReportInputSchema,
  outputSchema: FailReportOutputSchema,
  logger: createLogger('reports-fail-report'),
  tracer: new Tracer({ serviceName: 'reports-fail-report' }),
  requireAuth: true,
  handler: async (input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const reportId = event.pathParameters?.reportId;
    if (!reportId) {
      throw ApiError.badRequest('Missing reportId path parameter');
    }
    const ctx = await buildContext();
    const informe = await ctx.reportService.fail({
      actorUserId: auth.userId,
      reportId,
      reason: input.reason,
    });
    return toPublicReport(informe);
  },
});
