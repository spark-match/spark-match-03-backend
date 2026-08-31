import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetDbConnection } = vi.hoisted(() => ({
  mockGetDbConnection: vi.fn(),
}));

vi.mock('./infra/db-connection.js', () => ({
  getDbConnection: mockGetDbConnection,
  closeDbConnection: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: class {
    constructor(public readonly options: unknown) {}
  },
}));

// El contexto es un singleton a nivel de MODULO: sin reimportarlo, el primer
// test lo deja construido y los siguientes miden un contenedor que ya estaba
// caliente. `resetModules` simula un arranque en frio por caso.
async function cargarComposition() {
  vi.resetModules();
  return import('./composition.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDbConnection.mockResolvedValue({ withSchema: vi.fn() });
});

describe('buildContext', () => {
  it('arma el contexto con su repositorio y su servicio', async () => {
    const { buildContext } = await cargarComposition();

    const ctx = await buildContext();

    expect(ctx.db).toBeDefined();
    expect(typeof ctx.reportRepository.create).toBe('function');
    expect(typeof ctx.reportService.request).toBe('function');
  });

  it('lo construye una sola vez por contenedor', async () => {
    // Es un singleton perezoso: cada arranque en frio paga la conexion, cada
    // invocacion siguiente no.
    const { buildContext } = await cargarComposition();

    await buildContext();
    await buildContext();

    expect(mockGetDbConnection).toHaveBeenCalledTimes(1);
  });

  it('dos llamadas concurrentes no abren dos conexiones', async () => {
    // Sin la promesa compartida, dos peticiones que entran a la vez en un
    // contenedor recien arrancado abrirían un pool cada una.
    const { buildContext } = await cargarComposition();

    const [uno, otro] = await Promise.all([buildContext(), buildContext()]);

    expect(uno).toBe(otro);
    expect(mockGetDbConnection).toHaveBeenCalledTimes(1);
  });
});
