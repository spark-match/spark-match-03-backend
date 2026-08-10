import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@spark-match/shared/http';
import { createOrientationReportRepository } from './orientation-report-repository.js';

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function buildDb(terminal: unknown): Chain {
  const chain: Chain = {};
  const finish = vi.fn().mockResolvedValue(terminal);
  for (const link of [
    'withSchema',
    'selectFrom',
    'insertInto',
    'updateTable',
    'selectAll',
    'where',
    'orderBy',
    'limit',
    'values',
    'set',
    'returningAll',
  ]) {
    chain[link] = vi.fn().mockReturnThis();
  }
  chain.execute = finish;
  chain.executeTakeFirst = finish;
  chain.executeTakeFirstOrThrow = finish;
  return chain;
}

/** Un doble que revienta al ejecutar, para los caminos de error. */
function buildFailingDb(err: unknown): Chain {
  const chain = buildDb(undefined);
  const boom = vi.fn().mockRejectedValue(err);
  chain.execute = boom;
  chain.executeTakeFirst = boom;
  chain.executeTakeFirstOrThrow = boom;
  return chain;
}

const FILA_PENDIENTE = {
  id: 'r-1',
  user_id: 'u-1',
  created_at: new Date('2026-08-10T10:00:00.000Z'),
  updated_at: new Date('2026-08-10T10:00:00.000Z'),
  status: 'pending' as const,
  s3_bucket: null,
  objects: null,
  schema_version: null,
  riasec_code: null,
  profile_completeness: null,
  top_careers: null,
  dataset_source: null,
  dataset_snapshot_date: null,
  model_id: null,
  langsmith_run_id: null,
  generation_ms: null,
  failure_reason: null,
};

const FILA_LISTA = {
  ...FILA_PENDIENTE,
  status: 'ready' as const,
  s3_bucket: 'spark-match-reports-dev',
  objects: {
    json: { key: 'reports/u-1/r-1.json', versionId: 'v1', sizeBytes: 900, checksumSha256: 'a' },
    pdf: { key: 'reports/u-1/r-1.pdf', versionId: 'v2', sizeBytes: 40_000, checksumSha256: 'b' },
  },
  schema_version: '1',
  riasec_code: 'IRC',
  top_careers: ['Ingeniería Industrial'],
  dataset_source: 'Ponte en Carrera (MINEDU)',
};

