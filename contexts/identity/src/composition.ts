import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { createEventBridgeClient, type EventPublisher } from '@spark-match/shared/events';
import { createSsmReader, type SsmReader } from '@spark-match/shared/infra';
import type { Kysely } from 'kysely';
import { getDbConnection } from './infra/db-connection.js';
import { createUserRepository, type UserRepository, type Database } from './infra/user-repository.js';
import { createUserService, type UserService } from './service/user-service.js';

export interface IdentityContext {
  logger: ReturnType<typeof createLogger>;
  tracer: Tracer;
  ssm: SsmReader;
  eventPublisher: EventPublisher;
  db: Kysely<Database>;
  userRepository: UserRepository;
  userService: UserService;
}

let context: IdentityContext | null = null;
let pendingPromise: Promise<IdentityContext> | null = null;

export async function buildContext(): Promise<IdentityContext> {
  if (context) return context;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    const logger = createLogger('identity');
    const tracer = new Tracer({ serviceName: 'identity' });
    const ssm = createSsmReader();
    const busArn = await ssm.getRequiredString('/spark-match/eventbridge/bus-arn');
    const eventPublisher = createEventBridgeClient({ busArn });
    const db = await getDbConnection();
    const userRepository = createUserRepository(db);
    const userService = createUserService({ userRepository, eventPublisher });

    const built: IdentityContext = {
      logger,
      tracer,
      ssm,
      eventPublisher,
      db,
      userRepository,
      userService,
    };
    context = built;
    return built;
  })();

  return pendingPromise;
}
