import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReportService, type ReportServiceDeps } from './report-service.js';
import type { OrientationReportRepository } from '../infra/orientation-report-repository.js';
import type { CompleteReportInput, OrientationReport } from '../domain/orientation-report.js';
import type { ReportObjectStore } from '../infra/report-object-store.js';
import type { ReportsConfig } from '../infra/reports-config.js';

const AHORA = new Date('2026-08-10T12:00:00.000Z');
const DUEÑO = 'u-1';

/** Un perfil que pasa las dos condiciones de D8, para los casos que no la prueban. */
const PERFIL_OK = { profileCompleteness: 0.8, riasecCode: 'SIA' };

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
    chargeableUsage: vi.fn().mockResolvedValue({ total: 0, oldest: null }),
    markReady: vi.fn(),
    markFailed: vi.fn(),
    failStalePending: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as OrientationReportRepository & Record<string, ReturnType<typeof vi.fn>>;
}

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };

const mockFetch = vi.fn();
const store = { fetch: mockFetch } as unknown as ReportObjectStore;

const mockTope = vi.fn();
const mockCompletitud = vi.fn();
const config = {
  maxPerUserPerDay: mockTope,
  minProfileCompleteness: mockCompletitud,
} as unknown as ReportsConfig;

/**
 * El servicio con todo mockeado y el reloj parado.
 *
 * `now` va fijo por defecto porque dos de las reglas que hay aqui son
 * temporales -- el barrido de diez minutos y la ventana de veinticuatro horas
 * del tope -- y con el reloj de verdad se prueban por aproximacion.
 */
function crearServicio(
  repo: OrientationReportRepository = buildRepo(),
  extra: Partial<ReportServiceDeps> = {},
) {
  return createReportService({
    reportRepository: repo,
    reportObjectStore: store,
    reportsConfig: config,
    logger: logger as never,
    now: () => AHORA,
    ...extra,
  });
}

const OBJETOS = {
  json: { key: 'reports/u-1/r-1.json', versionId: 'v-json', sizeBytes: 10, checksumSha256: 'aaa' },
  pdf: { key: 'reports/u-1/r-1.pdf', versionId: 'v-pdf', sizeBytes: 20, checksumSha256: 'bbb' },
};

const RESULTADO: CompleteReportInput = {
  bucket: 'spark-match-reports-dev',
  objects: OBJETOS,
  schemaVersion: '1',
  riasecCode: 'SIA',
  datasetSource: 'Ponte en Carrera (MINEDU)',
  datasetSnapshotDate: '2026-06-13',
  topCareers: ['Psicologia', 'Trabajo Social'],
  profileCompleteness: 0.75,
  modelId: 'claude-opus-5',
  langsmithRunId: '33333333-3333-4333-8333-333333333333',
  generationMs: 18_400,
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
  mockTope.mockResolvedValue(3);
  mockCompletitud.mockResolvedValue(0.6);
});