const COMPLETO = {
  bucket: 'spark-match-reports-dev',
  objects: {
    json: { key: 'reports/u-1/r-1.json', versionId: 'v1', sizeBytes: 900, checksumSha256: 'a' },
    pdf: { key: 'reports/u-1/r-1.pdf', versionId: 'v2', sizeBytes: 40_000, checksumSha256: 'b' },
  },
  schemaVersion: '1',
  riasecCode: 'IRC',
  datasetSource: 'Ponte en Carrera (MINEDU)',
  datasetSnapshotDate: '2026-06-13',
  topCareers: ['Ingeniería Industrial'],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createOrientationReportRepository', () => {
  describe('create', () => {
    it('abre el informe en pending y sólo pide el usuario', async () => {
      const db = buildDb(FILA_PENDIENTE);
      const repo = createOrientationReportRepository(db as never);

      const informe = await repo.create({ userId: 'u-1' });

      expect(db.withSchema).toHaveBeenCalledWith('reports');
      expect(db.values).toHaveBeenCalledWith({ user_id: 'u-1' });
      expect(informe.status).toBe('pending');
      expect(informe.objects).toBeNull();
    });

    it('traduce el índice de un solo pendiente a un 409', async () => {
      // Es la razón de ser del índice: sin esta traducción, las dos puertas
      // se cierran igual pero el estudiante ve «base de datos no disponible»,
      // que además invita a reintentar.
      const db = buildFailingDb({
        code: '23505',
        constraint: 'reports_orientation_report_one_pending_per_user',
      });
      const repo = createOrientationReportRepository(db as never);

      await expect(repo.create({ userId: 'u-1' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'conflict',
      });
    });

    it('no confunde otra violación de unicidad con esa', async () => {
      const db = buildFailingDb({ code: '23505', constraint: 'otro_indice_cualquiera' });
      const repo = createOrientationReportRepository(db as never);

      await expect(repo.create({ userId: 'u-1' })).rejects.toMatchObject({ statusCode: 503 });
    });

    it('un fallo cualquiera de base de datos sigue siendo 503', async () => {
      const db = buildFailingDb(new Error('connection reset'));
      const repo = createOrientationReportRepository(db as never);

      await expect(repo.create({ userId: 'u-1' })).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('lectura', () => {
    it('findById devuelve null cuando no hay fila', async () => {
      const repo = createOrientationReportRepository(buildDb(undefined) as never);

      expect(await repo.findById('r-404')).toBeNull();
    });

    it('mapea las columnas a camelCase', async () => {
      const repo = createOrientationReportRepository(buildDb(FILA_LISTA) as never);

      const informe = await repo.findById('r-1');

      expect(informe?.bucket).toBe('spark-match-reports-dev');
      expect(informe?.schemaVersion).toBe('1');
      expect(informe?.objects?.pdf.sizeBytes).toBe(40_000);
      expect(informe?.topCareers).toEqual(['Ingeniería Industrial']);
    });

    it('listByUser ordena por fecha descendente y acota el límite', async () => {
      const db = buildDb([FILA_LISTA]);
      const repo = createOrientationReportRepository(db as never);

      await repo.listByUser('u-1', 9999);

      expect(db.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(db.limit).toHaveBeenCalledWith(200);
    });

    it('listByUser no acepta un límite de cero', async () => {
      const db = buildDb([]);
      const repo = createOrientationReportRepository(db as never);

      await repo.listByUser('u-1', 0);

      expect(db.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('coacciones que impone Postgres', () => {
    it('convierte a número el NUMERIC que llega como texto', async () => {
      // node-postgres devuelve NUMERIC como string a propósito, para no
      // perder precisión. Sin esta conversión, comparar el ratio con 0.8
      // compararía un string y saldría mal pareciendo bien.
      const repo = createOrientationReportRepository(
        buildDb({ ...FILA_LISTA, profile_completeness: '0.875' }) as never,
      );

      const informe = await repo.findById('r-1');

      expect(informe?.profileCompleteness).toBe(0.875);
    });

    it('lee la fecha por sus partes locales y no por UTC', async () => {
      // node-postgres construye el DATE a medianoche LOCAL. Usar
      // toISOString() restaría un día en cualquier máquina al este de
      // Greenwich: correcto en Lambda, que va en UTC, y roto en un portátil
      // en Madrid. Este test fija las partes locales.
      const fecha = new Date(2026, 5, 13); // 13 de junio, hora local
      const repo = createOrientationReportRepository(
        buildDb({ ...FILA_LISTA, dataset_snapshot_date: fecha }) as never,
      );

      const informe = await repo.findById('r-1');

      expect(informe?.datasetSnapshotDate).toBe('2026-06-13');
    });

    it('acepta también la fecha como texto', async () => {
      const repo = createOrientationReportRepository(
        buildDb({ ...FILA_LISTA, dataset_snapshot_date: '2026-06-13' }) as never,
      );

      expect((await repo.findById('r-1'))?.datasetSnapshotDate).toBe('2026-06-13');
    });
  });

  describe('cierre', () => {
    it('markReady sólo toca una fila pendiente', async () => {
      // Sin esta condición, la segunda puerta pisaría un informe ya cerrado y
      // dejaría el PDF de la primera huérfano en el bucket.
      const db = buildDb(FILA_LISTA);
      const repo = createOrientationReportRepository(db as never);

      await repo.markReady('r-1', COMPLETO);

      expect(db.where).toHaveBeenCalledWith('status', '=', 'pending');
    });

    it('markReady serializa los jsonb', async () => {
      const db = buildDb(FILA_LISTA);
      const repo = createOrientationReportRepository(db as never);

      await repo.markReady('r-1', COMPLETO);

      const escrito = db.set.mock.calls[0][0];
      expect(escrito.status).toBe('ready');
      expect(JSON.parse(escrito.objects).pdf.key).toBe('reports/u-1/r-1.pdf');
      expect(JSON.parse(escrito.top_careers)).toEqual(['Ingeniería Industrial']);
    });

    it('markReady devuelve null si la fila ya estaba cerrada', async () => {
      const repo = createOrientationReportRepository(buildDb(undefined) as never);

      expect(await repo.markReady('r-1', COMPLETO)).toBeNull();
    });

    it('markFailed guarda el motivo', async () => {
      const db = buildDb({ ...FILA_PENDIENTE, status: 'failed', failure_reason: 'sin catálogo' });
      const repo = createOrientationReportRepository(db as never);

      const informe = await repo.markFailed('r-1', 'sin catálogo');

      expect(db.set).toHaveBeenCalledWith({ status: 'failed', failure_reason: 'sin catálogo' });
      expect(informe?.failureReason).toBe('sin catálogo');
    });
  });

  it('withDb devuelve un repositorio sobre la nueva conexión', async () => {
    const otra = buildDb(FILA_PENDIENTE);
    const repo = createOrientationReportRepository(buildDb(undefined) as never).withDb(
      otra as never,
    );

    await repo.findById('r-1');

    expect(otra.selectFrom).toHaveBeenCalledWith('orientation_report');
  });
});
