import { describe, it, expect, vi } from 'vitest';
import { createUserService } from '../src/service/user-service.js';
import { ApiError } from '@spark-match/shared/http';

function makeDeps(overrides?: {
  existsByEmail?: boolean;
  createdUser?: { id: string; email: string; fullName: string };
}) {
  const eventPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
    publishMany: vi.fn().mockResolvedValue(undefined),
  };
  const userRepository = {
    findByEmail: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: overrides?.createdUser?.id ?? 'u-1',
      email: overrides?.createdUser?.email ?? 'test@example.com',
      fullName: overrides?.createdUser?.fullName ?? 'Test User',
      passwordHash: 'hashed',
      age: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    existsByEmail: vi.fn().mockResolvedValue(overrides?.existsByEmail ?? false),
  };
  return { userRepository, eventPublisher };
}

describe('userService.register', () => {
  it('creates user and publishes UserRegistered event', async () => {
    const deps = makeDeps();
    const service = createUserService(deps);

    const user = await service.register({
      email: 'new@example.com',
      password: 'securePass123',
      fullName: 'New User',
    });

    expect(user.email).toBe('test@example.com');
    expect(deps.userRepository.create).toHaveBeenCalledOnce();
    expect(deps.eventPublisher.publish).toHaveBeenCalledOnce();
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'spark-match.identity',
        detailType: 'UserRegistered',
        detail: expect.objectContaining({
          schemaVersion: '1.0',
          userId: 'u-1',
          email: 'test@example.com',
        }),
      }),
    );
  });

  it('throws 409 when email already exists', async () => {
    const deps = makeDeps({ existsByEmail: true });
    const service = createUserService(deps);

    await expect(
      service.register({ email: 'dup@example.com', password: 'securePass123', fullName: 'Dup' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(deps.userRepository.create).not.toHaveBeenCalled();
    expect(deps.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('hashes password before storing', async () => {
    const deps = makeDeps();
    const service = createUserService(deps);

    await service.register({
      email: 'new@example.com',
      password: 'plainPass123',
      fullName: 'New',
    });

    const call = deps.userRepository.create.mock.calls[0]![0];
    expect(call.passwordHash).toMatch(/^scrypt\$/);
    expect(call.passwordHash).not.toBe('plainPass123');
  });
});

describe('userService.authenticate', () => {
  it('returns user when credentials match', async () => {
    const { hashPassword } = await import('@spark-match/shared/auth');
    const passwordHash = hashPassword('correctPass123');
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'test@example.com',
      fullName: 'Test',
      passwordHash,
      age: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = createUserService(deps);

    const user = await service.authenticate('test@example.com', 'correctPass123');
    expect(user.id).toBe('u-1');
  });

  it('throws 401 when user not found', async () => {
    const deps = makeDeps();
    const service = createUserService(deps);

    await expect(service.authenticate('noone@example.com', 'pass1234')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  });

  it('throws 401 when password is wrong', async () => {
    const { hashPassword } = await import('@spark-match/shared/auth');
    const passwordHash = hashPassword('correctPass123');
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'test@example.com',
      fullName: 'Test',
      passwordHash,
      age: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = createUserService(deps);

    await expect(service.authenticate('test@example.com', 'wrongPass123')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  });
});
