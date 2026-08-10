import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SsmReader } from '@spark-match/shared/infra';
import { createReportsConfig } from './reports-config.js';

const mockGetRequiredString = vi.fn();
const ssm = { getRequiredString: mockGetRequiredString } as unknown as SsmReader;

const ENTORNO_ORIGINAL = process.env.ENVIRONMENT;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENVIRONMENT = 'dev';
});

afterEach(() => {
  if (ENTORNO_ORIGINAL === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = ENTORNO_ORIGINAL;
});

describe('maxPerUserPerDay', () => {
  it('lee el parametro del contrato de ADR-0002', async () => {
    mockGetRequiredString.mockResolvedValue('3');

    const valor = await createReportsConfig(ssm).maxPerUserPerDay();

    expect(valor).toBe(3);
    expect(mockGetRequiredString).toHaveBeenCalledWith(
      '/spark-match/dev/config/reports-max-per-user-per-day',
    );
  });

  it('la ruta lleva el ambiente, no un "dev" fijo', async () => {
    process.env.ENVIRONMENT = 'production';
    mockGetRequiredString.mockResolvedValue('3');

    await createReportsConfig(ssm).maxPerUserPerDay();

    expect(mockGetRequiredString).toHaveBeenCalledWith(
      '/spark-match/production/config/reports-max-per-user-per-day',
    );
  });
});

describe('minProfileCompleteness', () => {
  it('lee su parametro y devuelve el decimal', async () => {
    mockGetRequiredString.mockResolvedValue('0.6');

    const valor = await createReportsConfig(ssm).minProfileCompleteness();

    expect(valor).toBe(0.6);
    expect(mockGetRequiredString).toHaveBeenCalledWith(
      '/spark-match/dev/config/reports-min-profile-completeness',
    );
  });
});

describe('valores que no son numeros', () => {
  it('un parametro mal escrito es 500, NO un NaN silencioso', async () => {
    // Es el fallo peligroso de este modulo: `Number('tres')` es NaN, y toda
    // comparacion con NaN es falsa. Un NaN devuelto aqui no dejaria el tope en
    // un valor raro, lo desactivaria -- `total >= NaN` es siempre falso -- y
    // la puerta se quedaria abierta sin una sola linea de log.
    mockGetRequiredString.mockResolvedValue('tres');

    await expect(createReportsConfig(ssm).maxPerUserPerDay()).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('lo mismo para el umbral de completitud', async () => {
    mockGetRequiredString.mockResolvedValue('sesenta por ciento');

    await expect(createReportsConfig(ssm).minProfileCompleteness()).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('el mensaje dice que parametro es y que traia', async () => {
    mockGetRequiredString.mockResolvedValue('3,5');

    const error = await createReportsConfig(ssm)
      .maxPerUserPerDay()
      .catch((e) => e);

    expect(error.message).toContain('reports-max-per-user-per-day');
    expect(error.message).toContain('3,5');
  });

  it('los espacios de sobra no cuentan como error', async () => {
    // Un valor pegado a mano en la consola de SSM se lleva el salto de linea.
    mockGetRequiredString.mockResolvedValue(' 3\n');

    expect(await createReportsConfig(ssm).maxPerUserPerDay()).toBe(3);
  });

  it('la cadena vacia tambien revienta', async () => {
    // `Number('')` es 0, que como tope significaria "ningun informe para
    // nadie" y como umbral "cualquier perfil vale". Las dos son peores que un
    // error.
    mockGetRequiredString.mockResolvedValue('   ');

    await expect(createReportsConfig(ssm).maxPerUserPerDay()).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe('cacheo', () => {
  it('no guarda el valor: cada llamada vuelve a preguntar al lector', async () => {
    // El cacheo es del SsmReader (300 s). Guardarlo aqui ademas congelaria los
    // dos parametros durante toda la vida del contenedor de la Lambda, que son
    // horas, y convertiria un parametro operable en uno decorativo.
    mockGetRequiredString.mockResolvedValueOnce('3').mockResolvedValueOnce('10');
    const config = createReportsConfig(ssm);

    expect(await config.maxPerUserPerDay()).toBe(3);
    expect(await config.maxPerUserPerDay()).toBe(10);
  });
});
