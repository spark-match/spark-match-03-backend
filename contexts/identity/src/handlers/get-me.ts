import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { z } from 'zod';
import { buildContext } from '../composition.js';

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
  requireAuth: true,
  handler: async (_input, _event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const ctx = await buildContext();
    const user = await ctx.userRepository.findById(auth.userId);
    if (!user) {
      throw ApiError.userNotFound();
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
