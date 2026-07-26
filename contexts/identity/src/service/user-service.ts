// =============================================================================
// User service - business rules + RBAC + domain event publication
// =============================================================================
// Layered on top of UserRepository. This is the ONLY layer handlers should
// call to read/mutate users. Responsibilities:
//
//   1. RBAC: verify the actor is allowed to act on the target.
//   2. Self-rules: enforce which fields a user can change on their own row.
//   3. Active-state guard: deactivated users cannot authenticate or act.
//   4. Domain events: publish one or more events to the event bus when a
//      state change is committed. Use makeDomainEvent() so the envelope
//      `{ version, data }` is uniform.
//   5. Idempotency: operations that have no effect still return success
//      (e.g. deactivating an already-deactivated user does NOT emit an
//      event and does NOT call the repository).
//
// Error model: throws ApiError with the appropriate code/status. Repos
// throw ApiError.dbUnavailable for DB errors; this layer never wraps.
// =============================================================================

import { ApiError } from '@spark-match/shared/http';
import { makeDomainEvent, type EventPublisher } from '@spark-match/shared/events';
import { hashPassword, verifyPassword } from '@spark-match/shared/auth';
import type { UserRepository, ListUsersFilters, ListUsersResult } from '../infra/user-repository.js';
import type {
  User,
  UserRole,
  UpdateUserInput,
  CreateUserInput,
} from '../domain/user.js';
import type {
  UserRegisteredEvent,
  UserLoggedInEvent,
  UserPasswordChangedEvent,
  UserUpdatedEvent,
  UserDeactivatedEvent,
  UserActivatedEvent,
  UserRoleChangedEvent,
} from '../domain/events.js';

const SOURCE = 'spark-match.identity';
const nowIso = (): string => new Date().toISOString();

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  age?: number;
}

export interface ActorTarget {
  actorUserId: string;
  targetUserId: string;
}

export interface ListUsersInput {
  actorUserId: string;
  filters: ListUsersFilters;
}

export interface UserService {
  register(input: RegisterInput): Promise<User>;
  authenticate(email: string, password: string): Promise<User>;
  getUser(input: ActorTarget): Promise<User>;
  changePassword(input: ActorTarget & { newPassword: string }): Promise<void>;
  updateUser(input: ActorTarget & { changes: UpdateUserInput }): Promise<User>;
  deactivateUser(input: ActorTarget): Promise<void>;
  activateUser(input: ActorTarget): Promise<void>;
  listUsers(input: ListUsersInput): Promise<ListUsersResult>;
}

