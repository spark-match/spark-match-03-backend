// =============================================================================
// audit-service - unit tests
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { createAuditService } from './audit-service.js';
import type { AuditRepository } from '../infra/audit-repository.js';

function makeAuditRepo() {
  return {
    withDb: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ entries: [], nextCursor: null }),
  } as unknown as AuditRepository;
}

describe('audit-service.listAuditEntries', () => {
  it('rejects non-admin actors with 403 + audit.admin_only', async () => {
    const repo = makeAuditRepo();
    const service = createAuditService({ auditRepository: repo });
    await expect(
      service.listAuditEntries(
        // Was `'member' as never`: the cast existed only because `UserRole`
        // had a single value, so no real non-admin role could be written here.
        // The test looked like it proved a non-admin is rejected while in
        // production no such actor could exist. With `student` it is real.
        { userId: 'u-1', email: 'a@b.com', role: 'student' },
        {},
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'forbidden',
      details: [{ code: 'audit.admin_only', path: 'role', value: 'student' }],
    });
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('returns the repo result for an admin actor (happy path)', async () => {
    const repo = makeAuditRepo();
    const fakeAudit = {
      id: '1',
      occurredAt: new Date('2026-07-30T16:00:00Z'),
      action: 'user.login' as const,
      actorUserId: null,
      subjectUserId: 'u-1',
      metadata: { ip: '1.2.3.4', userAgent: 'curl' },
    };
    vi.mocked(repo.list).mockResolvedValueOnce({
      entries: [fakeAudit],
      nextCursor: 'opaque-cursor',
    });
    const service = createAuditService({ auditRepository: repo });

    const result = await service.listAuditEntries(
      { userId: 'admin-1', email: 'admin@b.com', role: 'admin' },
      { limit: 10 },
    );
    expect(result.entries).toEqual([fakeAudit]);
    expect(result.nextCursor).toBe('opaque-cursor');
  });

  it('emits a user.list_viewed audit entry after returning results', async () => {
    const repo = makeAuditRepo();
    const service = createAuditService({ auditRepository: repo });
    await service.listAuditEntries(
      { userId: 'admin-1', email: 'admin@b.com', role: 'admin' },
      { actorUserId: 'u-1', action: 'user.login' },
    );
    expect(repo.insert).toHaveBeenCalledOnce();
    const insertArg = vi.mocked(repo.insert).mock.calls[0][0];
    expect(insertArg.action).toBe('user.list_viewed');
    expect(insertArg.actorUserId).toBe('admin-1');
    expect(insertArg.subjectUserId).toBeNull();
    expect(insertArg.metadata).toMatchObject({
      filterCount: 2, // actorUserId + action (limit + cursor are excluded)
      returnedCount: 0,
    });
  });

  it('metadata.filterCount excludes limit/cursor from the count', async () => {
    const repo = makeAuditRepo();
    const service = createAuditService({ auditRepository: repo });
    await service.listAuditEntries(
      { userId: 'admin-1', email: 'admin@b.com', role: 'admin' },
      { limit: 25, cursor: 'opaque', actorUserId: 'u-1' },
    );
    const insertArg = vi.mocked(repo.insert).mock.calls[0][0];
    // Only actorUserId should count; limit + cursor are excluded.
    expect((insertArg.metadata as { filterCount: number }).filterCount).toBe(1);
  });

  it('still emits list_viewed even when the repo returns zero entries', async () => {
    const repo = makeAuditRepo();
    const service = createAuditService({ auditRepository: repo });
    await service.listAuditEntries(
      { userId: 'admin-1', email: 'admin@b.com', role: 'admin' },
      {},
    );
    expect(repo.insert).toHaveBeenCalledOnce();
    const insertArg = vi.mocked(repo.insert).mock.calls[0][0];
    expect((insertArg.metadata as { returnedCount: number }).returnedCount).toBe(0);
  });
});
