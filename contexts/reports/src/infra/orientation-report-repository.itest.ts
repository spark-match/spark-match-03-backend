// =============================================================================
// Integration tests - reports.orientation_report against a real Postgres
// =============================================================================
// These do NOT run in the normal `npm test`. The file is named `.itest.ts`, so
// it does not match the `*.test.ts` include patterns in vitest.config.mts; it
// is picked up only by vitest.integration.config.mts, which the CI job
// `constraints-check` runs after applying the migrations against an ephemeral
// postgres:17.
//
// WHY THIS FILE EXISTS
//
// Migration 006 does real work: a partial unique index that stops two doors
// from opening two reports at once, a CHECK that makes "ready" mean complete,
// and a shape check on a JSONB column. The unit tests next door use a fake
// Kysely, so they verify that the repository builds the right query -- they
// cannot verify that Postgres then does what the migration claims.
//
// It also pins the two driver coercions the repository compensates for
// (NUMERIC arriving as a string, DATE arriving as a local-midnight Date).
// Those were reasoned from documentation; here they are observed.
// =============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { createOrientationReportRepository } from './orientation-report-repository.js';
import type { Database } from './database.js';

const DATABASE_URL = process.env.DATABASE_URL;

let pool: Pool;
let db: Kysely<Database>;
let userId: string;

const OBJETOS = {
  json: { key: 'reports/u/r.json', versionId: 'v1', sizeBytes: 900, checksumSha256: 'a' },
  pdf: { key: 'reports/u/r.pdf', versionId: 'v2', sizeBytes: 40_000, checksumSha256: 'b' },
};

const COMPLETO = {
  bucket: 'spark-match-reports-test',
  objects: OBJETOS,
  schemaVersion: '1',
  riasecCode: 'IRC',
  datasetSource: 'Ponte en Carrera (MINEDU)',
  datasetSnapshotDate: '2026-06-13',
  topCareers: ['Ingeniería Industrial', 'Arquitectura'],
};

/** Inserta la fila cruda, saltandose el repositorio, para probar el CHECK. */
async function insertarCrudo(valores: Record<string, unknown>): Promise<void> {
  const columnas = Object.keys(valores);
  const marcadores = columnas.map((_, i) => `$${i + 2}`).join(', ');
  await pool.query(
    `INSERT INTO reports.orientation_report (user_id, ${columnas.join(', ')})
     VALUES ($1, ${marcadores})`,
    [userId, ...Object.values(valores)],
  );
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required for the integration tests');

  pool = new Pool({ connectionString: DATABASE_URL });
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  userId = await crearUsuario('informes@spark-match.test');
});

/** Devuelve el id del usuario recien creado. La tabla la crea la migracion 002. */
async function crearUsuario(email: string): Promise<string> {
  const creado = await pool.query<{ id: string }>(
    `INSERT INTO identity.users (email, full_name, password_hash)
     VALUES ($1, 'Test', 'scrypt$1$2$3$hash')
     RETURNING id`,
    [email],
  );
  const fila = creado.rows[0];
  if (!fila) throw new Error(`No se pudo crear el usuario ${email}`);
  return fila.id;
}

/** Lee una columna cruda, sin pasar por el repositorio ni por sus conversiones. */
async function leerCrudo(id: string, columna: string): Promise<unknown> {
  const resultado = await pool.query<Record<string, unknown>>(
    `SELECT ${columna} FROM reports.orientation_report WHERE id = $1`,
    [id],
  );
  const fila = resultado.rows[0];
  if (!fila) throw new Error(`No existe el informe ${id}`);
  return fila[columna];
}

afterAll(async () => {
  await db?.destroy();
});

beforeEach(async () => {
  await pool.query('DELETE FROM reports.orientation_report');
});

