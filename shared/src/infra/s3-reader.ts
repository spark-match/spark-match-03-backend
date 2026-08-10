// =============================================================================
// s3-reader - leer un objeto de S3, con los errores traducidos
// =============================================================================
// Solo lectura, y a proposito. Lo unico que el backend hace con S3 hoy es
// servir informes que escribio el agente (ADR-019 D3), asi que un `putObject`
// aqui seria una capacidad que nadie necesita y que cualquier handler podria
// usar por descuido. El rol de runtime tampoco la concede: su statement
// `S3OrientationReportsRead` es GetObject y GetObjectVersion sobre
// `spark-match-reports-{env}/reports/*`.
//
// Esa acotacion de IAM es la frontera de verdad. La clave que se pide viene de
// una columna JSONB, o sea de un dato, no de codigo: si una fila estuviera
// corrupta o alguien lograra escribir en ella, la peticion seguiria sin poder
// salir de ese prefijo. La validacion de forma en el dominio ayuda a fallar
// pronto y con un mensaje util, pero no es lo que contiene el dano.
// =============================================================================

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ApiError } from '../http/api-error.js';

const DEPENDENCY = 'S3';

export interface StoredBytes {
  body: Buffer;
  contentType: string | null;
  /** `null` si el bucket no tiene versionado. */
  versionId: string | null;
}

export interface S3ObjectRef {
  bucket: string;
  key: string;
  versionId?: string | null;
}

export interface S3Reader {
  getObject(ref: S3ObjectRef): Promise<StoredBytes>;
}

/** True cuando S3 dice que el objeto (o esa version concreta) no existe. */
function esObjetoInexistente(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

let cliente: S3Client | null = null;

/**
 * Lector de objetos de S3.
 *
 * @param client Inyectable para tests. Por defecto se cachea uno por
 *   contenedor: crear un S3Client por peticion tira a la basura el pool de
 *   conexiones y vuelve a resolver credenciales cada vez.
 */
export function createS3Reader(client?: S3Client): S3Reader {
  const s3 = client ?? (cliente ??= new S3Client({}));

  return {
    async getObject(ref: S3ObjectRef): Promise<StoredBytes> {
      let salida;
      try {
        salida = await s3.send(
          new GetObjectCommand({
            Bucket: ref.bucket,
            Key: ref.key,
            // `?? undefined` y no el valor a secas: el SDK manda literalmente
            // `versionId=null` si se le pasa null, y S3 responde 400.
            VersionId: ref.versionId ?? undefined,
          }),
        );
      } catch (err) {
        // Un 404 aqui NO es "no encontrado" para quien llama por HTTP: la fila
        // existe y dice que el objeto esta ahi. Que no este significa que el
        // registro y el bucket no coinciden, y eso es una averia nuestra, no
        // un error del cliente. Por eso 500 y no 404.
        if (esObjetoInexistente(err)) {
          throw ApiError.internal(`El objeto ${ref.key} no esta en el bucket ${ref.bucket}`, err);
        }
        if (err instanceof ApiError) throw err;
        throw ApiError.awsUnavailable(DEPENDENCY, err);
      }

      if (!salida.Body) {
        throw ApiError.internal(`S3 devolvio ${ref.key} sin cuerpo`);
      }

      const bytes = await salida.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: salida.ContentType ?? null,
        versionId: salida.VersionId ?? null,
      };
    },
  };
}
