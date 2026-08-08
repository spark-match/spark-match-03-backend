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
  handler: async (input, event) => {
    const ctx = await buildContext();
    const ip = event.requestContext.http.sourceIp;
    const userAgent = event.headers['user-agent'] ?? 'unknown';
    const user = await ctx.userService.authenticate({
      email: input.email,
      password: input.password,
      ip,
      userAgent,
    });
    const accessToken = await ctx.signForUser(user);
    ctx.logger.info('User logged in', { userId: user.id });

    return {
      accessToken,
      expiresIn: ctx.defaultTokenExpiresSeconds,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  },
});