describe('un solo informe en curso por estudiante', () => {
  it('deja abrir el primero', async () => {
    const repo = createOrientationReportRepository(db);

    const informe = await repo.create({ userId });

    expect(informe.status).toBe('pending');
    expect(informe.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rechaza el segundo con un 409, no con un 503', async () => {
    // Ésta es la prueba que faltaba. El índice único parcial es lo que cierra
    // las dos puertas, y hasta aquí nadie había comprobado que Postgres lo
    // aplique ni que el repositorio traduzca la violación.
    const repo = createOrientationReportRepository(db);
    await repo.create({ userId });

    await expect(repo.create({ userId })).rejects.toMatchObject({
      statusCode: 409,
      code: 'conflict',
    });
  });

  it('vuelve a dejar abrir uno cuando el anterior se cierra', async () => {
    // El índice es parcial: sólo cuenta las filas `pending`. Si contara todas,
    // un estudiante tendría un único informe en toda su vida.
    const repo = createOrientationReportRepository(db);
    const primero = await repo.create({ userId });
    await repo.markReady(primero.id, COMPLETO);

    const segundo = await repo.create({ userId });

    expect(segundo.id).not.toBe(primero.id);
  });

  it('y también cuando el anterior falla', async () => {
    const repo = createOrientationReportRepository(db);
    const primero = await repo.create({ userId });
    await repo.markFailed(primero.id, 'sin catálogo');

    await expect(repo.create({ userId })).resolves.toBeTruthy();
  });
});

describe('«listo» no puede mentir', () => {
  it('acepta un informe completo', async () => {
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });

    const cerrado = await repo.markReady(abierto.id, COMPLETO);

    expect(cerrado?.status).toBe('ready');
    expect(cerrado?.objects?.pdf.key).toBe('reports/u/r.pdf');
    expect(cerrado?.topCareers).toEqual(['Ingeniería Industrial', 'Arquitectura']);
  });

  it('rechaza un ready sin objetos', async () => {
    await expect(insertarCrudo({ status: 'ready' })).rejects.toThrow(
      /orientation_report_ready_is_complete/,
    );
  });

  it('rechaza un ready al que le falta la fecha del corte', async () => {
    await expect(
      insertarCrudo({
        status: 'ready',
        s3_bucket: 'b',
        objects: JSON.stringify(OBJETOS),
        schema_version: '1',
        riasec_code: 'IRC',
        top_careers: JSON.stringify(['Arquitectura']),
        dataset_source: 'Ponte en Carrera (MINEDU)',
      }),
    ).rejects.toThrow(/orientation_report_ready_is_complete/);
  });

  it('rechaza un failed sin motivo', async () => {
    await expect(insertarCrudo({ status: 'failed' })).rejects.toThrow(
      /orientation_report_failed_says_why/,
    );
  });

  it('rechaza un estado que no existe', async () => {
    await expect(insertarCrudo({ status: 'generando' })).rejects.toThrow(
      /orientation_report_status_check/,
    );
  });
});

describe('lo que la base de datos sí comprueba de un jsonb', () => {
  it('rechaza unos objetos sin pdf', async () => {
    // Una fila que dice estar lista sin PDF manda al estudiante a un 404.
    await expect(
      insertarCrudo({ objects: JSON.stringify({ json: OBJETOS.json }) }),
    ).rejects.toThrow(/orientation_report_objects_shape/);
  });

  it('rechaza que `objects` sea un array', async () => {
    await expect(insertarCrudo({ objects: JSON.stringify([OBJETOS]) })).rejects.toThrow(
      /orientation_report_objects_shape/,
    );
  });

  it('rechaza que `top_careers` no sea un array', async () => {
    await expect(
      insertarCrudo({ top_careers: JSON.stringify({ 0: 'Arquitectura' }) }),
    ).rejects.toThrow(/orientation_report_top_careers_is_array/);
  });

  it('rechaza una completitud fuera de rango', async () => {
    await expect(insertarCrudo({ profile_completeness: 1.5 })).rejects.toThrow(
      /orientation_report_completeness_range/,
    );
  });
});

describe('las dos coacciones del driver, observadas', () => {
  it('NUMERIC vuelve como string del driver', async () => {
    // El repositorio lo convierte; esto comprueba que la conversión hace
    // falta de verdad y no es una precaución inventada.
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });
    await repo.markReady(abierto.id, { ...COMPLETO, profileCompleteness: 0.875 });

    expect(typeof (await leerCrudo(abierto.id, 'profile_completeness'))).toBe('string');

    const leido = await repo.findById(abierto.id);
    expect(leido?.profileCompleteness).toBe(0.875);
  });

  it('DATE vuelve como Date y el repositorio la devuelve sin correrla un día', async () => {
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });
    await repo.markReady(abierto.id, COMPLETO);

    expect(await leerCrudo(abierto.id, 'dataset_snapshot_date')).toBeInstanceOf(Date);

    const leido = await repo.findById(abierto.id);
    expect(leido?.datasetSnapshotDate).toBe('2026-06-13');
  });
});

