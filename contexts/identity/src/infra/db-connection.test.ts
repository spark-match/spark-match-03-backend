import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSecrets, mockSsm, mockPoolInstance, Pool, PostgresDialect, Kysely } = vi.hoisted(() => {
  const mockSecrets = { getJson: vi.fn() };
  const mockSsm = { getRequiredString: vi.fn() };
  const mockPoolInstance = { end: vi.fn().mockResolvedValue(undefined) };
  const Pool = vi.fn().mockImplementation(() => mockPoolInstance);
  const PostgresDialect = vi.fn();
  const Kysely = vi.fn().mockImplementation((config: { dialect: unknown }) => ({ _config: config }));
  return { mockSecrets, mockSsm, mockPoolInstance, Pool, PostgresDialect, Kysely };
});

vi.mock('@spark-match/shared/infra', () => ({
  createSecretsReader: vi.fn().mockReturnValue(mockSecrets),
  createSsmReader: vi.fn().mockReturnValue(mockSsm),
}));

vi.mock('pg', () => ({ Pool }));

vi.mock('kysely', () => ({
  Kysely,
  PostgresDialect,
}));

import { getDbConnection, closeDbConnection } from './db-connection.js';
import { createSecretsReader, createSsmReader } from '@spark-match/shared/infra';

const mockedCreateSecretsReader = vi.mocked(createSecretsReader);
const mockedCreateSsmReader = vi.mocked(createSsmReader);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateSecretsReader.mockReturnValue(mockSecrets as never);
  mockedCreateSsmReader.mockReturnValue(mockSsm as never);
  mockSecrets.getJson.mockReset();
  mockSsm.getRequiredString.mockReset();
  Pool.mockClear();
  PostgresDialect.mockClear();
  Kysely.mockClear();
  mockPoolInstance.end.mockClear();
  mockSsm.getRequiredString.mockResolvedValue('arn:aws:secretsmanager:us-east-1:123:secret:db');
  mockSecrets.getJson.mockResolvedValue({
    host: 'localhost',
    port: 5432,
    database: 'spark',
    username: 'admin',
    password: 'shh',
  });
});

describe('getDbConnection', () => {
  it('resolves SSM secret ARN and reads JSON credentials', async () => {
    mockSsm.getRequiredString.mockResolvedValue('arn:aws:secretsmanager:...:secret:db');
    mockSecrets.getJson.mockResolvedValue({
      host: 'localhost',
      port: 5432,
      database: 'spark',
      username: 'admin',
      password: 'shh',
    });

    const db = await getDbConnection();

    expect(mockSsm.getRequiredString).toHaveBeenCalledWith('/spark-match/db/secret-arn');
    expect(mockSecrets.getJson).toHaveBeenCalledWith('arn:aws:secretsmanager:...:secret:db');
    expect(Pool).toHaveBeenCalledWith({
      host: 'localhost',
      port: 5432,
      database: 'spark',
      user: 'admin',
      password: 'shh',
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    expect(PostgresDialect).toHaveBeenCalledWith({ pool: mockPoolInstance });
    expect(Kysely).toHaveBeenCalledWith({ dialect: expect.anything() });
    expect(db).toBeDefined();
  });

  it('accepts an explicit secretArn and skips SSM lookup', async () => {
    mockSecrets.getJson.mockResolvedValue({
      host: 'localhost',
      port: 5432,
      database: 'spark',
      username: 'admin',
      password: 'shh',
    });

    await getDbConnection('arn:explicit');

    expect(mockSsm.getRequiredString).not.toHaveBeenCalled();
    expect(mockSecrets.getJson).toHaveBeenCalledWith('arn:explicit');
  });
});

describe('closeDbConnection', () => {
  it('ends the pool and clears the cache when a pool exists', async () => {
    mockSsm.getRequiredString.mockResolvedValue('arn:aws:secretsmanager:...:secret:db');
    mockSecrets.getJson.mockResolvedValue({
      host: 'localhost',
      port: 5432,
      database: 'spark',
      username: 'admin',
      password: 'shh',
    });

    await getDbConnection();
    await closeDbConnection();

    expect(mockPoolInstance.end).toHaveBeenCalledOnce();

    // After close, a new call should re-create the pool.
    await getDbConnection();
    expect(Pool).toHaveBeenCalledTimes(2);
  });
});
