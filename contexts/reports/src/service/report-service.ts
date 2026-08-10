// =============================================================================
// Report service - application layer for orientation reports
// =============================================================================
// Two responsibilities the repository deliberately does not have: deciding who
// may see a report, and deciding when a generation has been in progress long
// enough to be declared dead.
// =============================================================================

import { ApiError } from '@spark-match/shared/http';
import type { createLogger } from '@spark-match/shared/logger';
import type { CompleteReportInput, OrientationReport } from '../domain/orientation-report.js';
import type { OrientationReportRepository } from '../infra/orientation-report-repository.js';
import {
  CONTENT_TYPES,
  type ReportObjectKind,
  type ReportObjectStore,
} from '../infra/report-object-store.js';
import type { ReportsConfig } from '../infra/reports-config.js';

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

/**
 * La ventana del tope de D9: 24 h moviles, no el dia natural.
 *
 * El dia natural obliga a elegir un huso, y las dos opciones son malas. En UTC
 * el contador se reinicia a las 19:00 de Peru, o sea a media tarde y sin que
 * nada en la interfaz lo explique. En hora de Lima habria que meter una zona
 * horaria en una consulta SQL y acordarse de ella cada vez que se lea. La
 * ventana movil no tiene huso, no tiene borde y se explica en una frase:
 * "tres en las ultimas veinticuatro horas".
 */
const VENTANA_TOPE_MS = 24 * 60 * 60 * 1000;

export interface ReportContent {
  bytes: Buffer;
  contentType: string;
  /** Nombre sugerido para la descarga. Sin ruta y sin datos del estudiante. */
  fileName: string;
}

/**
 * Lo que el agente sabe del perfil cuando pide abrir un informe.
 *
 * Son las dos entradas de la puerta de D8 y **las dos las declara quien pide**.
 * El backend no puede comprobarlas: el `StudentProfile` vive en el store del
 * agente y aqui no hay forma de recalcularlo. Conviene tenerlo escrito para no
 * confundir esta puerta con una defensa -- lo que hace es poner el umbral en
 * un solo sitio (SSM, operable sin desplegar) y darle al agente una respuesta
 * con forma fija que pueda convertir en una pregunta al estudiante. Quien
 * mienta aqui se emite a si mismo un informe malo, que es exactamente el
 * problema que D8 intenta evitarle.
 */
export interface ProfileGateInput {
  /** 0..1. La property `profile_completeness` del agente. */
  profileCompleteness: number;
  /** Codigo Holland de 3 letras, o `null` si el assessment no llego a darlo. */
  riasecCode: string | null;
}

export interface ReportService {
  request(input: { userId: string } & ProfileGateInput): Promise<OrientationReport>;
  get(input: { actorUserId: string; reportId: string }): Promise<OrientationReport>;
  list(input: { actorUserId: string; limit?: number }): Promise<OrientationReport[]>;
  getContent(input: {
    actorUserId: string;
    reportId: string;
    kind: ReportObjectKind;
  }): Promise<ReportContent>;
  complete(input: {
    actorUserId: string;
    reportId: string;
    result: CompleteReportInput;
  }): Promise<OrientationReport>;
  fail(input: {
    actorUserId: string;
    reportId: string;
    reason: string;
  }): Promise<OrientationReport>;
}

export interface ReportServiceDeps {
  reportRepository: OrientationReportRepository;
  reportObjectStore: ReportObjectStore;
  reportsConfig: ReportsConfig;
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

  /**
   * La puerta de completitud de D8.
   *
   * Dos condiciones y **dos codigos distintos**, porque el agente hace cosas
   * distintas con cada una: sin RIASEC tiene que llevar al estudiante al
   * assessment, y con RIASEC pero poco contexto le basta con preguntarle dos
   * cosas mas. Un solo codigo con un `meta` que hubiera que interpretar
   * convertiria esa bifurcacion en trabajo del prompt.
   *
   * Es 409 y no 422: el cuerpo esta perfectamente bien formado. Lo que pasa es
   * que el estado del perfil no permite todavia lo que se pide, y eso puede
   * dejar de ser cierto sin cambiar una coma de la peticion.
   */
  async function comprobarPerfil({
    profileCompleteness,
    riasecCode,
  }: ProfileGateInput): Promise<void> {
    if (riasecCode === null || riasecCode.trim() === '') {
      throw ApiError.conflict('The profile has no RIASEC code yet', {
        code: 'report.riasec_missing',
        message:
          'The orientation report is built from the Holland code, so the assessment has to be finished first.',
      });
    }

    const minimo = await deps.reportsConfig.minProfileCompleteness();
    if (profileCompleteness < minimo) {
      throw ApiError.conflict('The profile is not complete enough for a report', {
        code: 'report.profile_incomplete',
        message:
          'A few more things about the student are needed before the report is worth making.',
        meta: { profileCompleteness, required: minimo },
      });
    }
  }

