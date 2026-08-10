import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReportService } from './report-service.js';
import type { OrientationReportRepository } from '../infra/orientation-report-repository.js';
import type { OrientationReport } from '../domain/orientation-report.js';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('request', () => {
  it('abre el informe del estudiante que llama', async () => {
    const repo = buildRepo();
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

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
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

    await servicio.request({ userId: DUEÑO });

    expect(orden).toEqual(['barrer', 'insertar']);
  });

  it('avisa por log cuando ha tenido que dar alguno por perdido', async () => {
    // Que esto deje de ser excepcional es la señal de que algo se muere en
    // silencio en el camino de generación.
    const repo = buildRepo({ failStalePending: vi.fn().mockResolvedValue(2) });
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

    await servicio.request({ userId: DUEÑO });

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { userId: DUEÑO, caducados: 2 });
  });

  it('no ensucia el log cuando no hay nada que barrer', async () => {
    const servicio = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
    });

    await servicio.request({ userId: DUEÑO });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('get', () => {
  it('devuelve el informe a su dueño', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(informe()) });
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

    expect((await servicio.get({ actorUserId: DUEÑO, reportId: 'r-1' })).id).toBe('r-1');
  });

  it('el informe de otro es 404, no 403', async () => {
    // Un 403 confirmaría que ese id existe, y lo que hay detrás es el perfil
    // psicométrico de un menor: la existencia de la fila ya es información
    // sobre esa persona.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe({ userId: 'otro-estudiante' })),
    });
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

    await expect(servicio.get({ actorUserId: DUEÑO, reportId: 'r-1' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('un informe que no existe también es 404', async () => {
    const servicio = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
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
    });
    const inexistente = createReportService({
      reportRepository: buildRepo(),
      logger: logger as never,
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
    const servicio = createReportService({ reportRepository: repo, logger: logger as never });

    await servicio.list({ actorUserId: DUEÑO, limit: 5 });

    expect(repo.listByUser).toHaveBeenCalledWith(DUEÑO, 5);
  });
});
