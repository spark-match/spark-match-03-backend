import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { z } from 'zod';
import { buildContext } from '../composition.js';
import { toPublicUser, type PublicUser } from '../domain/user.js';

const GetMeInputSchema = z.object({});

export const handler = buildHandler<unknown, PublicUser>({
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
    const user = await ctx.userService.getUser({
      actorUserId: auth.userId,
      targetUserId: auth.userId,
    });
    return toPublicUser(user);
  },
});
