import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { decodeJwt } from '@spark-match/shared/auth';
import { createSecretsReader } from '@spark-match/shared/infra';
import { z } from 'zod';

const GetMeInputSchema = z.object({});

export interface GetMeOutput {
  id: string;
  email: string;
  fullName: string;
  age: number | null;
  createdAt: string;
}

export const handler = buildHandler<unknown, GetMeOutput>({
  name: 'identity-get-me',
  inputSchema: GetMeInputSchema,
  logger: createLogger('identity-get-me'),
  tracer: new Tracer({ serviceName: 'identity-get-me' }),
  handler: async (_input, event) => {
    const authHeader = (event as { headers?: Record<string, string> }).headers?.['authorization'] ?? '';
    if (!authHeader) {
      throw ApiError.unauthorized('Missing Authorization header');
    }

    const secrets = createSecretsReader();
    const jwtSecretArn = process.env.JWT_SECRET_ARN;
    if (!jwtSecretArn) {
      throw new Error('JWT_SECRET_ARN env var is not set');
    }
    const jwtSecret = await secrets.get(jwtSecretArn);

    const decoded = decodeJwt(authHeader, { secret: jwtSecret });

    const { getDbConnection } = await import('../infra/db-connection.js');
    const { createUserRepository } = await import('../infra/user-repository.js');
    const db = await getDbConnection();
    const repo = createUserRepository(db);
    const user = await repo.findById(decoded.sub);
    if (!user) {
      throw ApiError.notFound('User');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      age: user.age,
      createdAt: user.createdAt.toISOString(),
    };
  },
});