describe('request', () => {
  it('abre el informe del estudiante que llama', async () => {
    const repo = buildRepo();

    const abierto = await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(repo.create).toHaveBeenCalledWith({ userId: DUEÑO });
    expect(abierto.status).toBe('pending');
  });

  it('antes de abrir, cierra los pendientes muertos de ESE estudiante', async () => {
    // Sin esto el índice de un solo pendiente deja de ser una protección y
    // pasa a ser una condena: una generación que se muere a medias impediría
    // pedir otro informe para siempre.
    const repo = buildRepo();

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

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

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(orden).toEqual(['barrer', 'insertar']);
  });

  it('barre antes de CONTAR para el tope', async () => {
    // Un pendiente muerto ocupa plaza en el tope diario. Contar antes de
    // barrerlo dejaría al estudiante sin informe por generaciones que ya
    // habíamos dado por perdidas.
    const orden: string[] = [];
    const repo = buildRepo({
      failStalePending: vi.fn().mockImplementation(() => {
        orden.push('barrer');
        return Promise.resolve(1);
      }),
      chargeableUsage: vi.fn().mockImplementation(() => {
        orden.push('contar');
        return Promise.resolve({ total: 0, oldest: null });
      }),
    });

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(orden).toEqual(['barrer', 'contar']);
  });

  it('avisa por log cuando ha tenido que dar alguno por perdido', async () => {
    // Que esto deje de ser excepcional es la señal de que algo se muere en
    // silencio en el camino de generación.
    const repo = buildRepo({ failStalePending: vi.fn().mockResolvedValue(2) });

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { userId: DUEÑO, caducados: 2 });
  });

  it('no ensucia el log cuando no hay nada que barrer', async () => {
    await crearServicio().request({ userId: DUEÑO, ...PERFIL_OK });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('request · puerta de completitud (D8)', () => {
  it('sin código RIASEC no hay informe', async () => {
    // Es la condición dura: sin las seis puntuaciones no hay código Holland, y
    // sin código el motor de afinidad no tiene entrada.
    const repo = buildRepo();

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, profileCompleteness: 1, riasecCode: null })
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(error.details[0].code).toBe('report.riasec_missing');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un código en blanco cuenta como no tenerlo', async () => {
    const error = await crearServicio()
      .request({ userId: DUEÑO, profileCompleteness: 1, riasecCode: '   ' })
      .catch((e) => e);

    expect(error.details[0].code).toBe('report.riasec_missing');
  });

  it('por debajo del umbral, 409 diciendo cuánto falta', async () => {
    mockCompletitud.mockResolvedValue(0.6);
    const repo = buildRepo();

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, profileCompleteness: 0.5, riasecCode: 'SIA' })
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(error.details[0].code).toBe('report.profile_incomplete');
    expect(error.details[0].meta).toEqual({ profileCompleteness: 0.5, required: 0.6 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('justo en el umbral pasa', async () => {
    // `>=` y no `>`: 0.60 configurado significa que 0.60 vale.
    mockCompletitud.mockResolvedValue(0.6);
    const repo = buildRepo();

    await crearServicio(repo).request({
      userId: DUEÑO,
      profileCompleteness: 0.6,
      riasecCode: 'SIA',
    });

    expect(repo.create).toHaveBeenCalled();
  });

  it('el umbral sale de SSM en cada llamada, no de una constante', async () => {
    // Es lo que permite subirlo o bajarlo en dev sin desplegar.
    mockCompletitud.mockResolvedValue(0.9);
    const repo = buildRepo();

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, profileCompleteness: 0.8, riasecCode: 'SIA' })
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(mockCompletitud).toHaveBeenCalled();
  });

  it('el RIASEC se mira antes que la completitud', async () => {
    // Las dos respuestas piden acciones distintas al agente. Si faltan las
    // dos cosas, la que hay que resolver primero es el assessment.
    mockCompletitud.mockResolvedValue(0.6);

    const error = await crearServicio()
      .request({ userId: DUEÑO, profileCompleteness: 0.1, riasecCode: null })
      .catch((e) => e);

    expect(error.details[0].code).toBe('report.riasec_missing');
  });
});

describe('request · tope diario (D9)', () => {
  /** Uso con `total` informes, el más viejo hace `haceHoras` horas. */
  function gastado(total: number, haceHoras = 20) {
    return vi.fn().mockResolvedValue({
      total,
      oldest: new Date(AHORA.getTime() - haceHoras * 60 * 60 * 1000),
    });
  }

  it('cuenta sólo las últimas 24 h y sólo las de ese estudiante', async () => {
    const repo = buildRepo();

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    const [usuario, desde] = repo.chargeableUsage.mock.calls[0];
    expect(usuario).toBe(DUEÑO);
    expect(AHORA.getTime() - (desde as Date).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('en el tope, 429 y no se abre nada', async () => {
    mockTope.mockResolvedValue(3);
    const repo = buildRepo({ chargeableUsage: gastado(3) });

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, ...PERFIL_OK })
      .catch((e) => e);

    expect(error.statusCode).toBe(429);
    expect(error.details[0].code).toBe('report.daily_limit_reached');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('el error dice el tope, cuántos van y cuándo se reabre', async () => {
    // El agente lo convierte en «puedes pedir otro a las diez», que es lo
    // único accionable para el estudiante.
    mockTope.mockResolvedValue(3);
    const repo = buildRepo({ chargeableUsage: gastado(4, 20) });

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, ...PERFIL_OK })
      .catch((e) => e);

    expect(error.details[0].meta).toEqual({
      limit: 3,
      used: 4,
      // El más viejo entró hace 20 h, así que sale de la ventana dentro de 4.
      retryAfter: new Date(AHORA.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    });
  });

  it('la fecha se calcula desde el más viejo, no desde ahora', async () => {
    // `ahora + 24 h` sería más fácil y estaría casi siempre mal: quien pidió
    // sus tres informes esta mañana puede volver a pedir esta mañana.
    mockTope.mockResolvedValue(3);
    const repo = buildRepo({ chargeableUsage: gastado(3, 23) });

    const error = await crearServicio(repo)
      .request({ userId: DUEÑO, ...PERFIL_OK })
      .catch((e) => e);

    const cuando = new Date(error.details[0].meta.retryAfter as string);
    expect(cuando.getTime() - AHORA.getTime()).toBe(60 * 60 * 1000);
  });

  it('uno por debajo del tope todavía pasa', async () => {
    mockTope.mockResolvedValue(3);
    const repo = buildRepo({ chargeableUsage: gastado(2) });

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(repo.create).toHaveBeenCalled();
  });

  it('el tope sale de SSM, así que dev puede tenerlo más alto', async () => {
    mockTope.mockResolvedValue(10);
    const repo = buildRepo({ chargeableUsage: gastado(5) });

    await crearServicio(repo).request({ userId: DUEÑO, ...PERFIL_OK });

    expect(repo.create).toHaveBeenCalled();
  });

  it('la completitud se mira antes de gastar una consulta en contar', async () => {
    const repo = buildRepo();

    await crearServicio(repo)
      .request({ userId: DUEÑO, profileCompleteness: 0.1, riasecCode: 'SIA' })
      .catch(() => undefined);

    expect(repo.chargeableUsage).not.toHaveBeenCalled();
  });
});

describe('complete', () => {
  it('cierra el informe con lo que devolvió el generador', async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe()),
      markReady: vi.fn().mockResolvedValue(listo()),
    });

    const cerrado = await crearServicio(repo).complete({
      actorUserId: DUEÑO,
      reportId: 'r-1',
      result: RESULTADO,
    });

    expect(repo.markReady).toHaveBeenCalledWith('r-1', RESULTADO);
    expect(cerrado.status).toBe('ready');
  });

  it('el informe de otro es 404 y no se cierra', async () => {
    // Sin esto, cualquiera con un id podría cerrar el informe ajeno con su
    // propio contenido.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe({ userId: 'otro-estudiante' })),
      markReady: vi.fn().mockResolvedValue(listo()),
    });

    await expect(
      crearServicio(repo).complete({ actorUserId: DUEÑO, reportId: 'r-1', result: RESULTADO }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('uno que no existe es 404', async () => {
    await expect(
      crearServicio().complete({ actorUserId: DUEÑO, reportId: 'r-404', result: RESULTADO }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cerrar uno ya cerrado es 409, no 200 ni 404', async () => {
    // `markReady` lleva `where status = 'pending'`, así que el null significa
    // «existe, es tuyo, y llegaste tarde». Un 200 silencioso le haría creer al
    // que llega segundo que el informe servido es el suyo, cuando sus objetos
    // se han quedado huérfanos en el bucket.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(listo()),
      markReady: vi.fn().mockResolvedValue(null),
    });

    const error = await crearServicio(repo)
      .complete({ actorUserId: DUEÑO, reportId: 'r-1', result: RESULTADO })
      .catch((e) => e);

    expect(error.statusCode).toBe(409);
    expect(error.details[0].code).toBe('report.already_closed');
  });

  it('deja constancia en el log de cuánto tardó', async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe()),
      markReady: vi.fn().mockResolvedValue(listo()),
    });

    await crearServicio(repo).complete({
      actorUserId: DUEÑO,
      reportId: 'r-1',
      result: RESULTADO,
    });

    expect(logger.info).toHaveBeenCalledWith(expect.any(String), {
      reportId: 'r-1',
      generationMs: 18_400,
    });
  });
});

