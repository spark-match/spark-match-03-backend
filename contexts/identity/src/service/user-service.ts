// =============================================================================
// User service - business rules + RBAC + domain events + audit log
// =============================================================================
// Layered on top of UserRepository. This is the ONLY layer handlers should
// call to read/mutate users. Responsibilities:
//
//   1. RBAC: verify the actor is allowed to act on the target.
//   2. Self-rules: enforce which fields a user can change on their own row.
//   3. Active-state guard: deactivated users cannot authenticate or act.
//   4. Domain events: publish to EventBridge when a state change commits.
//   5. Audit log: write one row to identity.audit_log per action, inside
//      the same transaction as the user mutation (or before the read for
//      getUser/listUsers). See ADR-015.
//   6. Idempotency: no-op operations return success without emitting
//      events or audit rows.
//
// Error model: throws ApiError with the appropriate code/status. Repos
// throw ApiError.dbUnavailable for DB errors; this layer never wraps.
// =============================================================================

import type { Kysely } from 'kysely';
import { ApiError } from '@spark-match/shared/http';
import { makeDomainEvent, type EventPublisher } from '@spark-match/shared/events';
import { hashPassword, verifyPassword } from '@spark-match/shared/auth';
import type { UserRepository, ListUsersFilters, ListUsersResult } from '../infra/user-repository.js';
import type { AuditRepository } from '../infra/audit-repository.js';
import type { AuditEntry } from '../domain/audit.js';
import { withTransaction } from '../infra/transaction.js';
import type { Database } from '../infra/database.js';
import type {
  User,
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

/**
 * Builds the actorUserId/subjectUserId metadata for an audit row.
 * `actorUserId` is null for anonymous actions (register, login).
 */
function actorMeta(
  actorUserId: string | null,
  subjectUserId: string | null,
): Pick<AuditEntry, 'actorUserId' | 'subjectUserId'> {
  return { actorUserId, subjectUserId };
}

/**
 * Filters the user mutation payload to only the fields we audit
 * (fullName, age) and returns the { old, new } snapshot for the audit row.
 * Extracted from updateUser to reduce its cognitive complexity.
 */
function collectChangeDiff(
  target: User,
  next: User,
  changes: UpdateUserInput,
): { old: { fullName?: string; age?: number | null }; new: { fullName?: string; age?: number | null } } {
  const oldValues: { fullName?: string; age?: number | null } = {};
  const newValues: { fullName?: string; age?: number | null } = {};
  if ('fullName' in changes) {
    oldValues.fullName = target.fullName;
    newValues.fullName = next.fullName;
  }
  if ('age' in changes) {
    oldValues.age = target.age;
    newValues.age = next.age;
  }
  return { old: oldValues, new: newValues };
}

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

export interface AuthenticateInput {
  email: string;
  password: string;
  ip: string;
  userAgent: string;
}

export interface UserService {
  register(input: RegisterInput): Promise<User>;
  authenticate(input: AuthenticateInput): Promise<User>;
  getUser(input: ActorTarget): Promise<User>;
  changePassword(input: ActorTarget & { newPassword: string }): Promise<void>;
  updateUser(input: ActorTarget & { changes: UpdateUserInput }): Promise<User>;
  deactivateUser(input: ActorTarget): Promise<User>;
  activateUser(input: ActorTarget): Promise<User>;
  listUsers(input: ListUsersInput): Promise<ListUsersResult>;
}

export function createUserService(deps: {
  db: Kysely<Database>;
  userRepository: UserRepository;
  auditRepository: AuditRepository;
  eventPublisher: EventPublisher;
}): UserService {
  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------



  return {
    async register({ email, password, fullName, age }) {
      const user = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const exists = await userRepo.existsByEmail(email);
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
        const created = await userRepo.create(createInput);

        await auditRepo.insert({
          ...actorMeta(null, created.id),
          action: 'user.registered',
          metadata: { email: created.email, role: created.role },
        });

        return created;
      });

      const event: UserRegisteredEvent = {
        schemaVersion: '1.0',
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserRegistered', event, 1));
      return user;
    },

    async authenticate({ email, password, ip, userAgent }) {
      const user = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const found = await userRepo.findByEmail(email);
        if (!found) {
          throw ApiError.invalidCredentials();
        }
        if (!found.active) {
          // Do NOT audit failed login attempts - prevents user-enumeration
          // via timing of audit_log writes. Only successful logins are
          // audited (per ADR-015).
          throw ApiError.forbidden('Account is deactivated');
        }
        const valid = await verifyPassword(password, found.passwordHash);
        if (!valid) {
          throw ApiError.invalidCredentials();
        }

        await auditRepo.insert({
          ...actorMeta(null, found.id),
          action: 'user.login',
          metadata: { ip, userAgent },
        });

        return found;
      });

      const event: UserLoggedInEvent = {
        schemaVersion: '1.0',
        userId: user.id,
        email: user.email,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserLoggedIn', event, 1));
      return user;
    },

    async getUser({ actorUserId, targetUserId }) {
      return withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }

        const isSelf = actor.id === targetUserId;
        const isAdmin = actor.role === 'admin';
        if (!isSelf && !isAdmin) {
          throw ApiError.forbidden('Insufficient privileges to access this resource');
        }
        const target = await userRepo.findById(targetUserId);
        if (!target) {
          throw ApiError.userNotFound();
        }

        await auditRepo.insert({
          ...actorMeta(actorUserId, target.id),
          action: 'user.profile_viewed',
          metadata: {},
        });

        return target;
      });
    },

    async changePassword({ actorUserId, targetUserId, newPassword }) {
      const result = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }
        const isSelf = actor.id === targetUserId;
        const isAdmin = actor.role === 'admin';
        if (!isSelf && !isAdmin) {
          throw ApiError.forbidden('Insufficient privileges to access this resource');
        }
        const target = await userRepo.findById(targetUserId);
        if (!target) {
          throw ApiError.userNotFound();
        }

        const passwordHash = await hashPassword(newPassword);
        await userRepo.updatePassword(targetUserId, passwordHash);

        await auditRepo.insert({
          ...actorMeta(actorUserId, targetUserId),
          action: 'user.password_changed',
          metadata: {},
        });

        return { actorUserId, targetUserId };
      });

      const event: UserPasswordChangedEvent = {
        schemaVersion: '1.0',
        userId: result.targetUserId,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserPasswordChanged', event, 1));
    },

    async updateUser({ actorUserId, targetUserId, changes }) {
      const { updated, roleChanged } = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }
        const isSelf = actor.id === targetUserId;
        const isAdmin = actor.role === 'admin';

        // Self rules: fullName and age are editable; role/active are NOT.
        if (isSelf) {
          if ('role' in changes) {
            throw ApiError.forbidden('Cannot change own role');
          }
          if ('active' in changes) {
            throw ApiError.forbidden('Cannot change own active state');
          }
        }
        // Non-self requires admin.
        if (!isSelf && !isAdmin) {
          throw ApiError.forbidden('Insufficient privileges to access this resource');
        }

        const target = await userRepo.findById(targetUserId);
        if (!target) {
          throw ApiError.userNotFound();
        }

        const next = await userRepo.update(target.id, changes);
        const diff = collectChangeDiff(target, next, changes);

        await auditRepo.insert({
          ...actorMeta(actorUserId, target.id),
          action: 'user.profile_updated',
          metadata: {
            changedFields: Object.keys(changes),
            old: diff.old,
            new: diff.new,
          },
        });

        const roleChanged = !isSelf && 'role' in changes && target.role !== next.role;
        if (roleChanged) {
          await auditRepo.insert({
            ...actorMeta(actorUserId, target.id),
            action: 'user.role_changed',
            metadata: {
              oldRole: target.role,
              newRole: next.role,
            },
          });
        }

        return { updated: next, roleChanged };
      });

      const updateEvent: UserUpdatedEvent = {
        schemaVersion: '1.0',
        userId: updated.id,
        changes: { ...changes },
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserUpdated', updateEvent, 1));

      if (roleChanged) {
        const roleEvent: UserRoleChangedEvent = {
          schemaVersion: '1.0',
          userId: updated.id,
          fromRole: updated.role,
          toRole: updated.role,
          occurredAt: nowIso(),
        };
        await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserRoleChanged', roleEvent, 1));
      }

      return updated;
    },

    async deactivateUser({ actorUserId, targetUserId }) {
      const result = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }
        if (actor.id === targetUserId) {
          throw ApiError.forbidden('Cannot deactivate own account');
        }
        if (actor.role !== 'admin') {
          throw ApiError.forbidden('Insufficient privileges to access this resource');
        }
        const target = await userRepo.findById(targetUserId);
        if (!target) {
          throw ApiError.userNotFound();
        }

        // Idempotent: no-op if already deactivated.
        if (!target.active) {
          return { updated: target, transitioned: false };
        }

        const updated = await userRepo.setActive(target.id, false);
        await auditRepo.insert({
          ...actorMeta(actorUserId, target.id),
          action: 'user.deactivated',
          metadata: {},
        });
        return { updated, transitioned: true };
      });

      if (result.transitioned) {
        const event: UserDeactivatedEvent = {
          schemaVersion: '1.0',
          userId: result.updated.id,
          occurredAt: nowIso(),
        };
        await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserDeactivated', event, 1));
      }
      return result.updated;
    },

    async activateUser({ actorUserId, targetUserId }) {
      const result = await withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }
        if (actor.role !== 'admin') {
          throw ApiError.forbidden('Insufficient privileges to access this resource');
        }
        const target = await userRepo.findById(targetUserId);
        if (!target) {
          throw ApiError.userNotFound();
        }

        if (target.active) {
          return { updated: target, transitioned: false };
        }

        const updated = await userRepo.setActive(target.id, true);
        await auditRepo.insert({
          ...actorMeta(actorUserId, target.id),
          action: 'user.activated',
          metadata: {},
        });
        return { updated, transitioned: true };
      });

      if (result.transitioned) {
        const event: UserActivatedEvent = {
          schemaVersion: '1.0',
          userId: result.updated.id,
          occurredAt: nowIso(),
        };
        await deps.eventPublisher.publish(makeDomainEvent(SOURCE, 'UserActivated', event, 1));
      }
      return result.updated;
    },

    async listUsers({ actorUserId, filters }) {
      return withTransaction(deps.db, async (tx) => {
        const userRepo = deps.userRepository.withDb(tx);
        const auditRepo = deps.auditRepository.withDb(tx);

        const actor = await userRepo.findById(actorUserId);
        if (!actor) {
          throw ApiError.unauthorized('Authentication required');
        }
        if (!actor.active) {
          throw ApiError.forbidden('Account is deactivated');
        }
        if (actor.role !== 'admin') {
          throw ApiError.forbidden('Admin role required to list users');
        }

        const result = await userRepo.list(filters);

        await auditRepo.insert({
          ...actorMeta(actorUserId, null),
          action: 'user.list_viewed',
          metadata: {
            filterCount: Object.keys(filters).length,
            returnedCount: result.users.length,
          },
        });

        return result;
      });
    },
  };
}

export type { UserRole } from '../domain/user.js';
