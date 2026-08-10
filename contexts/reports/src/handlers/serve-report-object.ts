// =============================================================================
// Fabrica de los dos endpoints que sirven el contenido de un informe
// =============================================================================
// `GET /v1/reports/{reportId}/content` y `.../pdf` se diferencian en una sola
// palabra. Escribirlos dos veces enteros sería copiar tambien el control de
// propiedad y el 400 del path parameter, que son justo las dos cosas que no
// pueden divergir entre ellos.
//
// Devuelven BYTES, no el sobre JSON: ver `RawPayload` en shared. El JSON del
// informe se sirve tal cual salio de S3 para que el `checksumSha256` que
// guarda la fila siga describiendo lo que el cliente recibe.
// =============================================================================

import { buildHandler, rawPayload } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import type { ReportObjectKind } from '../infra/report-object-store.js';
import { GetReportInputSchema } from '../schemas/report.schema.js';

export function serveReportObject(kind: ReportObjectKind, name: string) {
  return buildHandler({
    name,
    inputSchema: GetReportInputSchema,
    // Sin `outputSchema`: el generador de OpenAPI emite esquemas de respuesta
    // JSON y esto no devuelve JSON estructurado sino un fichero. Declarar uno
    // aqui documentaria una forma que el endpoint no tiene.
    logger: createLogger(name),
    tracer: new Tracer({ serviceName: name }),
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
      const contenido = await ctx.reportService.getContent({
        actorUserId: auth.userId,
        reportId,
        kind,
      });
      return rawPayload(contenido.bytes, contenido.contentType, contenido.fileName);
    },
  });
}
