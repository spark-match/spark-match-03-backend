import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { z } from 'zod';
import { buildContext } from '../composition.js';
import { toPublicUser } from '../domain/user.js';

const EmptySchema = z.object({});

export interface ActivateUserOutput {
  id: string;
  email: string;
  fullName: string;
  age: number | null;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const handler = buildHandler<unknown, ActivateUserOutput>({
  name: 'identity-activate-user',
  inputSchema: EmptySchema,
  logger: createLogger('identity-activate-user'),
  tracer: new Tracer({ serviceName: 'identity-activate-user' }),
  requireAuth: true,
  handler: async (_input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const targetUserId = event.pathParameters?.userId;
    if (!targetUserId) {
      throw ApiError.badRequest('Missing userId path parameter');
    }
    const ctx = await buildContext();
    const user = await ctx.userService.activateUser({
      actorUserId: auth.userId,
      targetUserId,
    });
    const pub = toPublicUser(user);
    return {
      id: pub.id,
      email: pub.email,
      fullName: pub.fullName,
      age: pub.age,
      role: pub.role,
      active: pub.active,
      createdAt: pub.createdAt.toISOString(),
      updatedAt: pub.updatedAt.toISOString(),
    };
  },
});