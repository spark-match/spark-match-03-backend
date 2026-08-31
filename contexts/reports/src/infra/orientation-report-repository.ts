// =============================================================================
// Orientation report repository - kysely queries against reports.orientation_report
// =============================================================================
// Same pattern as identity's user-repository.ts: factory function,
// `withDbErrorMapping`, schema-qualified via `withSchema()`, snake_case DB row
// -> camelCase domain type via mapRow.
//
// Two things here are not boilerplate and are the reason this file has
// comments at all: the translation of the partial unique index into a 409,
// and the two type coercions Postgres forces on the way out.
// =============================================================================

import type { Kysely, Transaction } from 'kysely';
import { ApiError } from '@spark-match/shared/http';
import { withDbErrorMapping } from '@spark-match/shared/infra';
import {
  parseReportObjects,
  parseTopCareers,
  type CompleteReportInput,
  type CreateReportInput,
  type OrientationReport,
  type ReportStatus,
} from '../domain/orientation-report.js';
import type { Database } from './database.js';

export type { Database } from './database.js';

const REPORTS = 'reports';

/** Name of the partial unique index in migration 006. */
const ONE_PENDING_INDEX = 'reports_orientation_report_one_pending_per_user';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Lo que se ha gastado del tope diario dentro de una ventana.
 *
 * Lleva `oldest` porque con el numero solo no se puede contestar la unica
 * pregunta que le importa a quien acaba de chocar con el tope: cuando podra
 * pedir otro. La respuesta es cuando el mas viejo de estos salga de la
 * ventana, y eso no se deduce del recuento.
 *
 * Y lleva `pending` porque el agente pregunta por esto ANTES de ponerse a
 * escribir, y "te queda una plaza" y "te queda una plaza pero ya estas
 * generando" llevan a dos cosas distintas: en el segundo caso no hay que
 * empezar, hay que esperar. Del `total` no se deduce -- son informes, no
 * estados.
 */
export interface ReportUsage {
  total: number;
  oldest: Date | null;
  pending: number;
}

export interface OrientationReportRepository {
  withDb(db: Kysely<Database> | Transaction<Database>): OrientationReportRepository;
  create(input: CreateReportInput): Promise<OrientationReport>;
  findById(id: string): Promise<OrientationReport | null>;
  findPendingByUser(userId: string): Promise<OrientationReport | null>;
  listByUser(userId: string, limit?: number): Promise<OrientationReport[]>;
  chargeableUsage(userId: string, since: Date, pendingSince: Date): Promise<ReportUsage>;
  markReady(id: string, input: CompleteReportInput): Promise<OrientationReport | null>;
  markFailed(id: string, reason: string): Promise<OrientationReport | null>;
  failStalePending(userId: string, before: Date, reason: string): Promise<number>;
}

interface ReportRow {
  id: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
  status: ReportStatus;
  s3_bucket: string | null;
  objects: unknown;
  schema_version: string | null;
  riasec_code: string | null;
  profile_completeness: string | number | null;
  top_careers: unknown;
  dataset_source: string | null;
  dataset_snapshot_date: Date | string | null;
  model_id: string | null;
  langsmith_run_id: string | null;
  generation_ms: number | null;
  failure_reason: string | null;
}

/**
 * NUMERIC arrives as a **string**. node-postgres does that on purpose: a
 * Postgres NUMERIC can hold values a JS number cannot represent, so parsing it
 * eagerly would silently lose precision. Here the value is a 0..1 ratio with
 * three decimals, so a Number is safe -- but the conversion has to be written
 * down, because `row.profile_completeness > 0.8` on the raw value compares a
 * string and is wrong in a way that looks right.
 */
