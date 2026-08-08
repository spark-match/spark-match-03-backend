import { describe, it, expect, afterEach } from 'vitest';

import { ssmConfigPath } from './ssm-config-path.js';

const originalEnvironment = process.env.ENVIRONMENT;

afterEach(() => {
  if (originalEnvironment === undefined) {
    delete process.env.ENVIRONMENT;
  } else {
    process.env.ENVIRONMENT = originalEnvironment;
  }
});

describe('ssmConfigPath', () => {
  it('builds the ADR-0002 path for the current environment', () => {
    process.env.ENVIRONMENT = 'prod';
    expect(ssmConfigPath('db-secret-arn')).toBe('/spark-match/prod/config/db-secret-arn');
  });

  it('isolates environments so dev never reads prod configuration', () => {
    process.env.ENVIRONMENT = 'dev';
    const dev = ssmConfigPath('jwt-secret-arn');
    process.env.ENVIRONMENT = 'prod';
    const prod = ssmConfigPath('jwt-secret-arn');

    expect(dev).not.toBe(prod);
    expect(dev).toBe('/spark-match/dev/config/jwt-secret-arn');
    expect(prod).toBe('/spark-match/prod/config/jwt-secret-arn');
  });

  it('falls back to dev when ENVIRONMENT is not set (local runs and unit tests)', () => {
    delete process.env.ENVIRONMENT;
    expect(ssmConfigPath('cors-allowed-origins')).toBe(
      '/spark-match/dev/config/cors-allowed-origins',
    );
  });

  it('covers every key of the cross-repo contract published by modules/ssm-bootstrap', () => {
    process.env.ENVIRONMENT = 'dev';

    // Los 8 parametros que Terraform publica bajo /spark-match/{env}/config/.
    // Si este test falla es porque el contrato cambio de un lado y no del otro.
    const contract = [
      'eventbridge-bus-arn',
      'db-secret-arn',
      'jwt-secret-arn',
      'idempotency-table',
      'cors-allowed-origins',
      'db-connection-url',
      'private-subnet-ids',
      'lambda-security-group-id',
    ];

    for (const key of contract) {
      expect(ssmConfigPath(key)).toBe(`/spark-match/dev/config/${key}`);
    }
  });
});