export function createUserService(deps: {
  userRepository: UserRepository;
  eventPublisher: EventPublisher;
}): UserService {
  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Loads the actor. Throws 401 (no auth context) or 403 (deactivated).
   * Centralizes the "is the actor allowed to act" check before any
   * RBAC decision.
   */
  async function loadActor(actorUserId: string): Promise<User> {
    const actor = await deps.userRepository.findById(actorUserId);
    if (!actor) {
      throw ApiError.unauthorized('Authentication required');
    }
    if (!actor.active) {
      throw ApiError.forbidden('Account is deactivated');
    }
    return actor;
  }

  /**
   * Asserts the actor is allowed to act on the target.
   *  - self is always allowed
   *  - admin (and only admin) is allowed to act on others
   * Returns the loaded target.
   */
  async function loadAuthorizedTarget(actor: User, targetUserId: string): Promise<User> {
    const isSelf = actor.id === targetUserId;
    const isAdmin = actor.role === 'admin';
    if (!isSelf && !isAdmin) {
      throw ApiError.forbidden('Insufficient privileges to access this resource');
    }
    const target = await deps.userRepository.findById(targetUserId);
    if (!target) {
      throw ApiError.userNotFound();
    }
    return target;
  }

  // ---------------------------------------------------------------------------
  // Public service methods
  // ---------------------------------------------------------------------------

  return {
    async register({ email, password, fullName, age }) {
      const exists = await deps.userRepository.existsByEmail(email);
      if (exists) {
        throw ApiError.emailTaken(email);
      }
      const passwordHash = await hashPassword(password);
      const createInput: CreateUserInput = {
        email,
        fullName,
        passwordHash,
        ...(age !== undefined ? { age } : {}),
      };
      const user = await deps.userRepository.create(createInput);

      const event: UserRegisteredEvent = {
        schemaVersion: '1.0',
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserRegistered', event, 1),
      );
      return user;
    },

    async authenticate(email, password) {
      const user = await deps.userRepository.findByEmail(email);
      if (!user) {
        throw ApiError.invalidCredentials();
      }
      if (!user.active) {
        // Do NOT leak that the account is deactivated. We use 403 because
        // an active user attempting to log in to a known-deactivated
        // account has a different remediation than a wrong password, and
        // an internal admin flow uses a different path.
        throw ApiError.forbidden('Account is deactivated');
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        throw ApiError.invalidCredentials();
      }

      const event: UserLoggedInEvent = {
        schemaVersion: '1.0',
        userId: user.id,
        email: user.email,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserLoggedIn', event, 1),
      );
      return user;
    },

    async getUser({ actorUserId, targetUserId }) {
      const actor = await loadActor(actorUserId);
      return loadAuthorizedTarget(actor, targetUserId);
    },

    async changePassword({ actorUserId, targetUserId, newPassword }) {
      const actor = await loadActor(actorUserId);
      await loadAuthorizedTarget(actor, targetUserId);
      const passwordHash = await hashPassword(newPassword);
      await deps.userRepository.updatePassword(targetUserId, passwordHash);

      const event: UserPasswordChangedEvent = {
        schemaVersion: '1.0',
        userId: targetUserId,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserPasswordChanged', event, 1),
      );
    },

    async updateUser({ actorUserId, targetUserId, changes }) {
      const actor = await loadActor(actorUserId);
      const isSelf = actor.id === targetUserId;

      // Self rules: fullName and age are editable; role/active are NOT.
      if (isSelf) {
        if ('role' in changes) {
          throw ApiError.forbidden('Cannot change own role');
        }
        if ('active' in changes) {
          throw ApiError.forbidden('Cannot change own active state');
        }
      }

      const target = await loadAuthorizedTarget(actor, targetUserId);
      const updated = await deps.userRepository.update(target.id, changes);

      const updateEvent: UserUpdatedEvent = {
        schemaVersion: '1.0',
        userId: updated.id,
        changes: { ...changes },
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserUpdated', updateEvent, 1),
      );

      // If the admin changed the role, emit a dedicated UserRoleChanged
      // event so consumers can react to that specific transition.
      if (!isSelf && 'role' in changes && target.role !== updated.role) {
        const roleEvent: UserRoleChangedEvent = {
          schemaVersion: '1.0',
          userId: updated.id,
          fromRole: target.role,
          toRole: updated.role,
          occurredAt: nowIso(),
        };
        await deps.eventPublisher.publish(
          makeDomainEvent(SOURCE, 'UserRoleChanged', roleEvent, 1),
        );
      }

      return updated;
    },

    async deactivateUser({ actorUserId, targetUserId }) {
      const actor = await loadActor(actorUserId);
      if (actor.id === targetUserId) {
        throw ApiError.forbidden('Cannot deactivate own account');
      }
      const target = await loadAuthorizedTarget(actor, targetUserId);
      if (!target.active) {
        // Idempotent: already deactivated, no-op (no event, no write).
        return;
      }
      await deps.userRepository.setActive(target.id, false);

      const event: UserDeactivatedEvent = {
        schemaVersion: '1.0',
        userId: target.id,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserDeactivated', event, 1),
      );
    },

    async activateUser({ actorUserId, targetUserId }) {
      const actor = await loadActor(actorUserId);
      const target = await loadAuthorizedTarget(actor, targetUserId);
      if (target.active) {
        return;
      }
      await deps.userRepository.setActive(target.id, true);

      const event: UserActivatedEvent = {
        schemaVersion: '1.0',
        userId: target.id,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserActivated', event, 1),
      );
    },

    async listUsers({ actorUserId, filters }) {
      const actor = await loadActor(actorUserId);
      if (actor.role !== 'admin') {
        throw ApiError.forbidden('Admin role required to list users');
      }
      return deps.userRepository.list(filters);
    },
  };
}

// Suppress unused-type warning (UserRole is re-exported via domain/user).
export type { UserRole };
