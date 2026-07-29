// =============================================================================
// userService - unit tests
// =============================================================================
// Covers the service layer's RBAC + self-rules + idempotency + event
// publication. The repository and EventPublisher are replaced with vi.fn
// mocks; no DB or AWS calls are made.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword } from '@spark-match/shared/auth';
import { createUserService } from '../src/service/user-service.js';
import type { User, UserRole } from '../src/domain/user.js';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const SELF_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ID = '33333333-3333-3333-3333-333333333333';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: SELF_ID,
    email: 'self@example.com',
    fullName: 'Self User',
    passwordHash: 'hashed',
    age: null,
    role: 'admin',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  const eventPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
    publishMany: vi.fn().mockResolvedValue(undefined),
  };
  const userRepository = {
    findByEmail: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeUser()),
    existsByEmail: vi.fn().mockResolvedValue(false),
    updatePassword: vi.fn().mockImplementation((id: string) => Promise.resolve(makeUser({ id }))),
    update: vi.fn().mockImplementation((id: string) => Promise.resolve(makeUser({ id }))),
    setActive: vi.fn().mockImplementation((id: string, active: boolean) =>
      Promise.resolve(makeUser({ id, active })),
    ),
    setRole: vi.fn().mockImplementation((id: string, role: UserRole) =>
      Promise.resolve(makeUser({ id, role })),
    ),
    list: vi.fn().mockResolvedValue({ users: [], nextCursor: null }),
    count: vi.fn().mockResolvedValue(0),
  };
  return { eventPublisher, userRepository };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// register
// =============================================================================

describe('userService.register', () => {
  it('creates user and publishes UserRegistered event', async () => {
    const deps = makeDeps();
    const service = createUserService(deps);

    await service.register({
      email: 'new@example.com',
      password: 'securePass123',
      fullName: 'New User',
    });

    expect(deps.userRepository.create).toHaveBeenCalledOnce();
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'spark-match.identity',
        detailType: 'UserRegistered',
        detail: expect.objectContaining({
          version: 1,
          data: expect.objectContaining({
            schemaVersion: '1.0',
            userId: SELF_ID,
            email: 'self@example.com',
            fullName: 'Self User',
          }),
        }),
      }),
    );
  });

  it('throws 409 (email_taken) when email already exists', async () => {
    const deps = makeDeps();
    deps.userRepository.existsByEmail.mockResolvedValue(true);
    const service = createUserService(deps);

    await expect(
      service.register({ email: 'dup@example.com', password: 'securePass123', fullName: 'Dup' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'conflict',
      details: [expect.objectContaining({ code: 'user.email_taken' })],
    });
    expect(deps.userRepository.create).not.toHaveBeenCalled();
    expect(deps.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('hashes the password before storing (no plaintext leakage)', async () => {
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

// =============================================================================
// authenticate
// =============================================================================

describe('userService.authenticate', () => {
  it('returns user when credentials match (and user is active)', async () => {
    const passwordHash = await hashPassword('correctPass123');
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue(
      makeUser({ email: 'self@example.com', passwordHash, active: true }),
    );
    const service = createUserService(deps);

    const user = await service.authenticate('self@example.com', 'correctPass123');
    expect(user.id).toBe(SELF_ID);
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserLoggedIn' }),
    );
  });

  it('throws 403 when the account is deactivated', async () => {
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue(
      makeUser({ active: false }),
    );
    const service = createUserService(deps);

    await expect(
      service.authenticate('self@example.com', 'pass1234'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'forbidden',
    });
  });

  it('throws 401 with generic message when user is not found', async () => {
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue(null);
    const service = createUserService(deps);

    await expect(
      service.authenticate('noone@example.com', 'pass1234'),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
      message: 'Invalid credentials',
    });
  });

  it('throws 401 with generic message on wrong password', async () => {
    const passwordHash = await hashPassword('correctPass123');
    const deps = makeDeps();
    deps.userRepository.findByEmail.mockResolvedValue(
      makeUser({ passwordHash, active: true }),
    );
    const service = createUserService(deps);

    await expect(
      service.authenticate('self@example.com', 'wrongPass123'),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
      message: 'Invalid credentials',
    });
  });
});

// =============================================================================
// changePassword
// =============================================================================

describe('userService.changePassword', () => {
  it('allows self to change own password', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      id === SELF_ID ? makeUser({ id: SELF_ID, active: true }) : null,
    );
    const service = createUserService(deps);

    await service.changePassword({
      actorUserId: SELF_ID,
      targetUserId: SELF_ID,
      newPassword: 'newSecurePass456',
    });
    expect(deps.userRepository.updatePassword).toHaveBeenCalledWith(
      SELF_ID,
      expect.stringMatching(/^scrypt\$/),
    );
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserPasswordChanged' }),
    );
  });

  it('allows admin to change another user password', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    const service = createUserService(deps);

    await service.changePassword({
      actorUserId: ADMIN_ID,
      targetUserId: OTHER_ID,
      newPassword: 'newSecurePass456',
    });
    expect(deps.userRepository.updatePassword).toHaveBeenCalledWith(OTHER_ID, expect.any(String));
  });

  it('forbids a deactivated actor from changing any password', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === SELF_ID ? false : true }),
    );
    const service = createUserService(deps);

    await expect(
      service.changePassword({
        actorUserId: SELF_ID,
        targetUserId: OTHER_ID,
        newPassword: 'newSecurePass456',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
    expect(deps.userRepository.updatePassword).not.toHaveBeenCalled();
  });
});

