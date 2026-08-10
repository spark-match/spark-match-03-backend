import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequest, mockGet, mockList, mockBuildContext } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockGet: vi.fn(),
  mockList: vi.fn(),
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

const USUARIO = '11111111-1111-4111-8111-111111111111';
const INFORME = '22222222-2222-4222-8222-222222222222';

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

type Respuesta = { statusCode: number; body: string };
const invocar = (h: unknown, ev: APIGatewayProxyEventV2): Promise<Respuesta> =>
  (h as (e: APIGatewayProxyEventV2) => Promise<Respuesta>)(ev);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildContext.mockResolvedValue({
    reportService: { request: mockRequest, get: mockGet, list: mockList },
  });
});

describe('POST /v1/reports', () => {
  it('responde 202 y no 200', async () => {
    // El informe se ha ACEPTADO, no completado. Un 200 diria que ya esta
    // listo y contradiria al sondeo que la propia respuesta arranca.
    mockRequest.mockResolvedValue(FILA);

    const respuesta = await invocar(createReport, makeEvent());

    expect(respuesta.statusCode).toBe(202);
    expect(JSON.parse(respuesta.body).data.status).toBe('pending');
  });

  it('el dueño sale del token, nunca del cuerpo', async () => {
    mockRequest.mockResolvedValue(FILA);

    await invocar(createReport, makeEvent({ body: JSON.stringify({ userId: 'otro' }) }));

    expect(mockRequest).toHaveBeenCalledWith({ userId: USUARIO });
  });

  it('sin token, 401', async () => {
    expect((await invocar(createReport, makeEvent({}, false))).statusCode).toBe(401);
  });

  it('deja subir el 409 del repositorio tal cual', async () => {
    // La regla vive en la base de datos. Volver a comprobarla aqui seria una
    // segunda lectura que otra peticion puede invalidar entre medias.
    const { ApiError } = await import('@spark-match/shared/http');
    mockRequest.mockRejectedValue(ApiError.conflict('A report is already being generated'));

    expect((await invocar(createReport, makeEvent())).statusCode).toBe(409);
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
  it('lista los del que llama', async () => {
    mockList.mockResolvedValue([FILA]);

    const respuesta = await invocar(listReports, makeEvent());

    expect(respuesta.statusCode).toBe(200);
    expect(JSON.parse(respuesta.body).data.reports).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith({ actorUserId: USUARIO, limit: undefined });
  });

  it('pasa el limite cuando viene', async () => {
    mockList.mockResolvedValue([]);

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
