import { describe, it, expect } from 'vitest';
import {
  MalformedReportObjectsError,
  parseReportObjects,
  parseTopCareers,
  REPORT_STATUSES,
} from './orientation-report.js';

const OBJETO_VALIDO = {
  key: 'reports/u-1/r-1.json',
  versionId: 'v1',
  sizeBytes: 12_345,
  checksumSha256: 'a'.repeat(64),
};

function objetos(overrides: Record<string, unknown> = {}) {
  return {
    json: { ...OBJETO_VALIDO },
    pdf: { ...OBJETO_VALIDO, key: 'reports/u-1/r-1.pdf' },
    ...overrides,
  };
}

describe('parseReportObjects', () => {
  it('acepta los dos objetos completos', () => {
    const parsed = parseReportObjects(objetos());

    expect(parsed.json.key).toBe('reports/u-1/r-1.json');
    expect(parsed.pdf.key).toBe('reports/u-1/r-1.pdf');
    expect(parsed.json.sizeBytes).toBe(12_345);
  });

  it('admite versionId nulo, que es lo que da un bucket sin versionado', () => {
    const parsed = parseReportObjects(objetos({ json: { ...OBJETO_VALIDO, versionId: null } }));

    expect(parsed.json.versionId).toBeNull();
  });

  it('rechaza que falte el pdf', () => {
    // La columna es JSONB: Postgres no comprueba la forma, sólo que estén las
    // dos claves. Todo lo demás tiene que caer aquí.
    const sinPdf = { json: { ...OBJETO_VALIDO } };

    expect(() => parseReportObjects(sinPdf)).toThrow(MalformedReportObjectsError);
    expect(() => parseReportObjects(sinPdf)).toThrow(/`pdf` is missing/);
  });

  it('rechaza un objeto sin key', () => {
    const roto = objetos({ pdf: { versionId: null, sizeBytes: 1, checksumSha256: 'x' } });

    expect(() => parseReportObjects(roto)).toThrow(/`pdf.key` is missing/);
  });

  it('rechaza un tamaño que no es número', () => {
    const roto = objetos({ json: { ...OBJETO_VALIDO, sizeBytes: '12345' } });

    expect(() => parseReportObjects(roto)).toThrow(/`json.sizeBytes` is not a number/);
  });

  it('rechaza un versionId que no es ni texto ni nulo', () => {
    const roto = objetos({ json: { ...OBJETO_VALIDO, versionId: 7 } });

    expect(() => parseReportObjects(roto)).toThrow(/`json.versionId`/);
  });

  it('rechaza un array, que es un JSON válido y no es esto', () => {
    expect(() => parseReportObjects([])).toThrow(/not a JSON object/);
  });

  it('rechaza null', () => {
    expect(() => parseReportObjects(null)).toThrow(/not a JSON object/);
  });
});

describe('parseTopCareers', () => {
  it('acepta una lista de nombres', () => {
    expect(parseTopCareers(['Ingeniería Industrial', 'Arquitectura'])).toEqual([
      'Ingeniería Industrial',
      'Arquitectura',
    ]);
  });

  it('acepta la lista vacía', () => {
    expect(parseTopCareers([])).toEqual([]);
  });

  it('rechaza que no sea un array', () => {
    expect(() => parseTopCareers({ 0: 'Arquitectura' })).toThrow(/not an array/);
  });

  it('rechaza un hueco dentro', () => {
    // Guardamos nombres, que es como se identifican las 554 carreras del
    // portal. Un elemento vacío no identifica ninguna.
    expect(() => parseTopCareers(['Arquitectura', ''])).toThrow(/top_careers\[1\]/);
  });

  it('rechaza un número colado entre los nombres', () => {
    expect(() => parseTopCareers(['Arquitectura', 12])).toThrow(/top_careers\[1\]/);
  });
});

describe('REPORT_STATUSES', () => {
  it('son exactamente los tres del CHECK de la migración 006', () => {
    // Si alguien añade un estado aquí sin migrar, la fila lo rechaza en
    // producción y no en los tests. Esta comparación es el recordatorio.
    expect(REPORT_STATUSES).toEqual(['pending', 'ready', 'failed']);
  });
});
