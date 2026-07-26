import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockUserRepository, mockUserService } = vi.hoisted(() => ({
  mockDb: { name: 'mock-db' },
  mockUserRepository: { name: 'mock-repo' },
  mockUserService: { name: 'mock-service' },
}));

vi.mock('@aws-lambda-powertools/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ name: 'mock-logger' }),
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: class {
    isTracingEnabled() {
      return false;
    }
  },
}));

vi.mock('@spark-match/shared/infra', () => ({
  createSsmReader: vi.fn().mockReturnValue({
    getRequiredString: vi.fn().mockResolvedValue('arn:aws:events:us-east-1:123:rule/bus'),
  }),
  createSecretsReader: vi.fn(),
}));

vi.mock('@spark-match/shared/events', () => ({
  createEventBridgeClient: vi.fn().mockReturnValue({ name: 'mock-publisher' }),
}));

vi.mock('./infra/db-connection.js', () => ({
  getDbConnection: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock('./infra/user-repository.js', () => ({
  createUserRepository: vi.fn().mockReturnValue(mockUserRepository),
}));

vi.mock('./service/user-service.js', () => ({
  createUserService: vi.fn().mockReturnValue(mockUserService),
}));

import { buildContext } from './composition.js';
import { createLogger } from '@aws-lambda-powertools/logger';
import { createSsmReader } from '@spark-match/shared/infra';
import { createEventBridgeClient } from '@spark-match/shared/events';
import { getDbConnection } from './infra/db-connection.js';
import { createUserRepository } from './infra/user-repository.js';
import { createUserService } from './service/user-service.js';

const mockedCreateLogger = vi.mocked(createLogger);
const mockedCreateSsmReader = vi.mocked(createSsmReader);
const mockedCreateEventBridgeClient = vi.mocked(createEventBridgeClient);
const mockedGetDbConnection = vi.mocked(getDbConnection);
const mockedCreateUserRepository = vi.mocked(createUserRepository);
const mockedCreateUserService = vi.mocked(createUserService);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateSsmReader.mockReturnValue({
    getRequiredString: vi.fn().mockResolvedValue('arn:aws:events:us-east-1:123:rule/bus'),
  } as never);
  mockedCreateEventBridgeClient.mockReturnValue({ name: 'mock-publisher' } as never);
  mockedCreateLogger.mockReturnValue({ name: 'mock-logger' } as never);
  mockedGetDbConnection.mockResolvedValue(mockDb as never);
  mockedCreateUserRepository.mockReturnValue(mockUserRepository as never);
  mockedCreateUserService.mockReturnValue(mockUserService as never);
});

describe('buildContext', () => {
  it('composes a context with all required collaborators', async () => {
    const ctx = await buildContext();

    expect(ctx.logger).toEqual({ name: 'mock-logger' });
    expect(ctx.ssm).toBeDefined();
    expect(ctx.eventPublisher).toEqual({ name: 'mock-publisher' });
    expect(ctx.db).toBe(mockDb);
    expect(ctx.userRepository).toBe(mockUserRepository);
    expect(ctx.userService).toBe(mockUserService);
    expect(mockedCreateLogger).toHaveBeenCalledWith('identity');
    expect(mockedCreateSsmReader).toHaveBeenCalledOnce();
  });

  it('passes the SSM-resolved busArn to the event publisher', async () => {
    await buildContext();

    expect(mockedCreateEventBridgeClient).toHaveBeenCalledWith({
      busArn: 'arn:aws:events:us-east-1:123:rule/bus',
    });
  });

  it('wires userService from the userRepository and eventPublisher', async () => {
    await buildContext();

    expect(mockedCreateUserService).toHaveBeenCalledWith({
      userRepository: mockUserRepository,
      eventPublisher: { name: 'mock-publisher' },
    });
  });
});
