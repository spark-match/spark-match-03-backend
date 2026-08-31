import { describe, it, expect, vi } from 'vitest';
import type { S3Reader } from '@spark-match/shared/infra';
import { createReportObjectStore, CONTENT_TYPES } from './report-object-store.js';
import type { ReportObjects } from '../domain/orientation-report.js';

const OBJETOS: ReportObjects = {
  json: { key: 'reports/u-1/r-1.json', versionId: 'v-json', sizeBytes: 10, checksumSha256: 'aaa' },
  pdf: { key: 'reports/u-1/r-1.pdf', versionId: 'v-pdf', sizeBytes: 20, checksumSha256: 'bbb' },
};

function lector(bytes = Buffer.from('contenido')) {
  const getObject = vi.fn().mockResolvedValue({ body: bytes, contentType: null, versionId: null });
  return { reader: { getObject } as unknown as S3Reader, getObject };
}

describe('fetch', () => {
  it('lee la clave del objeto que se le pide', async () => {
    const { reader, getObject } = lector();

    await createReportObjectStore(reader).fetch({
      bucket: 'spark-match-reports-dev',
      objects: OBJETOS,
      kind: 'pdf',
    });

    expect(getObject).toHaveBeenCalledWith({
      bucket: 'spark-match-reports-dev',
      key: 'reports/u-1/r-1.pdf',
      versionId: 'v-pdf',
    });
  });

  it('el json y el pdf son claves distintas', async () => {
    // Un `objects[kind]` mal escrito serviria el JSON con content type de PDF
    // y nadie se enteraria hasta que un navegador intentara abrirlo.
    const { reader, getObject } = lector();
    const store = createReportObjectStore(reader);
    const comun = { bucket: 'b', objects: OBJETOS };

    await store.fetch({ ...comun, kind: 'json' });
    await store.fetch({ ...comun, kind: 'pdf' });

    expect(getObject.mock.calls[0][0].key).toBe('reports/u-1/r-1.json');
    expect(getObject.mock.calls[1][0].key).toBe('reports/u-1/r-1.pdf');
  });

  it('pide la version que registro la fila, no la ultima', async () => {
    const { reader, getObject } = lector();

    await createReportObjectStore(reader).fetch({ bucket: 'b', objects: OBJETOS, kind: 'json' });

    expect(getObject.mock.calls[0][0].versionId).toBe('v-json');
  });

  it('devuelve los bytes tal cual', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10]);
    const { reader } = lector(bytes);

    const salida = await createReportObjectStore(reader).fetch({
      bucket: 'b',
      objects: OBJETOS,
      kind: 'pdf',
    });

    expect(salida.equals(bytes)).toBe(true);
  });

  it('cada tipo tiene su content type', () => {
    expect(CONTENT_TYPES.json).toBe('application/json');
    expect(CONTENT_TYPES.pdf).toBe('application/pdf');
  });
});
