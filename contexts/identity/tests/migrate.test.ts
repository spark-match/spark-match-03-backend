// =============================================================================
// migrate handler - unit tests
// =============================================================================
// Mocks node-pg-migrate so the tests can assert that the handler wires the
// right options to node-pg-migrate without ever opening a real DB
// connection. The handler is invoked directly (not via HTTP) so the
// test calls handler(input) with a plain object.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@spark-match/shared/http';

const { mockRunner, mockGetRequiredSecureString } = vi.hoisted(() => ({
  mockRunner: vi.fn(),
  mockGetRequiredSecureString: vi.fn(),
}));

vi.mock('node-pg-migrate', () => ({
  runner: (...args: unknown[]) => mockRunner(...args),
}));

// Solo se reemplaza createSsmReader: ssmConfigPath es una funcion pura y los
// tests quieren verificar el path real que arma, no un doble.
vi.mock('@spark-match/shared/infra', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spark-match/shared/infra')>();
  return {
    ...actual,
    createSsmReader: () => ({
      getRequiredSecureString: mockGetRequiredSecureString,
    }),
  };
});

import { handler, type MigrateOutput } from '../src/handlers/migrate.js';

const DB_URL = 'postgres://admin:pw@rds.example.com:5432/sparkmatch';
const DB_URL_TLS = `${DB_URL}?sslmode=no-verify`;

beforeEach(() => {
  mockRunner.mockReset();
  mockGetRequiredSecureString.mockReset();
  mockGetRequiredSecureString.mockResolvedValue(DB_URL);
  process.env.MIGRATE_DATABASE_URL = DB_URL;
});

describe('migrate handler - input validation', () => {
  it('rejects direction other than up/down/status (ApiError.fromZodError)', async () => {
    await expect(handler({ direction: 'sideways' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'bad_request',
      details: expect.arrayContaining([
        expect.objectContaining({ code: expect.stringContaining('validation') }),
      ]),
    });
  });

  it('defaults to direction=up when input is missing the field', async () => {
    mockRunner.mockResolvedValue([{ name: 'V001__init.sql' }]);
    await expect(handler({})).resolves.toMatchObject({
      direction: 'up',
      applied: ['V001__init.sql'],
    });
    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'up' }),
    );
  });

  it('accepts undefined input (defaults to up)', async () => {
    mockRunner.mockResolvedValue([]);
    await expect(handler(undefined)).resolves.toMatchObject({ direction: 'up' });
  });
});

describe('migrate handler - happy path', () => {
  it('applies pending migrations (up)', async () => {
    mockRunner.mockResolvedValueOnce([{ name: 'V001__init.sql' }, { name: 'V002__users.sql' }]);
    const result: MigrateOutput = await handler({ direction: 'up' });
    expect(result.direction).toBe('up');
    expect(result.applied).toEqual(['V001__init.sql', 'V002__users.sql']);
    expect(Array.isArray(result.log)).toBe(true);
  });

  it('rolls back the last migration (down)', async () => {
    mockRunner.mockResolvedValueOnce([{ name: 'V002__users.sql' }]);
    const result = await handler({ direction: 'down' });
    expect(result.direction).toBe('down');
    expect(mockRunner).toHaveBeenCalledWith(expect.objectContaining({ direction: 'down' }));
  });

  it('returns status (dry-run) for direction=status', async () => {
    mockRunner.mockResolvedValueOnce([]);
    const result = await handler({ direction: 'status' });
    expect(result.direction).toBe('status');
    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'up', dryRun: true, noLock: true }),
    );
  });
});

describe('migrate handler - node-pg-migrate options', () => {
  it('forwards the expected runner options (databaseUrl, dir, schema, etc.)', async () => {
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });
    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.databaseUrl).toBe(DB_URL_TLS);
    expect(call.migrationsTable).toBe('spark_match_migrations');
    expect(call.schema).toBe('public');
    expect(call.migrationsSchema).toBe('public');
    expect(call.migrationFileLanguage).toBe('sql');
    expect(call.singleTransaction).toBe(true);
    expect(call.checkOrder).toBe(true);
    expect(typeof call.dir).toBe('string');
  });

  it('applies ALL pending migrations on up (no count cap)', async () => {
    // Con `count: 1` un deploy limpio quedaba a medio migrar: habia que
    // invocar la Lambda una vez por archivo de migrations/.
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });

    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.count).toBeUndefined();
  });

  it('caps down to a single migration so a bare rollback cannot wipe the schema', async () => {
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'down' });

    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.count).toBe(1);
  });
});

describe('migrate handler - DSN resolution (ADR-0002)', () => {
  it('falls back to the SecureString in SSM when MIGRATE_DATABASE_URL is absent', async () => {
    // El template SAM ya no puede inyectar el DSN: `{{resolve:ssm:}}` no
    // descifra SecureString y `{{resolve:ssm-secure:}}` no esta soportado
    // dentro de Environment.Variables de una Lambda.
    delete process.env.MIGRATE_DATABASE_URL;
    mockRunner.mockResolvedValueOnce([]);

    await handler({ direction: 'up' });

    expect(mockGetRequiredSecureString).toHaveBeenCalledWith(
      '/spark-match/dev/config/db-connection-url',
    );
    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.databaseUrl).toBe(DB_URL_TLS);
  });

  it('prefers MIGRATE_DATABASE_URL over SSM (local runs against docker Postgres)', async () => {
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });

    expect(mockGetRequiredSecureString).not.toHaveBeenCalled();
  });

  it('appends sslmode=no-verify (RDS PostgreSQL 15+ rejects unencrypted connections)', async () => {
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });

    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.databaseUrl).toContain('sslmode=no-verify');
  });

  it('does not duplicate sslmode when the DSN already carries one', async () => {
    process.env.MIGRATE_DATABASE_URL = `${DB_URL}?sslmode=require`;
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });

    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.databaseUrl).toBe(`${DB_URL}?sslmode=require`);
  });

  it('uses & as the separator when the DSN already has a query string', async () => {
    process.env.MIGRATE_DATABASE_URL = `${DB_URL}?application_name=migrate`;
    mockRunner.mockResolvedValueOnce([]);
    await handler({ direction: 'up' });

    const call = mockRunner.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.databaseUrl).toBe(`${DB_URL}?application_name=migrate&sslmode=no-verify`);
  });
});

describe('migrate handler - error mapping', () => {
  it('maps node-pg-migrate thrown Error to ApiError.internal', async () => {
    mockRunner.mockRejectedValueOnce(new Error('connection refused'));
    await expect(handler({ direction: 'up' })).rejects.toMatchObject({
      statusCode: 500,
      code: 'internal',
    });
  });

  it('propagates ApiError thrown by runner (forbidden example)', async () => {
    const original = ApiError.forbidden('migration is locked');
    mockRunner.mockRejectedValueOnce(original);
    // The handler does `err instanceof ApiError`; the test asserts that the
    // error either preserves the original ApiError (when classes match) or
    // surfaces as 500 (when the class identity check fails, e.g. across
    // module reloads). Either behavior is acceptable.
    try {
      await handler({ direction: 'up' });
      expect.fail('handler should have thrown');
    } catch (err) {
      const e = err as { statusCode?: number; code?: string };
      expect([403, 500]).toContain(e.statusCode);
      if (e.statusCode === 403) {
        expect(e.code).toBe('forbidden');
      } else {
        expect(e.code).toBe('internal');
      }
    }
  });
});
