import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetParameter, send } = vi.hoisted(() => ({
  mockGetParameter: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: mockGetParameter,
}));

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const GetSecretValueCommand = vi
    .fn()
    .mockImplementation(function(input: { SecretId: string }) {
      return { input };
    });
  const SecretsManagerClient = vi.fn().mockImplementation(function() {
    return { send };
  });
  return { SecretsManagerClient, GetSecretValueCommand };
});

const JWT_ARN = 'arn:aws:secretsmanager:us-east-1:111:secret:jwt';
const DB_ARN = 'arn:aws:secretsmanager:us-east-1:111:secret:db';

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: class {
    isTracingEnabled() {
      return false;
    }
    getSegment() {
      return { addNewSubsegment: () => ({ close: () => {} }) };
    }
    captureAsyncFunc(_name: string, fn: () => Promise<unknown>) {
      return fn();
    }
  },
}));

vi.mock('kysely', () => ({
  Kysely: class {
    constructor(_config: unknown) {}
  },
  PostgresDialect: class {
    constructor(_config: unknown) {}
  },
}));

vi.mock('pg', () => {
  class FakePool {
    end = vi.fn().mockResolvedValue(undefined);
  }
  const Pool = vi.fn().mockImplementation(function() {
    return new FakePool();
  });
  return { Pool };
});

const mockedSsm = vi.mocked(mockGetParameter);
const mockedSend = vi.mocked(send);

beforeEach(() => {
  mockedSsm.mockReset();
  mockedSend.mockReset();

  mockedSsm.mockImplementation(async (name: string) => {
    if (name === '/spark-match/eventbridge/bus-arn') return 'arn:aws:events:us-east-1:111:bus/spark';
    if (name === '/spark-match/secret/jwt-arn') return JWT_ARN;
    if (name === '/spark-match/db/secret-arn') return DB_ARN;
    return undefined;
  });
  mockedSend.mockImplementation(async (cmd: { input: { SecretId: string } }) => {
    if (cmd.input.SecretId === JWT_ARN) {
      return { SecretString: 'a'.repeat(64) };
    }
    if (cmd.input.SecretId === DB_ARN) {
      return {
        SecretString: JSON.stringify({
          host: 'db.example.com',
          port: 5432,
          database: 'sparkmatch',
          username: 'identity',
          password: 'shh',
        }),
      };
    }
    throw new Error(`unexpected SecretId: ${cmd.input.SecretId}`);
  });
});

async function loadFreshComposition() {
  vi.resetModules();
  const mod = await import('./composition.js');
  return mod.buildContext;
}

describe('buildContext', () => {
  it('builds a complete IdentityContext with all wired collaborators', async () => {
    const buildContext = await loadFreshComposition();
    const ctx = await buildContext();

    expect(ctx.logger).toBeDefined();
    expect(ctx.tracer).toBeDefined();
    expect(ctx.ssm).toBeDefined();
    expect(ctx.eventPublisher).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.userRepository).toBeDefined();
    expect(ctx.auditRepository).toBeDefined();
    expect(ctx.userService).toBeDefined();
    expect(ctx.jwtSigner).toBeDefined();
    expect(typeof ctx.signForUser).toBe('function');
    expect(ctx.defaultTokenExpiresSeconds).toBe(86400);
  });

  it('resolves both EventBridge bus ARN and JWT secret ARN from SSM during build', async () => {
    const buildContext = await loadFreshComposition();
    await buildContext();

    const names = mockedSsm.mock.calls.map((c) => c[0]);
    expect(names).toContain('/spark-match/eventbridge/bus-arn');
    expect(names).toContain('/spark-match/secret/jwt-arn');
  });

  it('returns the same singleton on repeat calls (no SSM/Secrets re-fetch)', async () => {
    const buildContext = await loadFreshComposition();
    const a = await buildContext();
    const b = await buildContext();

    expect(a).toBe(b);
    expect(mockedSsm).toHaveBeenCalledTimes(3);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent invocations so only one build runs', async () => {
    const buildContext = await loadFreshComposition();
    const first = buildContext();
    const second = buildContext();
    const third = buildContext();

    const [a, b, c] = await Promise.all([first, second, third]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(mockedSsm).toHaveBeenCalledTimes(3);
  });

  it('signForUser delegates to jwtSigner.sign and produces a three-part JWT', async () => {
    const buildContext = await loadFreshComposition();
    const ctx = await buildContext();

    const token = await ctx.signForUser({ id: 'user-1', email: 'a@b.com', role: 'admin' });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });
});
