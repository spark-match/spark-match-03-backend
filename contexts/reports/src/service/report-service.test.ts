import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReportService } from './report-service.js';
import type { OrientationReportRepository } from '../infra/orientation-report-repository.js';
import type { OrientationReport } from '../domain/orientation-report.js';
import type { ReportObjectStore } from '../infra/report-object-store.js';

const AHORA = new Date('2026-08-10T12:00:00.000Z');
const DUEÑO = 'u-1';

function informe(overrides: Partial<OrientationReport> = {}): OrientationReport {
  return {
    id: 'r-1',
    userId: DUEÑO,
    createdAt: AHORA,
    updatedAt: AHORA,
    status: 'pending',
    bucket: null,
    objects: null,
    schemaVersion: null,
    riasecCode: null,
    profileCompleteness: null,
    topCareers: null,
    datasetSource: null,
    datasetSnapshotDate: null,
    modelId: null,
    langsmithRunId: null,
    generationMs: null,
    failureReason: null,
    ...overrides,
  };
}

function buildRepo(overrides: Partial<OrientationReportRepository> = {}) {
  return {
    withDb: vi.fn(),
    create: vi.fn().mockResolvedValue(informe()),
    findById: vi.fn().mockResolvedValue(null),
    findPendingByUser: vi.fn().mockResolvedValue(null),
    listByUser: vi.fn().mockResolvedValue([]),
    markReady: vi.fn(),
    markFailed: vi.fn(),
    failStalePending: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as OrientationReportRepository & Record<string, ReturnType<typeof vi.fn>>;
}

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };

const mockFetch = vi.fn();
const store = { fetch: mockFetch } as unknown as ReportObjectStore;

const OBJETOS = {
  json: { key: 'reports/u-1/r-1.json', versionId: 'v-json', sizeBytes: 10, checksumSha256: 'aaa' },
  pdf: { key: 'reports/u-1/r-1.pdf', versionId: 'v-pdf', sizeBytes: 20, checksumSha256: 'bbb' },
};

