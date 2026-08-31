// =============================================================================
// POST /v1/reports - open an orientation report
// =============================================================================
// Answers 202, not 200 (ADR-019 D4). The row is created `pending` and the
// artefact does not exist yet; 200 would tell the client the resource is ready
// and contradict the polling loop the response itself starts.
//
// The owner comes from the JWT, never from the payload -- otherwise anyone
// could open a report in someone else's name. What the body does carry is the
// state of the profile (ADR-019 D8), which is not something this side can look
// up: it lives in the agent's store.
//
// The 409 for "already generating" is not raised here: it comes up from the
// repository, which turns the partial unique index violation into it. That is
// on purpose. The rule lives in the database, so the error should originate
// where the rule is enforced rather than being re-checked here, which would be
// a second read that a concurrent request can invalidate between check and
// insert.
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicReport } from '../domain/to-public-report.js';
import {
  CreateReportInputSchema,
  CreateReportOutputSchema,
  type CreateReportBody,
  type Report,
} from '../schemas/report.schema.js';

export const handler = buildHandler<CreateReportBody, Report>({
  name: 'reports-create-report',
  inputSchema: CreateReportInputSchema,
  outputSchema: CreateReportOutputSchema,
  logger: createLogger('reports-create-report'),
  tracer: new Tracer({ serviceName: 'reports-create-report' }),
  requireAuth: true,
  successStatusCode: 202,
  handler: async (input, _event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const ctx = await buildContext();
    const informe = await ctx.reportService.request({
      userId: auth.userId,
      profileCompleteness: input.profileCompleteness,
      riasecCode: input.riasecCode,
    });
    return toPublicReport(informe);
  },
});
