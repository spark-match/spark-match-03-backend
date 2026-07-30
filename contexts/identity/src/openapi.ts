// =============================================================================
// Identity context — OpenAPI operations registry
// =============================================================================
// Declarative list of every HTTP operation exposed by this context.
// Consumed by `scripts/generate-openapi.ts` to produce `docs/openapi.json`.
//
// Each entry describes:
//   - HTTP method + path
//   - Operation ID + summary + description
//   - Request body schema (or query/path params where relevant)
//   - Response schema(s) per status code
//   - Auth requirements
//
// Schemas are imported from `schemas/*` — the same Zod schemas used at
// runtime for input validation. There is no parallel definition; the
// generator derives JSON Schemas via Zod 4's built-in `z.toJSONSchema()`.
//
// Static-only: there is no dynamic registration. Adding a new route
// requires adding an entry here AND wiring the Lambda in `template.yaml`.
// =============================================================================

import { z } from 'zod';
import {
  RegisterInputSchema,
  RegisterOutputSchema,
  LoginInputSchema,
  LoginOutputSchema,
  GetMeOutputSchema,
  UpdateProfileInputSchema,
  UpdateProfileOutputSchema,
  UpdateUserInputSchema,
  UpdateUserOutputSchema,
  ChangePasswordInputSchema,
  ChangePasswordOutputSchema,
  ListUsersOutputSchema,
  ActivateUserOutputSchema,
  DeactivateUserOutputSchema,
} from './schemas/index.js';
import { PublicUserSchema } from './schemas/get-me.schema.js';

export interface OperationParameter {
  name: string;
  in: 'query' | 'path';
  schema: z.ZodType;
  required?: boolean;
  description?: string;
}

export interface OperationResponse {
  statusCode: number;
  description: string;
  schema: z.ZodType;
}

export interface Operation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  security: 'none' | 'bearer' | 'admin';
  parameters?: OperationParameter[];
  requestBody?: z.ZodType;
  responses: OperationResponse[];
}

export const IDENTITY_OPERATIONS: Operation[] = [
  {
    method: 'POST',
    path: '/v1/auth/register',
    operationId: 'registerUser',
    summary: 'Create a new user account',
    tags: ['Auth'],
    security: 'none',
    requestBody: RegisterInputSchema,
    responses: [
      { statusCode: 200, description: 'User created', schema: RegisterOutputSchema },
      { statusCode: 400, description: 'Validation error', schema: z.object({}).passthrough() },
      { statusCode: 409, description: 'Email already taken', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'POST',
    path: '/v1/auth/login',
    operationId: 'loginUser',
    summary: 'Authenticate and obtain JWT',
    tags: ['Auth'],
    security: 'none',
    requestBody: LoginInputSchema,
    responses: [
      { statusCode: 200, description: 'Authenticated', schema: LoginOutputSchema },
      { statusCode: 401, description: 'Invalid credentials', schema: z.object({}).passthrough() },
      { statusCode: 403, description: 'Account deactivated', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'GET',
    path: '/v1/users/me',
    operationId: 'getCurrentUser',
    summary: 'Get the authenticated user profile',
    tags: ['Self'],
    security: 'bearer',
    responses: [
      { statusCode: 200, description: 'Current user profile', schema: GetMeOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'PATCH',
    path: '/v1/users/me',
    operationId: 'updateOwnProfile',
    summary: 'Update own profile (fullName, age). Cannot change role/active.',
    tags: ['Self'],
    security: 'bearer',
    requestBody: UpdateProfileInputSchema,
    responses: [
      { statusCode: 200, description: 'Updated profile', schema: UpdateProfileOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'PUT',
    path: '/v1/users/me/password',
    operationId: 'changeOwnPassword',
    summary: 'Change own password',
    tags: ['Self'],
    security: 'bearer',
    requestBody: ChangePasswordInputSchema,
    responses: [
      { statusCode: 200, description: 'Password updated', schema: ChangePasswordOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'GET',
    path: '/v1/users',
    operationId: 'listUsers',
    summary: 'List users (admin only). Returns paginated users + nextCursor.',
    tags: ['Admin'],
    security: 'admin',
    parameters: [
      {
        name: 'limit',
        in: 'query',
        schema: z.coerce.number().int().min(1).max(100),
        description: 'Page size (default 20, max 100)',
      },
      {
        name: 'cursor',
        in: 'query',
        schema: z.string(),
        description: 'Opaque pagination cursor',
      },
      {
        name: 'active',
        in: 'query',
        schema: z.enum(['true', 'false', 'all']),
        description: 'Filter by active state',
      },
      {
        name: 'role',
        in: 'query',
        schema: z.enum(['admin']),
        description: 'Filter by role',
      },
    ],
    responses: [
      { statusCode: 200, description: 'User list', schema: ListUsersOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
      { statusCode: 403, description: 'Not admin', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'PATCH',
    path: '/v1/users/{userId}',
    operationId: 'adminUpdateUser',
    summary: 'Admin update any user (including role/active).',
    tags: ['Admin'],
    security: 'admin',
    parameters: [
      {
        name: 'userId',
        in: 'path',
        schema: z.uuid(),
        required: true,
        description: 'Target user ID',
      },
    ],
    requestBody: UpdateUserInputSchema,
    responses: [
      { statusCode: 200, description: 'Updated user', schema: UpdateUserOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
      { statusCode: 403, description: 'Not admin', schema: z.object({}).passthrough() },
      { statusCode: 404, description: 'User not found', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'POST',
    path: '/v1/users/{userId}/activate',
    operationId: 'activateUser',
    summary: 'Admin activate a deactivated user.',
    tags: ['Admin'],
    security: 'admin',
    parameters: [
      {
        name: 'userId',
        in: 'path',
        schema: z.uuid(),
        required: true,
      },
    ],
    responses: [
      { statusCode: 200, description: 'Activated user', schema: ActivateUserOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
      { statusCode: 403, description: 'Not admin', schema: z.object({}).passthrough() },
      { statusCode: 404, description: 'User not found', schema: z.object({}).passthrough() },
    ],
  },
  {
    method: 'POST',
    path: '/v1/users/{userId}/deactivate',
    operationId: 'deactivateUser',
    summary: 'Admin deactivate a user. Self-deactivation forbidden.',
    tags: ['Admin'],
    security: 'admin',
    parameters: [
      {
        name: 'userId',
        in: 'path',
        schema: z.uuid(),
        required: true,
      },
    ],
    responses: [
      { statusCode: 200, description: 'Deactivated user', schema: DeactivateUserOutputSchema },
      { statusCode: 401, description: 'Missing/invalid auth', schema: z.object({}).passthrough() },
      { statusCode: 403, description: 'Self-deactivation or not admin', schema: z.object({}).passthrough() },
      { statusCode: 404, description: 'User not found', schema: z.object({}).passthrough() },
    ],
  },
];

/**
 * Reusable PublicUser schema exposed for OpenAPI consumers that want to
 * reference the same shape across endpoints.
 */
export const PUBLIC_USER_SCHEMA = PublicUserSchema;
