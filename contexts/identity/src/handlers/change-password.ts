import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import {
  ChangePasswordInputSchema,
  type ChangePasswordInput,
  type ChangePasswordOutput,
} from '../schemas/change-password.schema.js';

export const handler = buildHandler<ChangePasswordInput, ChangePasswordOutput>({
  name: 'identity-change-password',
  inputSchema: ChangePasswordInputSchema,
  logger: createLogger('identity-change-password'),
  tracer: new Tracer({ serviceName: 'identity-change-password' }),
  requireAuth: true,
  handler: async (input, _event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const ctx = await buildContext();
    await ctx.userService.changePassword({
      actorUserId: auth.userId,
      targetUserId: auth.userId,
      newPassword: input.newPassword,
    });
    ctx.logger.info('Password changed', { userId: auth.userId });
    return { message: 'password updated' };
  },
});