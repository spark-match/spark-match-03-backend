import { ApiError } from '@spark-match/shared/http';
import type { EventPublisher } from '@spark-match/shared/events';
import { hashPassword, verifyPassword } from '@spark-match/shared/auth';
import type { UserRepository } from '../infra/user-repository.js';
import type { User } from '../domain/user.js';
import type { UserRegisteredEvent } from '../domain/events.js';

export interface UserService {
  register(input: {
    email: string;
    password: string;
    fullName: string;
    age?: number;
  }): Promise<User>;

  authenticate(email: string, password: string): Promise<User>;
}

export function createUserService(deps: {
  userRepository: UserRepository;
  eventPublisher: EventPublisher;
}): UserService {
  return {
    async register({ email, password, fullName, age }) {
      const exists = await deps.userRepository.existsByEmail(email);
      if (exists) {
        throw ApiError.conflict('Email already registered');
      }
      const passwordHash = hashPassword(password);
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

      await deps.eventPublisher.publish({
        source: 'spark-match.identity',
        detailType: 'UserRegistered',
        detail: event,
      });

      return user;
    },

    async authenticate(email, password) {
      const user = await deps.userRepository.findByEmail(email);
      if (!user) {
        throw ApiError.unauthorized('Invalid credentials');
      }
      const valid = verifyPassword(password, user.passwordHash);
      if (!valid) {
        throw ApiError.unauthorized('Invalid credentials');
      }
      return user;
    },
  };
}