// =============================================================================
// getUser
// =============================================================================

describe('userService.getUser', () => {
  it('allows self to read self', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, active: true }),
    );
    const service = createUserService(deps);

    const user = await service.getUser({ actorUserId: SELF_ID, targetUserId: SELF_ID });
    expect(user.id).toBe(SELF_ID);
  });

  it('allows admin to read another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    const service = createUserService(deps);

    const user = await service.getUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID });
    expect(user.id).toBe(OTHER_ID);
  });

  it('forbids a deactivated actor from reading another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === SELF_ID ? false : true }),
    );
    const service = createUserService(deps);

    await expect(
      service.getUser({ actorUserId: SELF_ID, targetUserId: OTHER_ID }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
  });

  it('throws 404 when the target does not exist', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      id === OTHER_ID ? null : makeUser({ id, role: 'admin', active: true }),
    );
    const service = createUserService(deps);

    await expect(
      service.getUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
  });
});

// =============================================================================
// updateUser - self rules
// =============================================================================

describe('userService.updateUser - self rules', () => {
  it('allows self to update fullName and age', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, active: true }),
    );
    const service = createUserService(deps);

    await service.updateUser({
      actorUserId: SELF_ID,
      targetUserId: SELF_ID,
      changes: { fullName: 'New Name', age: 30 },
    });
    expect(deps.userRepository.update).toHaveBeenCalledWith(SELF_ID, {
      fullName: 'New Name',
      age: 30,
    });
  });

  it('forbids self to update own role', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, active: true }),
    );
    const service = createUserService(deps);

    await expect(
      service.updateUser({
        actorUserId: SELF_ID,
        targetUserId: SELF_ID,
        changes: { role: 'admin' as UserRole },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(deps.userRepository.update).not.toHaveBeenCalled();
  });

  it('forbids self to update own active flag', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, active: true }),
    );
    const service = createUserService(deps);

    await expect(
      service.updateUser({
        actorUserId: SELF_ID,
        targetUserId: SELF_ID,
        changes: { active: false } as unknown as { fullName: string },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// updateUser - admin rules
// =============================================================================

describe('userService.updateUser - admin rules', () => {
  it('admin updates another user role payload even when role literal matches', async () => {
    // NOTE: with the current USER_ROLES = ['admin'] (single-valued), the
    // service gate `target.role !== updated.role` will never fire on a real
    // role change. This test only proves the admin path forwards a role
    // change to the repository and emits UserUpdated. A future test that
    // exercises a true role transition (e.g. reviewer -> admin) will be
    // added when USER_ROLES gains more than one member.
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    deps.userRepository.update.mockResolvedValue(makeUser({ id: OTHER_ID, role: 'admin' }));
    const service = createUserService(deps);

    await service.updateUser({
      actorUserId: ADMIN_ID,
      targetUserId: OTHER_ID,
      changes: { role: 'admin' as UserRole },
    });
    expect(deps.userRepository.update).toHaveBeenCalledWith(OTHER_ID, {
      role: 'admin' as UserRole,
    });
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserUpdated' }),
    );
  });

  it('does NOT emit UserRoleChanged when role did not change', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    deps.userRepository.update.mockResolvedValue(makeUser({ id: OTHER_ID, role: 'admin' }));
    const service = createUserService(deps);

    await service.updateUser({
      actorUserId: ADMIN_ID,
      targetUserId: OTHER_ID,
      changes: { fullName: 'New Name' },
    });
    expect(deps.eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserUpdated' }),
    );
  });

  it('forbids a deactivated actor from updating another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === SELF_ID ? false : true }),
    );
    const service = createUserService(deps);

    await expect(
      service.updateUser({
        actorUserId: SELF_ID,
        targetUserId: OTHER_ID,
        changes: { fullName: 'New Name' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// deactivateUser
// =============================================================================

describe('userService.deactivateUser', () => {
  it('allows admin to deactivate another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    const service = createUserService(deps);

    await service.deactivateUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID });
    expect(deps.userRepository.setActive).toHaveBeenCalledWith(OTHER_ID, false);
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserDeactivated' }),
    );
  });

  it('forbids self-deactivation', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockResolvedValue(
      makeUser({ id: SELF_ID, active: true }),
    );
    const service = createUserService(deps);

    await expect(
      service.deactivateUser({ actorUserId: SELF_ID, targetUserId: SELF_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(deps.userRepository.setActive).not.toHaveBeenCalled();
  });

  it('is idempotent (already deactivated: no write, no event)', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === OTHER_ID ? false : true }),
    );
    const service = createUserService(deps);

    await service.deactivateUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID });
    expect(deps.userRepository.setActive).not.toHaveBeenCalled();
    expect(deps.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('forbids a deactivated actor from deactivating another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === SELF_ID ? false : true }),
    );
    const service = createUserService(deps);

    await expect(
      service.deactivateUser({ actorUserId: SELF_ID, targetUserId: OTHER_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// activateUser
// =============================================================================

describe('userService.activateUser', () => {
  it('allows admin to activate a deactivated user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) => {
      if (id === ADMIN_ID) return makeUser({ id: ADMIN_ID, role: 'admin', active: true });
      if (id === OTHER_ID) return makeUser({ id: OTHER_ID, role: 'admin', active: false });
      return null;
    });
    const service = createUserService(deps);

    await service.activateUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID });
    expect(deps.userRepository.setActive).toHaveBeenCalledWith(OTHER_ID, true);
    expect(deps.eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ detailType: 'UserActivated' }),
    );
  });

  it('is idempotent (already active: no write, no event)', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: true }),
    );
    const service = createUserService(deps);

    await service.activateUser({ actorUserId: ADMIN_ID, targetUserId: OTHER_ID });
    expect(deps.userRepository.setActive).not.toHaveBeenCalled();
    expect(deps.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('forbids a deactivated actor from activating another user', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockImplementation(async (id) =>
      makeUser({ id, role: 'admin', active: id === SELF_ID ? false : true }),
    );
    const service = createUserService(deps);

    await expect(
      service.activateUser({ actorUserId: SELF_ID, targetUserId: OTHER_ID }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// listUsers
// =============================================================================

describe('userService.listUsers', () => {
  it('allows admin to list users', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockResolvedValue(
      makeUser({ id: ADMIN_ID, role: 'admin', active: true }),
    );
    deps.userRepository.list.mockResolvedValue({
      users: [makeUser({ id: SELF_ID })],
      nextCursor: null,
    });
    const service = createUserService(deps);

    const result = await service.listUsers({
      actorUserId: ADMIN_ID,
      filters: { limit: 10 },
    });
    expect(result.users).toHaveLength(1);
  });

  it('forbids a deactivated actor from listing', async () => {
    const deps = makeDeps();
    deps.userRepository.findById.mockResolvedValue(
      makeUser({ id: SELF_ID, role: 'admin', active: false }),
    );
    const service = createUserService(deps);

    await expect(
      service.listUsers({ actorUserId: SELF_ID, filters: { limit: 10 } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(deps.userRepository.list).not.toHaveBeenCalled();
  });
});
