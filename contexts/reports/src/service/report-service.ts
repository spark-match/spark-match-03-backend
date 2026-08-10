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

export interface ReportService {
  request(input: { userId: string }): Promise<OrientationReport>;
  get(input: { actorUserId: string; reportId: string }): Promise<OrientationReport>;
  list(input: { actorUserId: string; limit?: number }): Promise<OrientationReport[]>;
}

export interface ReportServiceDeps {
  reportRepository: OrientationReportRepository;
  // `ReturnType<typeof createLogger>` y no un `Logger` importado: el modulo de
  // shared no reexporta el tipo de powertools, y es como lo tipa composition.
  logger: ReturnType<typeof createLogger>;
  /** Inyectable para poder probar el caducado sin esperar diez minutos. */
  now?: () => Date;
}

export function createReportService(deps: ReportServiceDeps): ReportService {
  const ahora = deps.now ?? (() => new Date());

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

    /**
     * Un informe, si es de quien lo pide.
     *
     * Un informe ajeno responde 404 y no 403. Un 403 confirmaria que ese id
     * existe, y lo que hay detras es el perfil psicometrico de un menor: la
     * mera existencia de la fila ya es informacion sobre esa persona. Para
     * quien no es el dueño, el informe no existe -- que es exactamente lo que
     * el 404 dice.
     */
    async get({ actorUserId, reportId }) {
      const informe = await deps.reportRepository.findById(reportId);
      if (!informe || informe.userId !== actorUserId) {
        throw ApiError.notFound('Report');
      }
      return informe;
    },

    async list({ actorUserId, limit }) {
      return deps.reportRepository.listByUser(actorUserId, limit);
    },
  };
}
