// =============================================================================
// GET /v1/reports/{reportId}/content - el informe en JSON
// =============================================================================
// El documento que produjo el agente, con su `schema_version`, tal cual se
// guardo. Es la fuente de la que sale el PDF, y lo que un cliente distinto del
// navegador (o una version futura del frontend) puede volver a maquetar sin
// pagar otra llamada al modelo.
// =============================================================================

import { serveReportObject } from './serve-report-object.js';

export const handler = serveReportObject('json', 'reports-get-report-content');
