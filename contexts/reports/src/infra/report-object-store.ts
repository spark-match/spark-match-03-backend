// =============================================================================
// Almacen de los objetos de un informe
// =============================================================================
// Traduce "quiero el PDF de este informe" a una lectura de S3. Vive en infra y
// no en el servicio porque el servicio no deberia saber que hay un bucket
// detras; lo que decide el servicio es QUIEN puede leer y CUANDO, no COMO se
// guarda.
// =============================================================================

import { createS3Reader, type S3Reader } from '@spark-match/shared/infra';
import type { ReportObjects, StoredObject } from '../domain/orientation-report.js';

/** Cual de los dos objetos de un informe. */
export type ReportObjectKind = 'json' | 'pdf';

export const CONTENT_TYPES: Record<ReportObjectKind, string> = {
  json: 'application/json',
  pdf: 'application/pdf',
};

export interface ReportObjectStore {
  fetch(input: { bucket: string; objects: ReportObjects; kind: ReportObjectKind }): Promise<Buffer>;
}

export function createReportObjectStore(reader: S3Reader = createS3Reader()): ReportObjectStore {
  return {
    async fetch({ bucket, objects, kind }): Promise<Buffer> {
      const objeto: StoredObject = objects[kind];
      const { body } = await reader.getObject({
        bucket,
        key: objeto.key,
        // Se pide la VERSION concreta que la fila registro, no la ultima.
        // Si alguien sobrescribe la clave, el informe que se sirve sigue
        // siendo el que el estudiante vio y el que el `checksumSha256` de la
        // fila describe. Con `null` (bucket sin versionado) S3 devuelve la
        // actual, que es lo unico que hay.
        versionId: objeto.versionId,
      });
      return body;
    },
  };
}