function listo(overrides: Partial<OrientationReport> = {}): OrientationReport {
  return informe({
    status: 'ready',
    bucket: 'spark-match-reports-dev',
    objects: OBJETOS,
    schemaVersion: '1',
    riasecCode: 'SIA',
    topCareers: ['Psicologia'],
    datasetSource: 'Ponte en Carrera (MINEDU)',
    datasetSnapshotDate: '2026-06-13',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(Buffer.from('bytes'));
});

describe('request', () => {
  it('abre el informe del estudiante que llama', async () => {
    const repo = buildRepo();
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    const abierto = await servicio.request({ userId: DUEÑO });

    expect(repo.create).toHaveBeenCalledWith({ userId: DUEÑO });
    expect(abierto.status).toBe('pending');
  });

  it('antes de abrir, cierra los pendientes muertos de ESE estudiante', async () => {
    // Sin esto el índice de un solo pendiente deja de ser una protección y
    // pasa a ser una condena: una generación que se muere a medias impediría
    // pedir otro informe para siempre.
    const repo = buildRepo();
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
      now: () => AHORA,
    });

    await servicio.request({ userId: DUEÑO });

    const [usuario, limite, motivo] = repo.failStalePending.mock.calls[0];
    expect(usuario).toBe(DUEÑO);
    expect(AHORA.getTime() - (limite as Date).getTime()).toBe(10 * 60 * 1000);
    expect(motivo).toMatch(/no termino a tiempo/);
  });

  it('barre antes de insertar, no después', async () => {
    // Al revés no serviría de nada: el insert reventaría contra el índice
    // justo por la fila que el barrido iba a quitar.
    const orden: string[] = [];
    const repo = buildRepo({
      failStalePending: vi.fn().mockImplementation(() => {
        orden.push('barrer');
        return Promise.resolve(0);
      }),
      create: vi.fn().mockImplementation(() => {
        orden.push('insertar');
        return Promise.resolve(informe());
      }),
    });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await servicio.request({ userId: DUEÑO });

    expect(orden).toEqual(['barrer', 'insertar']);
  });

  it('avisa por log cuando ha tenido que dar alguno por perdido', async () => {
    // Que esto deje de ser excepcional es la señal de que algo se muere en
    // silencio en el camino de generación.
    const repo = buildRepo({ failStalePending: vi.fn().mockResolvedValue(2) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await servicio.request({ userId: DUEÑO });

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { userId: DUEÑO, caducados: 2 });
  });

  it('no ensucia el log cuando no hay nada que barrer', async () => {
    const servicio = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
      reportObjectStore: store,
    });

    await servicio.request({ userId: DUEÑO });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('get', () => {
  it('devuelve el informe a su dueño', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(informe()) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    expect((await servicio.get({ actorUserId: DUEÑO, reportId: 'r-1' })).id).toBe('r-1');
  });

  it('el informe de otro es 404, no 403', async () => {
    // Un 403 confirmaría que ese id existe, y lo que hay detrás es el perfil
    // psicométrico de un menor: la existencia de la fila ya es información
    // sobre esa persona.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe({ userId: 'otro-estudiante' })),
    });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(servicio.get({ actorUserId: DUEÑO, reportId: 'r-1' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('un informe que no existe también es 404', async () => {
    const servicio = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(servicio.get({ actorUserId: DUEÑO, reportId: 'r-404' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('las dos respuestas son indistinguibles desde fuera', async () => {
    // Si el mensaje delatara cuál de los dos casos es, el 404 no serviría de
    // nada: bastaría con leerlo para saber que el informe existe.
    const ajeno = createReportService({
      reportRepository: buildRepo({
        findById: vi.fn().mockResolvedValue(informe({ userId: 'otro' })),
      }),
      logger: logger as never,
      reportObjectStore: store,
    });
    const inexistente = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
      reportObjectStore: store,
    });

    const unError = await ajeno.get({ actorUserId: DUEÑO, reportId: 'r-1' }).catch((e) => e);
    const elOtro = await inexistente.get({ actorUserId: DUEÑO, reportId: 'r-1' }).catch((e) => e);

    expect(unError.message).toBe(elOtro.message);
    expect(unError.statusCode).toBe(elOtro.statusCode);
  });
});

describe('list', () => {
  it('sólo pide los del que llama', async () => {
    const repo = buildRepo();
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await servicio.list({ actorUserId: DUEÑO, limit: 5 });

    expect(repo.listByUser).toHaveBeenCalledWith(DUEÑO, 5);
  });
});

describe('getContent', () => {
  it('devuelve los bytes, su tipo y un nombre de fichero', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(listo()) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    const contenido = await servicio.getContent({
      actorUserId: DUEÑO,
      reportId: 'r-1',
      kind: 'pdf',
    });

    expect(contenido.contentType).toBe('application/pdf');
    expect(contenido.fileName).toBe('informe-orientacion-r-1.pdf');
  });

  it('pide la VERSION que registro la fila, no la ultima', async () => {
    // Si alguien sobrescribe la clave, el informe que se sirve debe seguir
    // siendo el que el estudiante vio y el que el checksum de la fila describe.
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(listo()) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await servicio.getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'json' });

    expect(mockFetch).toHaveBeenCalledWith({
      bucket: 'spark-match-reports-dev',
      objects: OBJETOS,
      kind: 'json',
    });
  });

  it('el nombre del fichero no lleva nada del estudiante', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(listo()) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    const contenido = await servicio.getContent({
      actorUserId: DUEÑO,
      reportId: 'r-1',
      kind: 'pdf',
    });

    expect(contenido.fileName).not.toContain(DUEÑO);
  });

  it('un informe en curso es 409, no 404', async () => {
    // El informe existe y es suyo. Un 404 le diria que se equivoco de id y le
    // haria abandonar el sondeo que el 202 de `request` arranco.
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(informe()) });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(
      servicio.getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un informe fallido tambien es 409, y lo dice', async () => {
    const repo = buildRepo({
      findById: vi
        .fn()
        .mockResolvedValue(informe({ status: 'failed', failureReason: 'el modelo no contesto' })),
    });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    const error = await servicio
      .getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' })
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(JSON.stringify(error)).toContain('failed');
  });

  it('el contenido de otro es 404, igual que el informe', async () => {
    // Si esta comprobacion se desalineara de la de `get`, la que se quedara
    // corta seria la que sirve el fichero.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(listo({ userId: 'otro-estudiante' })),
    });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(
      servicio.getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un informe que no existe es 404 y no toca S3', async () => {
    const servicio = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(
      servicio.getContent({ actorUserId: DUEÑO, reportId: 'r-404', kind: 'json' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un ready sin objetos es 500 explicito, no un TypeError', async () => {
    // La restriccion de la migracion 006 ya lo impide. Si algun dia falla,
    // un 500 con mensaje se entiende y un `Cannot read properties of null` no.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(listo({ objects: null, bucket: null })),
    });
    const servicio = createReportService({
      reportRepository: repo,
      logger: logger as never,
      reportObjectStore: store,
    });

    await expect(
      servicio.getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
