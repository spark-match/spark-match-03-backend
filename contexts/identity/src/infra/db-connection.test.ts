import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSsmGetRequiredString, send } = vi.hoisted(() => ({
  mockSsmGetRequiredString: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: mockSsmGetRequiredString,
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
  return { SecretsManagerClient, GetSecretValueCommand, send };
});

vi.mock('pg', () => {
  class FakePool {
    end = vi.fn().mockResolvedValue(undefined);
  }
  const Pool = vi.fn().mockImplementation(function() {
    return new FakePool();
  });
  return { Pool, __FakePool: FakePool };
});

import { Pool as MockPoolCtor } from 'pg';
import { getDbConnection, closeDbConnection } from './db-connection.js';

const mockedSsm = vi.mocked(mockSsmGetRequiredString);
const mockedSend = vi.mocked(send);
const mockedPoolCtor = vi.mocked(MockPoolCtor);

const DB_CREDENTIALS = {
  host: 'db.example.com',
  port: 5432,
  database: 'sparkmatch',
  username: 'identity',
  password: 'shh',
};

beforeEach(async () => {
  mockedSsm.mockReset();
  mockedSsm.mockResolvedValue('arn:aws:secretsmanager:us-east-1:111:secret:db-creds');
  mockedSend.mockReset();
  mockedSend.mockResolvedValue({ SecretString: JSON.stringify(DB_CREDENTIALS) });
  mockedPoolCtor.mockClear();
  await closeDbConnection();
});

describe('getDbConnection', () => {
  it('resolves the secret ARN via SSM and then reads credentials from Secrets Manager', async () => {
    const db = await getDbConnection();

    expect(db).toBeDefined();
    expect(mockedSsm).toHaveBeenCalledWith('/spark-match/db/secret-arn', {
      maxAge: 300,
      throwOnError: false,
    });
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('configures the pg.Pool with the resolved credentials', async () => {
    await getDbConnection();

    expect(mockedPoolCtor).toHaveBeenCalledTimes(1);
    const config = mockedPoolCtor.mock.calls[0]![0] as {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      application_name: string;
      max: number;
    };
    expect(config.host).toBe(DB_CREDENTIALS.host);
    expect(config.port).toBe(DB_CREDENTIALS.port);
    expect(config.database).toBe(DB_CREDENTIALS.database);
    expect(config.user).toBe(DB_CREDENTIALS.username);
    expect(config.password).toBe(DB_CREDENTIALS.password);
    expect(config.application_name).toBe('spark-match-backend');
    expect(config.max).toBe(5);
  });

  it('returns the cached connection on subsequent calls without re-fetching', async () => {
    const first = await getDbConnection();
    const second = await getDbConnection();

    expect(first).toBe(second);
    expect(mockedSsm).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedPoolCtor).toHaveBeenCalledTimes(1);
  });

  it('honors a custom secretArn when supplied and skips SSM', async () => {
    mockedSsm.mockReset();

    const db = await getDbConnection({
      secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:custom-creds',
    });

    expect(db).toBeDefined();
    expect(mockedSsm).not.toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('throws when Secrets Manager returns a non-JSON SecretString', async () => {
    mockedSend.mockReset();
    mockedSend.mockResolvedValue({ SecretString: 'not-json{' });

    await expect(getDbConnection()).rejects.toBeDefined();
  });
});

describe('closeDbConnection', () => {
  it('is a no-op when no pool has been created', async () => {
    await expect(closeDbConnection()).resolves.toBeUndefined();
  });

  it('tears down the cached pool so the next getDbConnection re-creates it', async () => {
    const db1 = await getDbConnection();
    await closeDbConnection();
    const db2 = await getDbConnection();

    expect(db1).not.toBe(db2);
    expect(mockedPoolCtor).toHaveBeenCalledTimes(2);
  });
});
