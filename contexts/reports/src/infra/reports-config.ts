// =============================================================================
// Los dos numeros que gobiernan quien puede pedir un informe y cuantos
// =============================================================================
// El tope diario (D9) y el minimo de completitud (D8) del ADR-019. Los publica
// `modules/ssm-bootstrap` de 02-infrastructure bajo el prefijo de ADR-0002 y
// llevan ahi desde la fase 3 sin que nadie los leyera; esto es lo que los
// enchufa.
//
// No se leen en el arranque del contexto sino en cada llamada, y eso es
// deliberado: el contenedor de una Lambda vive horas, asi que un valor cogido
// en el arranque en frio se congela hasta que AWS decida reciclarla. Subir el
// tope en dev para probar una regeneracion y que no surta efecto hasta dentro
// de dos horas convierte un parametro operable en uno decorativo. El
// `SsmReader` cachea 300 s por su cuenta, que es el equilibrio que ya eligio
// el resto del backend.
// =============================================================================

import { ApiError } from '@spark-match/shared/http';
import { createSsmReader, ssmConfigPath, type SsmReader } from '@spark-match/shared/infra';

const CLAVE_TOPE = 'reports-max-per-user-per-day';
const CLAVE_COMPLETITUD = 'reports-min-profile-completeness';

export interface ReportsConfig {
  /** Cuantos informes puede pedir un estudiante en 24 h (ADR-019 D9). */
  maxPerUserPerDay(): Promise<number>;
  /** Completitud minima del perfil para tener derecho a informe (D8). */
  minProfileCompleteness(): Promise<number>;
}

/**
 * Convierte el valor de SSM en numero, o revienta.
 *
 * El 500 explicito no es celo: `Number('tres')` es `NaN`, y **toda**
 * comparacion con `NaN` es falsa. Un parametro mal escrito no dejaria el tope
 * en un valor raro, lo desactivaria -- `total >= NaN` es siempre falso, y la
 * puerta se quedaria abierta de par en par sin una sola linea de log. Un fallo
 * de configuracion tiene que sonar, no relajar la regla que configura.
 *
 * La cadena vacia se comprueba aparte porque `Number('')` **no** es `NaN`, es
 * `0`, y ahi el fallo silencioso es aun peor: un tope de cero deja sin informes
 * a cualquiera, y un umbral de cero se lo da a cualquiera. Justo las dos formas
 * de romperlo que nadie ata a un parametro que se quedo en blanco.
 */
function aNumero(nombre: string, crudo: string): number {
  const limpio = crudo.trim();
  const valor = Number(limpio);
  if (limpio === '' || !Number.isFinite(valor)) {
    throw ApiError.internal(`El parametro SSM ${nombre} no es un numero: "${crudo}"`);
  }
  return valor;
}

export function createReportsConfig(ssm: SsmReader = createSsmReader()): ReportsConfig {
  async function leerNumero(clave: string): Promise<number> {
    const ruta = ssmConfigPath(clave);
    return aNumero(ruta, await ssm.getRequiredString(ruta));
  }

  return {
    maxPerUserPerDay: () => leerNumero(CLAVE_TOPE),
    minProfileCompleteness: () => leerNumero(CLAVE_COMPLETITUD),
  };
}

export const SSM_KEYS = { maxPerUserPerDay: CLAVE_TOPE, minProfileCompleteness: CLAVE_COMPLETITUD };