  /**
   * El tope de D9.
   *
   * 429 y no 409: no hay nada malo en la peticion ni en el estado del perfil,
   * es literalmente demasiadas veces. Y va `retryAfter` en el cuerpo en vez de
   * la cabecera `Retry-After` porque quien lee esto es el agente dentro de un
   * turno de chat, y lo que necesita es poder decir "puedes pedir otro a las
   * seis" -- no reintentar solo dentro de cuatro horas.
   *
   * La fecha se calcula desde el informe MAS VIEJO de la ventana, que es el
   * primero que va a salir de ella y liberar una plaza. Poner `ahora + 24 h`
   * seria mas facil y estaria casi siempre mal: quien pidio sus tres informes
   * esta mañana puede volver a pedir esta mañana, no mañana por la noche.
   */
  async function comprobarTope(userId: string): Promise<void> {
    const tope = await deps.reportsConfig.maxPerUserPerDay();
    const desde = new Date(ahora().getTime() - VENTANA_TOPE_MS);
    const gastado = await deps.reportRepository.chargeableUsage(userId, desde);

    if (gastado.total >= tope) {
      // El `?? ahora()` no puede darse -- si el total llego al tope hay al
      // menos una fila y por tanto una fecha -- pero el tipo lo permite, y la
      // alternativa a un valor de respaldo aqui es un `null` viajando hasta la
      // respuesta para que el agente lo interprete.
      const libre = new Date((gastado.oldest ?? ahora()).getTime() + VENTANA_TOPE_MS);
      throw ApiError.tooManyRequests('Daily report limit reached', {
        code: 'report.daily_limit_reached',
        message: `Only ${tope} reports can be generated per day.`,
        meta: { limit: tope, used: gastado.total, retryAfter: libre.toISOString() },
      });
    }
  }

  /**
   * Cierra un informe, en el estado que sea.
   *
   * El `null` del repositorio es la unica pieza interesante. `markReady` y
   * `markFailed` llevan `where status = 'pending'`, asi que devolver `null`
   * significa **"existe, es tuyo, y ya estaba cerrado"** -- no "no existe".
   * Merece un 409 y no un 404, y menos aun un 200 silencioso: quien
   * reintenta un cierre necesita distinguir entre "listo" y "llegaste tarde,
   * el informe que hay no es el que acabas de subir". La diferencia importa
   * porque los objetos del segundo se quedan huerfanos en el bucket, y con un
   * 200 nadie se enteraria nunca.
   *
   * La comprobacion de propiedad va antes y es la misma de siempre: sin ella,
   * cualquiera con un id podria cerrar el informe de otro con su contenido.
   */
  async function cerrar(
    actorUserId: string,
    reportId: string,
    cerrarFila: () => Promise<OrientationReport | null>,
  ): Promise<OrientationReport> {
    await propioODesaparecido(actorUserId, reportId);

    const cerrado = await cerrarFila();
    if (cerrado === null) {
      throw ApiError.conflict('The report is already closed', {
        code: 'report.already_closed',
        message: 'This report is no longer being generated, so it cannot be closed again.',
      });
    }
    return cerrado;
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
    async request({ userId, profileCompleteness, riasecCode }) {
      // El barrido va PRIMERO y no es una optimizacion: un pendiente muerto
      // ocupa sitio en las dos puertas siguientes. Bloquea el indice unico y,
      // mientras siga contando como `pending`, gasta una de las plazas del
      // tope diario. Barrer despues de contar dejaria a un estudiante sin
      // informe por culpa de generaciones que ya habiamos dado por perdidas.
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

      await comprobarPerfil({ profileCompleteness, riasecCode });
      await comprobarTope(userId);

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

    /**
     * El informe salio bien: quedan anotados el bucket, las dos claves y lo
     * demas que hace falta para volver a encontrarlo y para auditarlo cuando
     * la traza de LangSmith haya caducado (D10).
     */
    async complete({ actorUserId, reportId, result }) {
      const cerrado = await cerrar(actorUserId, reportId, () =>
        deps.reportRepository.markReady(reportId, result),
      );
      deps.logger.info('Informe cerrado', {
        reportId,
        generationMs: result.generationMs ?? null,
      });
      return cerrado;
    },

    /**
     * El informe salio mal.
     *
     * Existe para que un fallo del generador no dependa del barrido de diez
     * minutos: sin esta puerta, un WeasyPrint caido deja al estudiante mirando
     * "Generando tu reporte..." un cuarto de hora antes de que nada le diga
     * que no va a llegar. Es la diferencia entre un error y un planton.
     */
    async fail({ actorUserId, reportId, reason }) {
      const cerrado = await cerrar(actorUserId, reportId, () =>
        deps.reportRepository.markFailed(reportId, reason),
      );
      // `warn` y no `error`: que una generacion falle es un desenlace previsto
      // del que el sistema se recupera solo. Lo que si merece mirarse es que
      // deje de ser raro, y para eso hace falta que aparezca en los logs.
      deps.logger.warn('Generacion de informe fallida', { reportId, reason });
      return cerrado;
    },
  };
}
