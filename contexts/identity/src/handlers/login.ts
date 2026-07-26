import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { buildContext } from '../composition.js';
import { LoginInputSchema, type LoginInput, type LoginOutput } from '../schemas/login.schema.js';

export const handler = buildHandler<LoginInput, LoginOutput>({
  name: 'identity-login',
  inputSchema: LoginInputSchema,
  logger: createLogger('identity-login'),
  tracer: new Tracer({ serviceName: 'identity-login' }),
  handler: async (input) => {
    const ctx = await buildContext();
    const user = await ctx.userService.authenticate(input.email, input.password);
    const accessToken = await ctx.signForUser(user);
    ctx.logger.info('User logged in', { userId: user.id });

    return {
      accessToken,
      expiresIn: ctx.defaultTokenExpiresSeconds,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    };
  },
});
