import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequest, mockGet, mockList, mockGetContent, mockComplete, mockFail, mockBuildContext } =
  vi.hoisted(() => ({
    mockRequest: vi.fn(),
    mockGet: vi.fn(),
    mockList: vi.fn(),
    mockGetContent: vi.fn(),
    mockComplete: vi.fn(),
    mockFail: vi.fn(),
    mockBuildContext: vi.fn(),
  }));

vi.mock('../composition.js', () => ({ buildContext: mockBuildContext }));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: class {
    isTracingEnabled() {
      return false;
    }
    getSegment() {
      return { addNewSubsegment: () => ({ close: () => {} }) };
    }
    captureAsyncFunc() {}
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler as createReport } from './create-report.js';
import { handler as getReport } from './get-report.js';
import { handler as listReports } from './list-reports.js';
import { handler as getReportContent } from './get-report-content.js';
import { handler as getReportPdf } from './get-report-pdf.js';
import { handler as completeReport } from './complete-report.js';
import { handler as failReport } from './fail-report.js';

const USUARIO = '11111111-1111-4111-8111-111111111111';
const INFORME = '22222222-2222-4222-8222-222222222222';

/** El cuerpo que la puerta de D8 espera en `POST /v1/reports`. */
const PERFIL = { profileCompleteness: 0.8, riasecCode: 'SIA' };

/** Lo que el generador devuelve al cerrar bien. */
const RESULTADO = {
  bucket: 'spark-match-reports-dev',
  objects: {
    json: {
      key: `reports/${USUARIO}/${INFORME}.json`,
      versionId: 'v1',
      sizeBytes: 10,
      checksumSha256: 'aaa',
    },
    pdf: {
      key: `reports/${USUARIO}/${INFORME}.pdf`,
      versionId: 'v2',
      sizeBytes: 20,
      checksumSha256: 'bbb',
    },
  },
  schemaVersion: '1',
  riasecCode: 'SIA',
  datasetSource: 'Ponte en Carrera (MINEDU)',
  datasetSnapshotDate: '2026-06-13',
  topCareers: ['Psicologia'],
};

const FILA = {
  id: INFORME,
  userId: USUARIO,
  createdAt: new Date('2026-08-10T10:00:00.000Z'),
  updatedAt: new Date('2026-08-10T10:00:00.000Z'),
  status: 'pending' as const,
  bucket: 'spark-match-reports-dev',
  objects: null,
  schemaVersion: null,
  riasecCode: null,
  profileCompleteness: null,
  topCareers: null,
  datasetSource: null,
  datasetSnapshotDate: null,
  modelId: 'claude-opus-5',
  langsmithRunId: '33333333-3333-4333-8333-333333333333',
  generationMs: null,
  failureReason: null,
};

function makeEvent(overrides: Record<string, unknown> = {}, autenticado = true) {
  return {
    version: '2.0',
    routeKey: 'POST /v1/reports',
    rawPath: '/v1/reports',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method: 'POST',
        path: '/v1/reports',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-1',
      routeKey: 'POST /v1/reports',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
      ...(autenticado ? { authorizer: { lambda: { userId: USUARIO, role: 'student' } } } : {}),
    },
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

type Respuesta = {
  statusCode: number;
  body: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
};
const invocar = (h: unknown, ev: APIGatewayProxyEventV2): Promise<Respuesta> =>
  (h as (e: APIGatewayProxyEventV2) => Promise<Respuesta>)(ev);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildContext.mockResolvedValue({
    reportService: {
      request: mockRequest,
      get: mockGet,
      list: mockList,
      getContent: mockGetContent,
      complete: mockComplete,
      fail: mockFail,
    },
  });
});

