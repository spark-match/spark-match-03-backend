// =============================================================================
// Report service - application layer for orientation reports
// =============================================================================
// Two responsibilities the repository deliberately does not have: deciding who
// may see a report, and deciding when a generation has been in progress long
// enough to be declared dead.
// =============================================================================

import { ApiError } from '@spark-match/shared/http';
import type { createLogger } from '@spark-match/shared/logger';
import type { OrientationReport } from '../domain/orientation-report.js';
import type { OrientationReportRepository } from '../infra/orientation-report-repository.js';
import {
  CONTENT_TYPES,
  type ReportObjectKind,
  type ReportObjectStore,
} from '../infra/report-object-store.js';

/**
 * Cuanto puede llevar un informe en curso antes de darlo por muerto.
 *
 * El ADR-019 (D4) mide la generacion en 10-20 s de modelo mas el render y la
 * subida, contra el techo de 60 s del CloudFront que hay delante del ALB. Diez
 * veces ese techo no es una estimacion generosa, es una que no puede
 * confundirse con una generacion lenta.
 */
const PENDIENTE_MUERTO_MS = 10 * 60 * 1000;

const MOTIVO_CADUCADO = 'La generacion no termino a tiempo y se dio por perdida.';

export interface ReportContent {
  bytes: Buffer;
  contentType: string;
  /** Nombre sugerido para la descarga. Sin ruta y sin datos del estudiante. */
  fileName: string;
}

export interface ReportService {
  request(input: { userId: string }): Promise<OrientationReport>;
  get(input: { actorUserId: string; reportId: string }): Promise<OrientationReport>;
  list(input: { actorUserId: string; limit?: number }): Promise<OrientationReport[]>;
  getContent(input: {
    actorUserId: string;
    reportId: string;
    kind: ReportObjectKind;
  }): Promise<ReportContent>;
}

export interface ReportServiceDeps {
  reportRepository: OrientationReportRepository;
  reportObjectStore: ReportObjectStore;
  // `ReturnType<typeof createLogger>` y no un `Logger` importado: el modulo de
  // shared no reexporta el tipo de powertools, y es como lo tipa composition.
  logger: ReturnType<typeof createLogger>;
  /** Inyectable para poder probar el caducado sin esperar diez minutos. */
  now?: () => Date;
}

export function createReportService(deps: ReportServiceDeps): ReportService {
  const ahora = deps.now ?? (() => new Date());

  /**
   * El informe, si es de quien lo pide.
   *
   * Un informe ajeno responde 404 y no 403. Un 403 confirmaria que ese id
   * existe, y lo que hay detras es el perfil psicometrico de un menor: la mera
   * existencia de la fila ya es informacion sobre esa persona. Para quien no es
   * el dueño, el informe no existe -- que es exactamente lo que el 404 dice.
   *
   * Una sola condicion para los dos casos, y es lo que hace que no se puedan
   * distinguir: si no existe, `?.userId` es undefined y tampoco coincide.
   * Separarlos en dos ramas invita a dar dos mensajes.
   */
  async function propioODesaparecido(
    actorUserId: string,
    reportId: string,
  ): Promise<OrientationReport> {
    const informe = await deps.reportRepository.findById(reportId);
    if (informe?.userId !== actorUserId) {
      throw ApiError.notFound('Report');
    }
    return informe;
  }

  return {
    /**
     * Abre un informe en `pending`.
     *
     * Antes de insertar barre los pendientes muertos de ESE estudiante. No es
     * un apaño para el indice unico: es lo que hace que el indice sea una
     * proteccion y no una condena. Una generacion puede morirse a medias --
     * la Lambda se queda sin tiempo, el agente no contesta -- y sin este
     * barrido la fila huerfana impide pedir otro informe para siempre.
     *
     * Se barre solo lo del estudiante que llama, no la tabla entera. Un
     * endpoint de lectura que ademas limpia la basura de todos es un barrido
     * global disfrazado, y su coste crece con el numero de usuarios en el peor
     * momento posible: cuando alguien esta esperando una respuesta.
     */
    async request({ userId }) {
      const limite = new Date(ahora().getTime() - PENDIENTE_MUERTO_MS);
      const caducados = await deps.reportRepository.failStalePending(
        userId,
        limite,
        MOTIVO_CADUCADO,
      );
      if (caducados > 0) {
        // Merece log: que esto deje de ser excepcional es la senal de que algo
        // se esta muriendo en silencio en el camino de generacion.
        deps.logger.warn('Informes en curso dados por perdidos', { userId, caducados });
      }

      return deps.reportRepository.create({ userId });
    },

    /** Un informe, si es de quien lo pide. Ver `propioODesaparecido`. */
    async get({ actorUserId, reportId }) {
      return propioODesaparecido(actorUserId, reportId);
    },

    /**
     * Los bytes de uno de los dos objetos del informe.
     *
     * El backend es registro y proxy (ADR-019 D3): sirve el fichero el mismo,
     * con el JWT delante, en vez de repartir URLs firmadas. Una URL firmada o
     * caduca -- y entonces la fila apunta a algo que ya no se puede abrir -- o
     * no caduca, y entonces es una capacidad permanente sobre el perfil
     * psicometrico de un menor que viaja por donde sea que viaje el enlace.
     *
     * Pasa por el MISMO control de propiedad que `get`, y por eso lo llama en
     * vez de repetirlo: dos comprobaciones separadas se acaban desalineando, y
     * la que se quede corta es la que sirve el contenido.
     */
    async getContent({ actorUserId, reportId, kind }): Promise<ReportContent> {
      const informe = await propioODesaparecido(actorUserId, reportId);

      // 409 y no 404: el informe existe y es suyo, lo que pasa es que todavia
      // no tiene contenido. Un 404 aqui le diria que se ha equivocado de id,
      // que es justo lo contrario de lo que ocurre, y le haria abandonar el
      // sondeo que la respuesta 202 de `request` le pidio empezar.
      if (informe.status !== 'ready') {
        throw ApiError.conflict('The report is not ready yet', {
          code: 'report.not_ready',
          message:
            informe.status === 'pending'
              ? 'The report is still being generated.'
              : 'The report generation failed, so it has no content.',
          meta: { status: informe.status },
        });
      }

      // La restriccion `orientation_report_ready_is_complete` de la migracion
      // 006 ya impide que una fila `ready` llegue aqui sin bucket ni objects.
      // La comprobacion se queda igualmente porque el tipo lo permite y
      // porque, si algun dia falla, un 500 explicito se entiende y un
      // `Cannot read properties of null` no.
      if (informe.bucket === null || informe.objects === null) {
        throw ApiError.internal(`El informe ${informe.id} esta ready pero sin objetos`);
      }

      const bytes = await deps.reportObjectStore.fetch({
        bucket: informe.bucket,
        objects: informe.objects,
        kind,
      });

      return {
        bytes,
        contentType: CONTENT_TYPES[kind],
        // El id y nada mas. Un nombre con el del estudiante o su codigo
        // acabaria en la carpeta de descargas de cualquier ordenador
        // compartido, que es exactamente donde no queremos que este.
        fileName: `informe-orientacion-${informe.id}.${kind}`,
      };
    },

    async list({ actorUserId, limit }) {
      return deps.reportRepository.listByUser(actorUserId, limit);
    },
  };
}
