// =============================================================================
// POST /v1/reports/{reportId}/complete - the generator says it went well
// =============================================================================
// The other end of the two-part handshake ADR-019 D4 describes. `POST
// /v1/reports` opens the row in `pending` and this closes it: the agent
// renders, uploads the two objects to S3 and comes back with the keys.
//
// It is a POST on a sub-resource and not a `PATCH /v1/reports/{id}` with a
// `status` field. A PATCH would have to accept two bodies with nothing in
// common -- eleven fields on success, one sentence on failure -- discriminated
// by the very field being set, which turns two clean schemas into a `oneOf`
// that neither Zod nor the reader enjoys. Two routes, two shapes, two
// validations.
//
// The response is 200 and not 202: unlike opening a report, this really did
// finish. What comes back is the closed row, so the caller can check it landed
// as `ready` without a second round trip.
// =============================================================================

import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicReport } from '../domain/to-public-report.js';
import {
  CompleteReportInputSchema,
  CompleteReportOutputSchema,
  type CompleteReportBody,
  type Report,
} from '../schemas/report.schema.js';

export const handler = buildHandler<CompleteReportBody, Report>({
  name: 'reports-complete-report',
  inputSchema: CompleteReportInputSchema,
  outputSchema: CompleteReportOutputSchema,
  logger: createLogger('reports-complete-report'),
  tracer: new Tracer({ serviceName: 'reports-complete-report' }),
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
    const informe = await ctx.reportService.complete({
      actorUserId: auth.userId,
      reportId,
      // `?? null` sobre los cuatro opcionales: Zod los deja pasar como
      // `undefined` y la fila necesita un `null` explicito. Sin esto, un
      // `generation_ms` ausente no borraria el valor anterior en un
      // reintento -- se quedaria el de la generacion que fallo.
      result: {
        bucket: input.bucket,
        objects: input.objects,
        schemaVersion: input.schemaVersion,
        riasecCode: input.riasecCode,
        datasetSource: input.datasetSource,
        datasetSnapshotDate: input.datasetSnapshotDate,
        topCareers: input.topCareers,
        profileCompleteness: input.profileCompleteness ?? null,
        modelId: input.modelId ?? null,
        langsmithRunId: input.langsmithRunId ?? null,
        generationMs: input.generationMs ?? null,
      },
    });
    return toPublicReport(informe);
  },
});
