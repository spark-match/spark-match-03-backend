import { z } from 'zod';

/**
 * Un objeto guardado en S3, tal como sale por HTTP.
 *
 * Se publica la KEY, no una URL. El backend es registro y proxy (ADR-019 D3):
 * el fichero se pide por `GET /v1/reports/{id}/content`, con el JWT delante,
 * no por un enlace firmado que funciona sin sesion.
 */
export const StoredObjectSchema = z.object({
  key: z.string(),
  versionId: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string(),
});

export const ReportObjectsSchema = z.object({
  json: StoredObjectSchema,
  pdf: StoredObjectSchema,
});

/**
 * El informe tal como lo ve el estudiante. Casi ningun campo es obligatorio,
 * porque una fila `pending` no sabe nada de si misma: decir `null` es mas
 * honesto que inventar un valor por defecto.
 *
 * `bucket` NO sale. El nombre del bucket no le sirve de nada a quien consume
 * la API -- descarga por el endpoint del backend -- y publicarlo es regalar
 * medio nombre de recurso a cualquiera que mire una respuesta.
 */
export const ReportSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'ready', 'failed']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  objects: ReportObjectsSchema.nullable(),
  schemaVersion: z.string().nullable(),
  riasecCode: z.string().nullable(),
  profileCompleteness: z.number().nullable(),
  topCareers: z.array(z.string()).nullable(),
  datasetSource: z.string().nullable(),
  datasetSnapshotDate: z.string().nullable(),
  generationMs: z.number().int().nullable(),
  failureReason: z.string().nullable(),
});
export type Report = z.infer<typeof ReportSchema>;

/**
 * `POST /v1/reports`. El dueño sale del JWT y nunca del cuerpo; lo que si va
 * en el cuerpo son las dos entradas de la puerta de D8, porque el backend no
 * tiene forma de averiguarlas -- el perfil del estudiante vive en el store del
 * agente.
 *
 * `riasecCode` es NULLABLE a proposito y no obligatorio. Que falte no es una
 * peticion mal construida, es el caso normal de un estudiante que aun no ha
 * terminado el assessment, y tiene que llegar al servicio para salir como un
 * 409 con su codigo. Marcarlo requerido lo convertiria en un 400 de validacion
 * -- "has montado mal la peticion" en vez de "preguntale al estudiante", que
 * es justo la accion que el agente necesita que le indiquen.
 */
export const CreateReportInputSchema = z.object({
  profileCompleteness: z.number().min(0).max(1),
  riasecCode: z
    .string()
    .regex(/^[RIASEC]{3}$/, 'riasecCode must be three Holland letters')
    .nullable(),
});
export const CreateReportOutputSchema = ReportSchema;
export type CreateReportBody = z.infer<typeof CreateReportInputSchema>;

/**
 * `POST /v1/reports/{reportId}/complete` — lo que el generador devuelve.
 *
 * Cada campo que la restriccion `orientation_report_ready_is_complete` de la
 * migracion 006 exige va aqui como obligatorio. Asi un cierre incompleto se
 * rechaza en el borde, con un 400 que dice que campo falta, en vez de morir
 * contra la restriccion a las tres de la mañana con un error de Postgres.
 */
export const CompleteReportInputSchema = z.object({
  bucket: z.string().min(1),
  objects: ReportObjectsSchema,
  schemaVersion: z.string().min(1),
  riasecCode: z.string().regex(/^[RIASEC]{3}$/),
  datasetSource: z.string().min(1),
  datasetSnapshotDate: z.iso.date(),
  topCareers: z.array(z.string()),
  profileCompleteness: z.number().min(0).max(1).nullish(),
  modelId: z.string().nullish(),
  langsmithRunId: z.uuid().nullish(),
  generationMs: z.number().int().nonnegative().nullish(),
});
export const CompleteReportOutputSchema = ReportSchema;
export type CompleteReportBody = z.infer<typeof CompleteReportInputSchema>;

/**
 * `POST /v1/reports/{reportId}/fail`.
 *
 * El motivo se acota a 500 caracteres porque acaba en una columna de la fila y
 * de ahi, algun dia, en una pantalla. Un traceback entero de Python no le dice
 * nada a un estudiante de secundaria y si le regala a cualquiera que mire la
 * respuesta el mapa de nuestros modulos.
 */
export const FailReportInputSchema = z.object({
  reason: z.string().min(1).max(500),
});
export const FailReportOutputSchema = ReportSchema;
export type FailReportBody = z.infer<typeof FailReportInputSchema>;

export const GetReportInputSchema = z.object({});
export const GetReportOutputSchema = ReportSchema;

/**
 * Si el estudiante puede pedir otro informe, y con que margen.
 *
 * Viaja pegado al listado y no en una ruta propia: ver `report-service.ts`. Lo
 * consume el agente ANTES de delegar la redaccion, para no escribir un informe
 * entero y descubrir al registrarlo que no habia plaza.
 *
 * `retryAfter` es nullable y no opcional: "todavia hay hueco" es una respuesta,
 * no un campo que falta, y un opcional obligaria a quien lo lee a distinguir
 * entre las dos cosas sin tener con que.
 */
export const ReportEligibilitySchema = z.object({
  limit: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  retryAfter: z.iso.datetime().nullable(),
  generating: z.boolean(),
  minProfileCompleteness: z.number().min(0).max(1),
});
export type ReportEligibility = z.infer<typeof ReportEligibilitySchema>;

export const ListReportsInputSchema = z.object({});
export const ListReportsOutputSchema = z.object({
  reports: z.array(ReportSchema),
  /**
   * `null` cuando no se pudo calcular -- ver `list` en el servicio. Quien lo
   * lee lo trata como "no se sabe" y decide sin ello, que es como funcionaba
   * antes de que este bloque existiera.
   */
  eligibility: ReportEligibilitySchema.nullable(),
});
