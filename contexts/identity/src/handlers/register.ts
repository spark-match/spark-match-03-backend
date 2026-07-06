import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { RegisterInputSchema, type RegisterInput, type RegisterOutput } from '../schemas/register.schema.js';

export const handler = buildHandler<RegisterInput, RegisterOutput>({
  name: 'identity-register',
  inputSchema: RegisterInputSchema,
  logger: createLogger('identity-register'),
  tracer: new Tracer({ serviceName: 'identity-register' }),
  handler: async (input) => {
    const ctx = await buildContext();
    const user = await ctx.userService.register(input);
    ctx.logger.info('User registered', { userId: user.id, email: user.email });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt.toISOString(),
    };
  },
});

export const _throw = ApiError;