describe('el resto del repositorio contra la tabla de verdad', () => {
  it('markReady no toca un informe ya cerrado', async () => {
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });
    await repo.markReady(abierto.id, COMPLETO);

    const segundo = await repo.markReady(abierto.id, {
      ...COMPLETO,
      bucket: 'otro-bucket',
    });

    expect(segundo).toBeNull();
    expect((await repo.findById(abierto.id))?.bucket).toBe('spark-match-reports-test');
  });

  it('listByUser devuelve del más nuevo al más viejo', async () => {
    const repo = createOrientationReportRepository(db);
    const viejo = await repo.create({ userId });
    await repo.markReady(viejo.id, COMPLETO);
    await sql`SELECT pg_sleep(0.01)`.execute(db);
    const nuevo = await repo.create({ userId });

    const lista = await repo.listByUser(userId);

    expect(lista.map((r) => r.id)).toEqual([nuevo.id, viejo.id]);
  });

  it('updated_at se mueve solo al cambiar de estado', async () => {
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });
    await sql`SELECT pg_sleep(0.01)`.execute(db);

    const cerrado = await repo.markReady(abierto.id, COMPLETO);

    expect(cerrado!.updatedAt.getTime()).toBeGreaterThan(abierto.updatedAt.getTime());
    expect(cerrado!.createdAt.getTime()).toBe(abierto.createdAt.getTime());
  });

  it('chargeableUsage no cuenta los fallidos', async () => {
    // Un informe que falló no le dio nada al estudiante, y casi siempre falló
    // por algo nuestro. Cobrárselo sería hacerle pagar nuestra avería.
    const repo = createOrientationReportRepository(db);
    const listo = await repo.create({ userId });
    await repo.markReady(listo.id, COMPLETO);
    const roto = await repo.create({ userId });
    await repo.markFailed(roto.id, 'sin pdf');

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() - 86_400_000));

    expect(uso.total).toBe(1);
  });

  it('chargeableUsage cuenta el que está en curso', async () => {
    // Es una llamada al modelo ya en marcha, y el tope se mide en llamadas.
    const repo = createOrientationReportRepository(db);
    await repo.create({ userId });

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() - 86_400_000));

    expect(uso.total).toBe(1);
  });

  it('chargeableUsage deja fuera lo anterior a la ventana', async () => {
    const repo = createOrientationReportRepository(db);
    const abierto = await repo.create({ userId });
    await repo.markReady(abierto.id, COMPLETO);

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() + 60_000));

    expect(uso.total).toBe(0);
    expect(uso.oldest).toBeNull();
  });

  it('chargeableUsage devuelve la fecha del más viejo, no la del más nuevo', async () => {
    // Es lo que permite decir «puedes pedir otro a las diez» en vez de
    // «dentro de veinticuatro horas», que estaría casi siempre mal.
    const repo = createOrientationReportRepository(db);
    const primero = await repo.create({ userId });
    await repo.markReady(primero.id, COMPLETO);
    await sql`SELECT pg_sleep(0.01)`.execute(db);
    const segundo = await repo.create({ userId });

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() - 86_400_000));

    expect(uso.total).toBe(2);
    expect(uso.oldest?.getTime()).toBe(primero.createdAt.getTime());
    expect(uso.oldest?.getTime()).toBeLessThan(segundo.createdAt.getTime());
  });

  it('chargeableUsage sólo mira los del estudiante que se le pide', async () => {
    const repo = createOrientationReportRepository(db);
    const otro = await crearUsuario('ajeno-tope@spark-match.test');
    await repo.create({ userId: otro });

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() - 86_400_000));

    expect(uso.total).toBe(0);
  });

  it('el total llega como número, no como el string del BIGINT', async () => {
    // `COUNT(*)` es BIGINT y node-postgres lo trae como string. Sin el
    // `Number`, `total >= tope` compara una cadena y '10' >= 3 es falso.
    const repo = createOrientationReportRepository(db);
    await repo.create({ userId });

    const uso = await repo.chargeableUsage(userId, new Date(Date.now() - 86_400_000));

    expect(typeof uso.total).toBe('number');
  });

  it('borrar al estudiante se lleva sus informes', async () => {
    const repo = createOrientationReportRepository(db);
    const otro = await crearUsuario('borrame@spark-match.test');
    await repo.create({ userId: otro });

    await pool.query('DELETE FROM identity.users WHERE id = $1', [otro]);

    expect(await repo.listByUser(otro)).toEqual([]);
  });
});
