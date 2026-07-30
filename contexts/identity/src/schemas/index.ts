// =============================================================================
// Re-exports for the Identity context Zod schemas.
// =============================================================================
// Consumers (handlers, OpenAPI generator, tests) should import from here to
// avoid `from '../schemas/<file>.js'` duplication.
// =============================================================================

export {
  RegisterInputSchema,
  RegisterOutputSchema,
  type RegisterInput,
  type RegisterOutput,
} from './register.schema.js';

export {
  LoginInputSchema,
  LoginOutputSchema,
  type LoginInput,
  type LoginOutput,
} from './login.schema.js';

export {
  ChangePasswordInputSchema,
  ChangePasswordOutputSchema,
  type ChangePasswordInput,
  type ChangePasswordOutput,
} from './change-password.schema.js';

export {
  UpdateProfileInputSchema,
  UpdateProfileOutputSchema,
  type UpdateProfileInput,
  type UpdateProfileOutput,
} from './update-profile.schema.js';

export {
  ListUsersInputSchema,
  ListUsersOutputSchema,
  type ListUsersInput,
  type ListUsersOutput,
} from './list-users.schema.js';

export { GetMeOutputSchema, type GetMeOutput, type PublicUser } from './get-me.schema.js';

export {
  UpdateUserInputSchema,
  UpdateUserOutputSchema,
  type UpdateUserInput,
  type UpdateUserOutput,
} from './update-user.schema.js';

export { ActivateUserOutputSchema, type ActivateUserOutput } from './activate-user.schema.js';
export { DeactivateUserOutputSchema, type DeactivateUserOutput } from './deactivate-user.schema.js';

export {
  AuditEntrySchema,
  AuditListInputSchema,
  AuditListOutputSchema,
  type AuditEntry,
  type AuditListInput,
  type AuditListOutput,
} from './audit.schema.js';
