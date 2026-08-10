import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSsmGetRequiredString, send } = vi.hoisted(() => ({
  mockSsmGetRequiredString: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: mockSsmGetRequiredString,
}));

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const GetSecretValueCommand = vi.fn().mockImplementation(function (input: { SecretId: string }) {
    return { input };
  });
  const SecretsManagerClient = vi.fn().mockImplementation(function () {
    return { send };
  });
  return { SecretsManagerClient, GetSecretValueCommand, send };
});

vi.mock('pg', () => {
  class FakePool {
    end = vi.fn().mockResolvedValue(undefined);
  }
  const Pool = vi.fn().mockImplementation(function () {
    return new FakePool();
  });
  return { Pool, __FakePool: FakePool };
});

import { Pool as MockPoolCtor } from 'pg';
import { getDbConnection, closeDbConnection } from './db-connection.js';

const mockedSsm = vi.mocked(mockSsmGetRequiredString);
const mockedSend = vi.mocked(send);
const mockedPoolCtor = vi.mocked(MockPoolCtor);

const CREDENCIALES = {
  host: 'db.example.com',
  port: 5432,
  database: 'sparkmatch',
  username: 'reports',
  password: 'shh',
};

beforeEach(async () => {
  mockedSsm.mockReset();
  mockedSsm.mockResolvedValue('arn:aws:secretsmanager:us-east-1:111:secret:db-creds');
  mockedSend.mockReset();
  mockedSend.mockResolvedValue({ SecretString: JSON.stringify(CREDENCIALES) });
  mockedPoolCtor.mockClear();
  await closeDbConnection();
});

describe('getDbConnection', () => {
  it('lee el ARN del secreto por SSM y luego las credenciales', async () => {
    const db = await getDbConnection();

    expect(db).toBeDefined();
    expect(mockedSsm).toHaveBeenCalledWith(
      '/spark-match/dev/config/db-secret-arn',
      expect.anything(),
    );
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('cifra el transporte, que RDS 15+ no admite conexiones en claro', async () => {
    await getDbConnection();

    const config = mockedPoolCtor.mock.calls[0]![0] as {
      user: string;
      ssl: { rejectUnauthorized: boolean };
      application_name: string;
    };
    expect(config.ssl.rejectUnauthorized).toBe(false);
    expect(config.user).toBe(CREDENCIALES.username);
    expect(config.application_name).toBe('spark-match-backend');
  });

  it('cachea la conexion entre invocaciones del mismo contenedor', async () => {
    // El coste de resolver SSM y Secrets Manager se paga en el arranque en
    // frio y no en cada peticion.
    await getDbConnection();
    await getDbConnection();

    expect(mockedPoolCtor).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('admite que le den el ARN, sin pasar por SSM', async () => {
    await getDbConnection({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:otro' });

    expect(mockedSsm).not.toHaveBeenCalled();
  });
});

describe('closeDbConnection', () => {
  it('cierra el pool y deja que la siguiente llamada cree otro', async () => {
    await getDbConnection();
    await closeDbConnection();
    await getDbConnection();

    expect(mockedPoolCtor).toHaveBeenCalledTimes(2);
  });

  it('no protesta si no habia nada abierto', async () => {
    await expect(closeDbConnection()).resolves.toBeUndefined();
  });
});