describe('fail', () => {
  it('cierra el informe como fallido con su motivo', async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe()),
      markFailed: vi
        .fn()
        .mockResolvedValue(informe({ status: 'failed', failureReason: 'sin pdf' })),
    });

    const cerrado = await crearServicio(repo).fail({
      actorUserId: DUEÑO,
      reportId: 'r-1',
      reason: 'sin pdf',
    });

    expect(repo.markFailed).toHaveBeenCalledWith('r-1', 'sin pdf');
    expect(cerrado.status).toBe('failed');
  });

  it('el informe de otro es 404 y no se toca', async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe({ userId: 'otro-estudiante' })),
      markFailed: vi.fn(),
    });

    await expect(
      crearServicio(repo).fail({ actorUserId: DUEÑO, reportId: 'r-1', reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('fallar uno ya cerrado es 409', async () => {
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(listo()),
      markFailed: vi.fn().mockResolvedValue(null),
    });

    await expect(
      crearServicio(repo).fail({ actorUserId: DUEÑO, reportId: 'r-1', reason: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('avisa por log, pero como warn y no como error', async () => {
    // Que una generación falle es un desenlace previsto del que el sistema se
    // recupera solo. Lo que merece mirarse es que deje de ser raro.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe()),
      markFailed: vi.fn().mockResolvedValue(informe({ status: 'failed' })),
    });

    await crearServicio(repo).fail({ actorUserId: DUEÑO, reportId: 'r-1', reason: 'sin pdf' });

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
      reportId: 'r-1',
      reason: 'sin pdf',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('get', () => {
  it('devuelve el informe a su dueño', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(informe()) });

    expect((await crearServicio(repo).get({ actorUserId: DUEÑO, reportId: 'r-1' })).id).toBe('r-1');
  });

  it('el informe de otro es 404, no 403', async () => {
    // Un 403 confirmaría que ese id existe, y lo que hay detrás es el perfil
    // psicométrico de un menor: la existencia de la fila ya es información
    // sobre esa persona.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(informe({ userId: 'otro-estudiante' })),
    });

    await expect(
      crearServicio(repo).get({ actorUserId: DUEÑO, reportId: 'r-1' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('un informe que no existe también es 404', async () => {
    await expect(
      crearServicio().get({ actorUserId: DUEÑO, reportId: 'r-404' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('las dos respuestas son indistinguibles desde fuera', async () => {
    // Si el mensaje delatara cuál de los dos casos es, el 404 no serviría de
    // nada: bastaría con leerlo para saber que el informe existe.
    const ajeno = crearServicio(
      buildRepo({ findById: vi.fn().mockResolvedValue(informe({ userId: 'otro' })) }),
    );
    const inexistente = crearServicio();

    const unError = await ajeno.get({ actorUserId: DUEÑO, reportId: 'r-1' }).catch((e) => e);
    const elOtro = await inexistente.get({ actorUserId: DUEÑO, reportId: 'r-1' }).catch((e) => e);

    expect(unError.message).toBe(elOtro.message);
    expect(unError.statusCode).toBe(elOtro.statusCode);
  });
});

describe('list', () => {
  it('sólo pide los del que llama', async () => {
    const repo = buildRepo();

    await crearServicio(repo).list({ actorUserId: DUEÑO, limit: 5 });

    expect(repo.listByUser).toHaveBeenCalledWith(DUEÑO, 5);
  });
});

describe('getContent', () => {
  it('devuelve los bytes, su tipo y un nombre de fichero', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(listo()) });

    const contenido = await crearServicio(repo).getContent({
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

    await crearServicio(repo).getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'json' });

    expect(mockFetch).toHaveBeenCalledWith({
      bucket: 'spark-match-reports-dev',
      objects: OBJETOS,
      kind: 'json',
    });
  });

  it('el nombre del fichero no lleva nada del estudiante', async () => {
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(listo()) });

    const contenido = await crearServicio(repo).getContent({
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

    await expect(
      crearServicio(repo).getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un informe fallido tambien es 409, y lo dice', async () => {
    const repo = buildRepo({
      findById: vi
        .fn()
        .mockResolvedValue(informe({ status: 'failed', failureReason: 'el modelo no contesto' })),
    });

    const error = await crearServicio(repo)
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

    await expect(
      crearServicio(repo).getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un informe que no existe es 404 y no toca S3', async () => {
    await expect(
      crearServicio().getContent({ actorUserId: DUEÑO, reportId: 'r-404', kind: 'json' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('un ready sin objetos es 500 explicito, no un TypeError', async () => {
    // La restriccion de la migracion 006 ya lo impide. Si algun dia falla,
    // un 500 con mensaje se entiende y un `Cannot read properties of null` no.
    const repo = buildRepo({
      findById: vi.fn().mockResolvedValue(listo({ objects: null, bucket: null })),
    });

    await expect(
      crearServicio(repo).getContent({ actorUserId: DUEÑO, reportId: 'r-1', kind: 'pdf' }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