describe('POST /v1/reports', () => {
  const abrir = (cuerpo: unknown = PERFIL) => makeEvent({ body: JSON.stringify(cuerpo) });

  it('responde 202 y no 200', async () => {
    // El informe se ha ACEPTADO, no completado. Un 200 diria que ya esta
    // listo y contradiria al sondeo que la propia respuesta arranca.
    mockRequest.mockResolvedValue(FILA);

    const respuesta = await invocar(createReport, abrir());

    expect(respuesta.statusCode).toBe(202);
    expect(JSON.parse(respuesta.body).data.status).toBe('pending');
  });

  it('el dueño sale del token, nunca del cuerpo', async () => {
    mockRequest.mockResolvedValue(FILA);

    await invocar(createReport, abrir({ ...PERFIL, userId: 'otro' }));

    expect(mockRequest).toHaveBeenCalledWith({ userId: USUARIO, ...PERFIL });
  });

  it('pasa al servicio lo que el agente dice del perfil', async () => {
    // El backend no puede averiguarlo: el perfil vive en el store del agente.
    mockRequest.mockResolvedValue(FILA);

    await invocar(createReport, abrir({ profileCompleteness: 0.42, riasecCode: 'RIA' }));

    expect(mockRequest).toHaveBeenCalledWith({
      userId: USUARIO,
      profileCompleteness: 0.42,
      riasecCode: 'RIA',
    });
  });

  it('un RIASEC ausente llega al servicio como null, no como 400', async () => {
    // Que falte no es una peticion mal construida, es el caso normal de quien
    // no ha terminado el assessment. Tiene que salir como el 409 con codigo
    // que el agente convierte en una pregunta.
    mockRequest.mockResolvedValue(FILA);

    await invocar(createReport, abrir({ profileCompleteness: 0.3, riasecCode: null }));

    expect(mockRequest).toHaveBeenCalledWith({
      userId: USUARIO,
      profileCompleteness: 0.3,
      riasecCode: null,
    });
  });

  it('sin cuerpo, 400', async () => {
    expect((await invocar(createReport, makeEvent())).statusCode).toBe(400);
  });

  it('una completitud fuera de 0..1 es 400', async () => {
    const ev = abrir({ profileCompleteness: 42, riasecCode: 'SIA' });

    expect((await invocar(createReport, ev)).statusCode).toBe(400);
  });

  it('un codigo que no son tres letras Holland es 400', async () => {
    // 'XYZ' no existe como codigo; dejarlo pasar seria buscar afinidad contra
    // un codigo que el motor no sabe puntuar.
    const ev = abrir({ profileCompleteness: 0.8, riasecCode: 'XYZ' });

    expect((await invocar(createReport, ev)).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    const ev = makeEvent({ body: JSON.stringify(PERFIL) }, false);
    expect((await invocar(createReport, ev)).statusCode).toBe(401);
  });

  it('deja subir el 409 del repositorio tal cual', async () => {
    // La regla vive en la base de datos. Volver a comprobarla aqui seria una
    // segunda lectura que otra peticion puede invalidar entre medias.
    const { ApiError } = await import('@spark-match/shared/http');
    mockRequest.mockRejectedValue(ApiError.conflict('A report is already being generated'));

    expect((await invocar(createReport, abrir())).statusCode).toBe(409);
  });

  it('deja subir el 429 del tope diario', async () => {
    const { ApiError } = await import('@spark-match/shared/http');
    mockRequest.mockRejectedValue(ApiError.tooManyRequests('Daily report limit reached'));

    expect((await invocar(createReport, abrir())).statusCode).toBe(429);
  });
});

describe('POST /v1/reports/{reportId}/complete', () => {
  const cerrar = (cuerpo: unknown = RESULTADO) =>
    makeEvent({
      routeKey: 'POST /v1/reports/{reportId}/complete',
      pathParameters: { reportId: INFORME },
      body: JSON.stringify(cuerpo),
    });

  it('cierra el informe y responde 200, no 202', async () => {
    // A diferencia de abrirlo, esto si termino. El 202 aqui arrancaria un
    // sondeo sobre algo que ya no se mueve.
    mockComplete.mockResolvedValue({ ...FILA, status: 'ready' as const });

    const respuesta = await invocar(completeReport, cerrar());

    expect(respuesta.statusCode).toBe(200);
    expect(JSON.parse(respuesta.body).data.status).toBe('ready');
  });

  it('el id sale de la ruta y el dueño del token', async () => {
    mockComplete.mockResolvedValue({ ...FILA, status: 'ready' as const });

    await invocar(completeReport, cerrar());

    expect(mockComplete).toHaveBeenCalledWith({
      actorUserId: USUARIO,
      reportId: INFORME,
      result: expect.objectContaining({ bucket: 'spark-match-reports-dev' }),
    });
  });

  it('los opcionales ausentes viajan como null, no como undefined', async () => {
    // Sin el `?? null`, un reintento que no traiga `generation_ms` dejaria en
    // la fila el de la generacion anterior en vez de borrarlo.
    mockComplete.mockResolvedValue({ ...FILA, status: 'ready' as const });

    await invocar(completeReport, cerrar());

    expect(mockComplete.mock.calls[0][0].result).toMatchObject({
      profileCompleteness: null,
      modelId: null,
      langsmithRunId: null,
      generationMs: null,
    });
  });

  it('un cierre al que le falta un campo obligatorio es 400', async () => {
    // Mejor aqui, diciendo que campo falta, que contra la restriccion
    // `orientation_report_ready_is_complete` a las tres de la mañana.
    const { objects: _objects, ...sinObjetos } = RESULTADO;

    expect((await invocar(completeReport, cerrar(sinObjetos))).statusCode).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('sin reportId en la ruta, 400', async () => {
    const ev = makeEvent({
      routeKey: 'POST /v1/reports/{reportId}/complete',
      body: JSON.stringify(RESULTADO),
    });

    expect((await invocar(completeReport, ev)).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    const ev = makeEvent(
      { pathParameters: { reportId: INFORME }, body: JSON.stringify(RESULTADO) },
      false,
    );

    expect((await invocar(completeReport, ev)).statusCode).toBe(401);
  });

  it('cerrar uno que ya estaba cerrado sube como 409', async () => {
    const { ApiError } = await import('@spark-match/shared/http');
    mockComplete.mockRejectedValue(ApiError.conflict('The report is already closed'));

    expect((await invocar(completeReport, cerrar())).statusCode).toBe(409);
  });

  it('el informe de otro es 404', async () => {
    const { ApiError } = await import('@spark-match/shared/http');
    mockComplete.mockRejectedValue(ApiError.notFound('Report'));

    expect((await invocar(completeReport, cerrar())).statusCode).toBe(404);
  });
});

describe('POST /v1/reports/{reportId}/fail', () => {
  const fallar = (cuerpo: unknown = { reason: 'WeasyPrint no esta disponible' }) =>
    makeEvent({
      routeKey: 'POST /v1/reports/{reportId}/fail',
      pathParameters: { reportId: INFORME },
      body: JSON.stringify(cuerpo),
    });

  it('marca el informe como fallido con su motivo', async () => {
    mockFail.mockResolvedValue({ ...FILA, status: 'failed' as const });

    const respuesta = await invocar(failReport, fallar());

    expect(respuesta.statusCode).toBe(200);
    expect(mockFail).toHaveBeenCalledWith({
      actorUserId: USUARIO,
      reportId: INFORME,
      reason: 'WeasyPrint no esta disponible',
    });
  });

  it('un motivo vacio es 400', async () => {
    // Un `failed` sin explicacion no le sirve a nadie: ni al estudiante, ni a
    // quien mire la fila dentro de un mes.
    expect((await invocar(failReport, fallar({ reason: '' }))).statusCode).toBe(400);
  });

  it('un motivo kilometrico es 400 y no acaba en la fila', async () => {
    // Acota un traceback entero: no le dice nada a un estudiante y regala el
    // mapa de nuestros modulos a quien mire la respuesta.
    const ev = fallar({ reason: 'x'.repeat(501) });

    expect((await invocar(failReport, ev)).statusCode).toBe(400);
    expect(mockFail).not.toHaveBeenCalled();
  });

  it('sin reportId en la ruta, 400', async () => {
    const ev = makeEvent({
      routeKey: 'POST /v1/reports/{reportId}/fail',
      body: JSON.stringify({ reason: 'x' }),
    });

    expect((await invocar(failReport, ev)).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    const ev = makeEvent(
      { pathParameters: { reportId: INFORME }, body: JSON.stringify({ reason: 'x' }) },
      false,
    );

    expect((await invocar(failReport, ev)).statusCode).toBe(401);
  });
});

describe('GET /v1/reports/{reportId}', () => {
  it('devuelve el informe', async () => {
    mockGet.mockResolvedValue({ ...FILA, status: 'ready' as const, riasecCode: 'IRC' });

    const respuesta = await invocar(
      getReport,
      makeEvent({ pathParameters: { reportId: INFORME } }),
    );

    expect(respuesta.statusCode).toBe(200);
    expect(JSON.parse(respuesta.body).data.riasecCode).toBe('IRC');
    expect(mockGet).toHaveBeenCalledWith({ actorUserId: USUARIO, reportId: INFORME });
  });

  it('sin el parametro de ruta, 400 y no 404', async () => {
    // Falta el parametro significa que la ruta esta mal cableada, no que el
    // informe no exista.
    expect((await invocar(getReport, makeEvent())).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    const ev = makeEvent({ pathParameters: { reportId: INFORME } }, false);
    expect((await invocar(getReport, ev)).statusCode).toBe(401);
  });

  it('no publica ni el bucket ni la traza', async () => {
    // El cliente descarga por el backend, asi que el nombre del bucket no le
    // sirve de nada y publicarlo regala medio ARN a quien mire una respuesta.
    mockGet.mockResolvedValue(FILA);

    const respuesta = await invocar(
      getReport,
      makeEvent({ pathParameters: { reportId: INFORME } }),
    );

    const datos = JSON.parse(respuesta.body).data;
    expect(datos).not.toHaveProperty('bucket');
    expect(datos).not.toHaveProperty('userId');
    expect(datos).not.toHaveProperty('langsmithRunId');
    expect(datos).not.toHaveProperty('modelId');
  });
});

describe('GET /v1/reports', () => {
  /** Lo que el servicio contesta: el historico y si cabe otro informe. */
  const ELEGIBLE = {
    limit: 3,
    used: 1,
    remaining: 2,
    retryAfter: null,
    generating: false,
    minProfileCompleteness: 0.6,
  };

  it('lista los del que llama', async () => {
    mockList.mockResolvedValue({ reports: [FILA], eligibility: ELEGIBLE });

    const respuesta = await invocar(listReports, makeEvent());

    expect(respuesta.statusCode).toBe(200);
    expect(JSON.parse(respuesta.body).data.reports).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith({ actorUserId: USUARIO, limit: undefined });
  });

  it('publica la elegibilidad junto al historico', async () => {
    // Es lo que lee el agente antes de delegar la redaccion del informe.
    mockList.mockResolvedValue({ reports: [], eligibility: { ...ELEGIBLE, remaining: 0 } });

    const respuesta = await invocar(listReports, makeEvent());

    expect(JSON.parse(respuesta.body).data.eligibility.remaining).toBe(0);
  });

  it('pasa el limite cuando viene', async () => {
    mockList.mockResolvedValue({ reports: [], eligibility: ELEGIBLE });

    await invocar(listReports, makeEvent({ queryStringParameters: { limit: '5' } }));

    expect(mockList).toHaveBeenCalledWith({ actorUserId: USUARIO, limit: 5 });
  });

  it('un limite que no es entero es 400', async () => {
    const ev = makeEvent({ queryStringParameters: { limit: 'muchos' } });

    expect((await invocar(listReports, ev)).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    expect((await invocar(listReports, makeEvent({}, false))).statusCode).toBe(401);
  });
});

describe('GET /v1/reports/{reportId}/content y /pdf', () => {
  const PDF = Buffer.from('%PDF-1.7\nno es un pdf de verdad, pero son bytes\n');
  const JSON_BYTES = Buffer.from('{"schema_version":"1","riasec_code":"SIA"}', 'utf-8');

  function eventoDeContenido(sufijo: string) {
    return makeEvent({
      routeKey: `GET /v1/reports/{reportId}/${sufijo}`,
      rawPath: `/v1/reports/${INFORME}/${sufijo}`,
      pathParameters: { reportId: INFORME },
    });
  }

  it('devuelve los bytes en base64 y marcados como tales', async () => {
    // Sin `isBase64Encoded`, API Gateway entrega el base64 al cliente en vez
    // de decodificarlo: el navegador se descarga un fichero de texto que
    // empieza por JVBERi0.
    mockGetContent.mockResolvedValue({
      bytes: PDF,
      contentType: 'application/pdf',
      fileName: `informe-orientacion-${INFORME}.pdf`,
    });

    const respuesta = await invocar(getReportPdf, eventoDeContenido('pdf'));

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.isBase64Encoded).toBe(true);
    expect(Buffer.from(respuesta.body, 'base64').equals(PDF)).toBe(true);
  });

  it('el PDF sale como descarga y con un nombre sin datos del estudiante', async () => {
    mockGetContent.mockResolvedValue({
      bytes: PDF,
      contentType: 'application/pdf',
      fileName: `informe-orientacion-${INFORME}.pdf`,
    });

    const respuesta = await invocar(getReportPdf, eventoDeContenido('pdf'));

    expect(respuesta.headers?.['Content-Type']).toBe('application/pdf');
    expect(respuesta.headers?.['Content-Disposition']).toBe(
      `attachment; filename="informe-orientacion-${INFORME}.pdf"`,
    );
    expect(respuesta.headers?.['Content-Disposition']).not.toContain(USUARIO);
  });

  it('el CORS no pisa el Content-Type del fichero', async () => {
    // El middleware de CORS mete `Content-Type: application/json` con `??=`.
    // Si algun dia deja de ser `??=`, un PDF se serviria como JSON y el
    // navegador lo enseñaria como texto.
    mockGetContent.mockResolvedValue({
      bytes: PDF,
      contentType: 'application/pdf',
      fileName: 'x.pdf',
    });

    const respuesta = await invocar(getReportPdf, eventoDeContenido('pdf'));

    expect(respuesta.headers?.['Content-Type']).not.toBe('application/json');
  });

  it('el JSON se sirve tal cual, sin el sobre de la API', async () => {
    // Envolverlo en `{success, data, meta}` haria que el `checksumSha256` de
    // la fila dejara de describir lo que el cliente recibe.
    mockGetContent.mockResolvedValue({
      bytes: JSON_BYTES,
      contentType: 'application/json',
      fileName: `informe-orientacion-${INFORME}.json`,
    });

    const respuesta = await invocar(getReportContent, eventoDeContenido('content'));

    const cuerpo = Buffer.from(respuesta.body, 'base64').toString('utf-8');
    expect(JSON.parse(cuerpo)).toEqual({ schema_version: '1', riasec_code: 'SIA' });
    expect(cuerpo).not.toContain('"success"');
  });

  it('cada endpoint pide SU objeto', async () => {
    mockGetContent.mockResolvedValue({ bytes: PDF, contentType: 'application/pdf', fileName: 'x' });
    await invocar(getReportPdf, eventoDeContenido('pdf'));
    expect(mockGetContent).toHaveBeenCalledWith({
      actorUserId: USUARIO,
      reportId: INFORME,
      kind: 'pdf',
    });

    mockGetContent.mockResolvedValue({
      bytes: JSON_BYTES,
      contentType: 'application/json',
      fileName: 'x',
    });
    await invocar(getReportContent, eventoDeContenido('content'));
    expect(mockGetContent).toHaveBeenLastCalledWith({
      actorUserId: USUARIO,
      reportId: INFORME,
      kind: 'json',
    });
  });

  it('sin reportId en la ruta, 400', async () => {
    const ev = makeEvent({ routeKey: 'GET /v1/reports/{reportId}/pdf' });

    expect((await invocar(getReportPdf, ev)).statusCode).toBe(400);
  });

  it('sin token, 401', async () => {
    const ev = makeEvent({ pathParameters: { reportId: INFORME } }, false);

    expect((await invocar(getReportContent, ev)).statusCode).toBe(401);
  });

  it('el error del servicio llega con su codigo, no como 500', async () => {
    const { ApiError } = await import('@spark-match/shared/http');
    mockGetContent.mockRejectedValue(ApiError.conflict('The report is not ready yet'));

    expect((await invocar(getReportPdf, eventoDeContenido('pdf'))).statusCode).toBe(409);
  });
});
