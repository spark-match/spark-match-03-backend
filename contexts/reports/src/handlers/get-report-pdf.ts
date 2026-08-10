// =============================================================================
// GET /v1/reports/{reportId}/pdf - el informe para descargar
// =============================================================================
// Lo que el estudiante se lleva. Sale con `Content-Disposition: attachment` y
// un nombre que solo lleva el id del informe: un fichero con su nombre o su
// codigo acabaria en la carpeta de descargas de un ordenador compartido.
// =============================================================================

import { serveReportObject } from './serve-report-object.js';

export const handler = serveReportObject('pdf', 'reports-get-report-pdf');
