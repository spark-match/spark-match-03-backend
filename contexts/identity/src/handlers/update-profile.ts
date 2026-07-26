import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicUser } from '../domain/user.js';
import {
  UpdateProfileInputSchema,
  type UpdateProfileInput,
  type UpdateProfileOutput,
} from '../schemas/update-profile.schema.js';

export const handler = buildHandler<UpdateProfileInput, UpdateProfileOutput>({
  name: 'identity-update-profile',
  inputSchema: UpdateProfileInputSchema,
  logger: createLogger('identity-update-profile'),
  tracer: new Tracer({ serviceName: 'identity-update-profile' }),
  requireAuth: true,
  handler: async (input, _event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    if (Object.keys(input).length === 0) {
      throw ApiError.badRequest('At least one of fullName or age must be provided', {
        code: 'validation.empty_changes',
        message: 'At least one of fullName or age must be provided',
      });
    }
    const ctx = await buildContext();
    const user = await ctx.userService.updateUser({
      actorUserId: auth.userId,
      targetUserId: auth.userId,
      changes: input,
    });
    return toPublicUser(user) as unknown as UpdateProfileOutput;
  },
});