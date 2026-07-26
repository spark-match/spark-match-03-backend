import { ApiError } from '@spark-match/shared/http';
import { makeDomainEvent, type EventPublisher } from '@spark-match/shared/events';
import { hashPassword, verifyPassword } from '@spark-match/shared/auth';
import type { UserRepository, ListUsersFilters, ListUsersResult } from '../infra/user-repository.js';
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
  register(input: {
    email: string;
    password: string;
    fullName: string;
    age?: number;
  }): Promise<User>;

  authenticate(email: string, password: string): Promise<User>;
  getUser(input: ActorTarget): Promise<User>;
  changePassword(input: ActorTarget & { newPassword: string }): Promise<void>;
  updateUser(input: ActorTarget & { changes: UpdateUserInput }): Promise<User>;
  deactivateUser(input: ActorTarget): Promise<User>;
  activateUser(input: ActorTarget): Promise<User>;
  listUsers(input: ListUsersInput): Promise<ListUsersResult>;
}

export function createUserService(deps: {
  userRepository: UserRepository;
  eventPublisher: EventPublisher;
}): UserService {
  return {
    async register({ email, password, fullName, age }) {
      const exists = await deps.userRepository.existsByEmail(email);
      if (exists) {
        throw ApiError.emailTaken(email);
      }
      const passwordHash = await hashPassword(password);
      const user = await deps.userRepository.create({
        email,
        fullName,
        passwordHash,
        ...(age !== undefined ? { age } : {}),
      });

      const event: UserRegisteredEvent = {
        schemaVersion: '1.0',
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        occurredAt: new Date().toISOString(),
      };

      await deps.eventPublisher.publish(
        makeDomainEvent('spark-match.identity', 'UserRegistered', event, 1),
      );

      return user;
    },

    async authenticate(email, password) {
      const user = await deps.userRepository.findByEmail(email);
      if (!user) {
        throw ApiError.invalidCredentials();
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        throw ApiError.invalidCredentials();
      }
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
        return target;
      }
      const updated = await deps.userRepository.setActive(target.id, false);

      const event: UserDeactivatedEvent = {
        schemaVersion: '1.0',
        userId: target.id,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserDeactivated', event, 1),
      );
      return updated;
    },

    async activateUser({ actorUserId, targetUserId }) {
      const actor = await loadActor(actorUserId);
      const target = await loadAuthorizedTarget(actor, targetUserId);
      if (target.active) {
        return target;
      }
      const updated = await deps.userRepository.setActive(target.id, true);

      const event: UserActivatedEvent = {
        schemaVersion: '1.0',
        userId: target.id,
        occurredAt: nowIso(),
      };
      await deps.eventPublisher.publish(
        makeDomainEvent(SOURCE, 'UserActivated', event, 1),
      );
      return updated;
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

export type { UserRole } from '../domain/user.js';