function toRatio(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * DATE arrives as a JS `Date` built from **local** parts: node-postgres turns
 * `2026-06-13` into midnight local time. So the parts have to be read back
 * locally too. Using `toISOString().slice(0, 10)` instead would shift the day
 * by one on any machine east of Greenwich -- correct on Lambda, which runs in
 * UTC, and wrong on a laptop in Madrid. That is the worst kind of bug: one
 * that only appears where nobody is looking.
 */
function toIsoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const mes = String(value.getMonth() + 1).padStart(2, '0');
  const dia = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${mes}-${dia}`;
}

function mapRow(row: ReportRow): OrientationReport {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    bucket: row.s3_bucket,
    objects: row.objects === null ? null : parseReportObjects(row.objects),
    schemaVersion: row.schema_version,
    riasecCode: row.riasec_code,
    profileCompleteness: toRatio(row.profile_completeness),
    topCareers: row.top_careers === null ? null : parseTopCareers(row.top_careers),
    datasetSource: row.dataset_source,
    datasetSnapshotDate: toIsoDate(row.dataset_snapshot_date),
    modelId: row.model_id,
    langsmithRunId: row.langsmith_run_id,
    generationMs: row.generation_ms,
    failureReason: row.failure_reason,
  };
}

/** True when `err` is the partial unique index refusing a second pending row. */
function isSecondPendingReport(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const pg = err as { code?: unknown; constraint?: unknown };
  return pg.code === UNIQUE_VIOLATION && pg.constraint === ONE_PENDING_INDEX;
}

export function createOrientationReportRepository(
  db: Kysely<Database> | Transaction<Database>,
): OrientationReportRepository {
  const base = () => db.withSchema(REPORTS);

  return {
    withDb(newDb: Kysely<Database> | Transaction<Database>): OrientationReportRepository {
      return createOrientationReportRepository(newDb);
    },

    /**
     * Opens a report in `pending`.
     *
     * The 409 is not a nicety. The partial unique index from migration 006 is
     * what stops the two doors -- the student's button and the agent's chat
     * tool -- from starting two generations at once, and letting its violation
     * fall through to `withDbErrorMapping` would report "database
     * unavailable": a 503 that blames the infrastructure for a situation the
     * caller can act on, and that a client would sensibly retry.
     */
    async create(input: CreateReportInput): Promise<OrientationReport> {
      return withDbErrorMapping('orientation_report.create', async () => {
        try {
          const row = (await base()
            .insertInto('orientation_report')
            .values({ user_id: input.userId })
            .returningAll()
            .executeTakeFirstOrThrow()) as unknown as ReportRow;
          return mapRow(row);
        } catch (err) {
          if (isSecondPendingReport(err)) {
            throw ApiError.conflict('A report is already being generated', {
              code: 'report.already_generating',
              message: 'Wait for the report in progress to finish before requesting another.',
            });
          }
          throw err;
        }
      });
    },

    async findById(id: string): Promise<OrientationReport | null> {
      return withDbErrorMapping('orientation_report.findById', async () => {
        const row = (await base()
          .selectFrom('orientation_report')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) as unknown as ReportRow | undefined;
        return row ? mapRow(row) : null;
      });
    },

    async findPendingByUser(userId: string): Promise<OrientationReport | null> {
      return withDbErrorMapping('orientation_report.findPendingByUser', async () => {
        const row = (await base()
          .selectFrom('orientation_report')
          .selectAll()
          .where('user_id', '=', userId)
          .where('status', '=', 'pending')
          .executeTakeFirst()) as unknown as ReportRow | undefined;
        return row ? mapRow(row) : null;
      });
    },

    async listByUser(userId: string, limit?: number): Promise<OrientationReport[]> {
      return withDbErrorMapping('orientation_report.listByUser', async () => {
        const capped = Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
        const rows = (await base()
          .selectFrom('orientation_report')
          .selectAll()
          .where('user_id', '=', userId)
          .orderBy('created_at', 'desc')
          .limit(capped)
          .execute()) as unknown as ReportRow[];
        return rows.map(mapRow);
      });
    },

    /**
     * Cuantos informes de este estudiante cuentan para el tope diario (D9).
     *
     * **Los `failed` no cuentan, y esa es la decision del metodo.** Un informe
     * que fallo no le dio nada al estudiante, y casi siempre fallo por algo
     * nuestro: WeasyPrint caido, la Lambda sin tiempo, el turno cortado a
     * mitad. Cobrarle tres intentos rotos y dejarlo sin informe hasta mañana
     * es hacerle pagar nuestra averia. El barrido de `failStalePending` juega a
     * favor de lo mismo: convierte en `failed` lo que se quedo colgado, y al
     * hacerlo lo saca de esta cuenta.
     *
     * `pending` si cuenta. Es uno que se esta generando ahora mismo, o sea una
     * llamada al modelo ya en marcha, y el ADR mide el tope en llamadas.
     *
     * **`pendingSince` es lo que hace que un pendiente muerto no cobre.** Un
     * `pending` que se quedo colgado sigue siendo `pending` en la tabla hasta
     * que alguien lo barra, y `request` lo barre justo antes de contar. Quien
     * solo lee -- el agente preguntando si puede empezar -- no barre nada, y
     * sin este filtro contaria plazas ocupadas por generaciones que ya estaban
     * muertas: le diriamos "has llegado al tope" a un estudiante al que
     * `request` le habria abierto el informe sin rechistar. `request` pasa el
     * mismo umbral que acaba de usar para barrer, donde es un no-op, para que
     * la regla este escrita una vez y no dependa de si quien llama barrio.
     */
    async chargeableUsage(userId: string, since: Date, pendingSince: Date): Promise<ReportUsage> {
      return withDbErrorMapping('orientation_report.chargeableUsage', async () => {
        // Las tres agregaciones en una consulta y no en tres: se filtran por lo
        // mismo, asi que separarlas seria pagar tres viajes por la misma fila y
        // abrir la puerta a que un informe entre entre medias y el recuento no
        // corresponda con la fecha.
        const fila = await base()
          .selectFrom('orientation_report')
          .select(({ fn }) => [
            fn.countAll<string>().as('total'),
            fn.min<Date | null>('created_at').as('oldest'),
            fn.countAll<string>().filterWhere('status', '=', 'pending').as('pending'),
          ])
          .where('user_id', '=', userId)
          .where('created_at', '>=', since)
          .where('status', 'in', ['ready', 'pending'])
          .where((eb) =>
            eb.or([eb('status', '=', 'ready'), eb('created_at', '>=', pendingSince)]),
          )
          .executeTakeFirst();

        // COUNT(*) es BIGINT y node-postgres lo trae como string, por la misma
        // razon que el NUMERIC de arriba. Sin el Number, `total >= tope`
        // compara una cadena y '10' >= 3 es falso.
        return {
          total: Number(fila?.total ?? 0),
          oldest: fila?.oldest ?? null,
          pending: Number(fila?.pending ?? 0),
        };
      });
    },

    /**
     * Closes a report as `ready`.
     *
     * `where status = 'pending'` is the guard: without it, the second of the
     * two doors could overwrite an already-finished report with its own
     * objects, and the first door's PDF would be orphaned in the bucket with
     * nothing pointing at it. A caller that gets `null` back is being told the
     * report was already closed, which is a different situation from "no such
     * report" and the service layer answers it differently.
     */
    async markReady(id: string, input: CompleteReportInput): Promise<OrientationReport | null> {
      return withDbErrorMapping('orientation_report.markReady', async () => {
        const row = (await base()
          .updateTable('orientation_report')
          .set({
            status: 'ready',
            s3_bucket: input.bucket,
            objects: JSON.stringify(input.objects),
            schema_version: input.schemaVersion,
            riasec_code: input.riasecCode,
            top_careers: JSON.stringify(input.topCareers),
            dataset_source: input.datasetSource,
            dataset_snapshot_date: input.datasetSnapshotDate,
            profile_completeness: input.profileCompleteness ?? null,
            model_id: input.modelId ?? null,
            langsmith_run_id: input.langsmithRunId ?? null,
            generation_ms: input.generationMs ?? null,
          })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .returningAll()
          .executeTakeFirst()) as unknown as ReportRow | undefined;
        return row ? mapRow(row) : null;
      });
    },

    /**
     * Cierra como `failed` los informes que llevan demasiado tiempo en curso.
     *
     * Sin esto, el indice de un solo pendiente por estudiante deja de ser una
     * proteccion y pasa a ser una condena: si la generacion muere a medias --
     * la Lambda se queda sin tiempo, el agente no contesta, el proceso se cae
     * -- la fila se queda en `pending` para siempre y ese estudiante no puede
     * volver a pedir un informe nunca. El indice cumpliria exactamente lo que
     * promete y el resultado seria peor que no tenerlo.
     *
     * Devuelve cuantas cerro, que es un numero que merece un log: si deja de
     * ser cero de vez en cuando y pasa a serlo siempre, algo se esta muriendo
     * en silencio.
     */
    async failStalePending(userId: string, before: Date, reason: string): Promise<number> {
      return withDbErrorMapping('orientation_report.failStalePending', async () => {
        const resultado = await base()
          .updateTable('orientation_report')
          .set({ status: 'failed', failure_reason: reason })
          .where('user_id', '=', userId)
          .where('status', '=', 'pending')
          .where('created_at', '<', before)
          .executeTakeFirst();
        return Number(resultado.numUpdatedRows ?? 0);
      });
    },

    async markFailed(id: string, reason: string): Promise<OrientationReport | null> {
      return withDbErrorMapping('orientation_report.markFailed', async () => {
        const row = (await base()
          .updateTable('orientation_report')
          .set({ status: 'failed', failure_reason: reason })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .returningAll()
          .executeTakeFirst()) as unknown as ReportRow | undefined;
        return row ? mapRow(row) : null;
      });
    },
  };
}
