import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { createSecretsReader } from '@spark-match/shared/infra';
import { buildContext } from '../composition.js';
import { LoginInputSchema, type LoginInput, type LoginOutput } from '../schemas/login.schema.js';
import { signJwt } from '@spark-match/shared/auth';

export const handler = buildHandler<LoginInput, LoginOutput>({
  name: 'identity-login',
  inputSchema: LoginInputSchema,
  logger: createLogger('identity-login'),
  tracer: new Tracer({ serviceName: 'identity-login' }),
  handler: async (input) => {
    const ctx = await buildContext();
    const user = await ctx.userService.authenticate(input.email, input.password);

    const secrets = createSecretsReader();
    const jwtSecretArn = process.env.JWT_SECRET_ARN;
    if (!jwtSecretArn) {
      throw new Error('JWT_SECRET_ARN env var is not set');
    }
    const jwtSecret = await secrets.get(jwtSecretArn);
    const accessToken = signJwt({ sub: user.id, email: user.email }, jwtSecret, '24h');

    ctx.logger.info('User logged in', { userId: user.id });

    return {
      accessToken,
      expiresIn: 86400,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    };
  },
});
