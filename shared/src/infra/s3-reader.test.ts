import { describe, it, expect, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { createS3Reader } from './s3-reader.js';

/** Cliente falso: el lector recibe uno inyectado justo para esto. */
function fakeClient(impl: (cmd: unknown) => unknown): S3Client {
  return { send: vi.fn(impl) } as unknown as S3Client;
}

function cuerpo(texto: string) {
  return {
    transformToByteArray: () => Promise.resolve(new TextEncoder().encode(texto)),
  };
}

const REF = { bucket: 'spark-match-reports-dev', key: 'reports/u-1/r-1.pdf' };

describe('getObject', () => {
  it('devuelve los bytes, el content type y la version', async () => {
    const s3 = fakeClient(() =>
      Promise.resolve({ Body: cuerpo('hola'), ContentType: 'application/pdf', VersionId: 'v1' }),
    );

    const salida = await createS3Reader(s3).getObject(REF);

    expect(salida.body.toString('utf-8')).toBe('hola');
    expect(salida.contentType).toBe('application/pdf');
    expect(salida.versionId).toBe('v1');
  });

  it('pide la version concreta cuando se le da una', async () => {
    const s3 = fakeClient(() => Promise.resolve({ Body: cuerpo('x') }));

    await createS3Reader(s3).getObject({ ...REF, versionId: 'v-7' });

    const cmd = (s3.send as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.input.VersionId).toBe('v-7');
  });

  it('con versionId null NO manda el parametro', async () => {
    // El SDK serializa `null` como `versionId=null` literal y S3 responde 400.
    const s3 = fakeClient(() => Promise.resolve({ Body: cuerpo('x') }));

    await createS3Reader(s3).getObject({ ...REF, versionId: null });

    const cmd = (s3.send as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cmd.input.VersionId).toBeUndefined();
  });

  it('un objeto que no esta es 500, no 404', async () => {
    // La fila dice que el objeto existe. Que no este significa que el registro
    // y el bucket no coinciden: es una averia nuestra, no un error del cliente.
    const s3 = fakeClient(() => {
      const err = new Error('no such key');
      err.name = 'NoSuchKey';
      return Promise.reject(err);
    });

    await expect(createS3Reader(s3).getObject(REF)).rejects.toMatchObject({ statusCode: 500 });
  });

  it('un 404 sin nombre reconocible tambien es 500', async () => {
    const s3 = fakeClient(() =>
      Promise.reject(Object.assign(new Error('nope'), { $metadata: { httpStatusCode: 404 } })),
    );

    await expect(createS3Reader(s3).getObject(REF)).rejects.toMatchObject({ statusCode: 500 });
  });

  it('cualquier otro fallo de S3 es 503', async () => {
    const s3 = fakeClient(() => Promise.reject(new Error('timeout')));

    await expect(createS3Reader(s3).getObject(REF)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('una respuesta sin cuerpo es 500 y no un TypeError', async () => {
    const s3 = fakeClient(() => Promise.resolve({ ContentType: 'application/pdf' }));

    await expect(createS3Reader(s3).getObject(REF)).rejects.toMatchObject({ statusCode: 500 });
  });

  it('sin content type ni version, devuelve null y no undefined', async () => {
    const s3 = fakeClient(() => Promise.resolve({ Body: cuerpo('x') }));

    const salida = await createS3Reader(s3).getObject(REF);

    expect(salida.contentType).toBeNull();
    expect(salida.versionId).toBeNull();
  });
});
