import { buildHandler } from '@spark-match/shared/templates';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { ApiError } from '@spark-match/shared/http';
import { buildContext } from '../composition.js';
import { toPublicUser, USER_ROLES, type UserRole } from '../domain/user.js';
import {
  ListUsersInputSchema,
  ListUsersOutputSchema,
  type ListUsersInput,
  type ListUsersOutput,
} from '../schemas/list-users.schema.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

interface ParsedFilters {
  limit: number;
  cursor?: string;
  active?: boolean | null;
  role?: UserRole;
}

function parseLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw ApiError.badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`, {
      code: 'validation.invalid_limit',
      message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
      path: 'limit',
      value: raw,
    });
  }
  return parsed;
}

function parseActive(raw: string): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'all') return null;
  throw ApiError.badRequest('active must be "true", "false", or "all"', {
    code: 'validation.invalid_active',
    message: 'active must be "true", "false", or "all"',
    path: 'active',
    value: raw,
  });
}

function parseRole(raw: string): UserRole {
  if (!(USER_ROLES as readonly string[]).includes(raw)) {
    throw ApiError.badRequest(`role must be one of: ${USER_ROLES.join(', ')}`, {
      code: 'validation.invalid_role',
      message: `role must be one of: ${USER_ROLES.join(', ')}`,
      path: 'role',
      value: raw,
    });
  }
  return raw as UserRole;
}

function parseFilters(qs: Record<string, string | undefined>): ParsedFilters {
  const result: ParsedFilters = { limit: DEFAULT_LIMIT };
  if (qs.limit !== undefined) result.limit = parseLimit(qs.limit);
  if (qs.cursor !== undefined) result.cursor = qs.cursor;
  if (qs.active !== undefined) result.active = parseActive(qs.active);
  if (qs.role !== undefined) result.role = parseRole(qs.role);
  return result;
}

function toPublicUserDto(user: ReturnType<typeof toPublicUser>): ListUsersOutput['users'][number] {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    age: user.age,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export const handler = buildHandler<ListUsersInput, ListUsersOutput>({
  name: 'identity-list-users',
  inputSchema: ListUsersInputSchema,
  outputSchema: ListUsersOutputSchema,
  logger: createLogger('identity-list-users'),
  tracer: new Tracer({ serviceName: 'identity-list-users' }),
  requireAuth: true,
  handler: async (_input, event, auth) => {
    if (!auth) {
      throw ApiError.unauthorized('Missing authentication');
    }
    const filters = parseFilters(event.queryStringParameters ?? {});

    const ctx = await buildContext();
    const result = await ctx.userService.listUsers({
      actorUserId: auth.userId,
      filters,
    });

    return {
      users: result.users.map(toPublicUserDto),
      nextCursor: result.nextCursor,
    };
  },
});