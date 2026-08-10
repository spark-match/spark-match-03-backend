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
 * El informe tal como lo ve el estudiante. Casi todo es nullable porque una
 * fila `pending` todavia no sabe nada de si misma, y decir `null` es mas
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

/** `POST /v1/reports` no lleva cuerpo: el dueño sale del JWT, no del body. */
export const CreateReportInputSchema = z.object({});
export const CreateReportOutputSchema = ReportSchema;

export const GetReportInputSchema = z.object({});
export const GetReportOutputSchema = ReportSchema;

export const ListReportsInputSchema = z.object({});
export const ListReportsOutputSchema = z.object({
  reports: z.array(ReportSchema),
});
