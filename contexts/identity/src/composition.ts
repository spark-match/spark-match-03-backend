// =============================================================================
// Identity composition root
// =============================================================================
// Builds the lazy singleton context (logger, tracer, AWS clients,
// repository, service, JWT signer) shared by every handler in the
// identity context. Includes `signForUser` as a convenience method so
// handlers do not have to know the secret ARN or the signer details.
// =============================================================================

import { Tracer } from '@aws-lambda-powertools/tracer';
import { createLogger } from '@spark-match/shared/logger';
import { createEventBridgeClient, type EventPublisher } from '@spark-match/shared/events';
import {
  createSsmReader,
  withAwsErrorMapping,
  type SsmReader,
} from '@spark-match/shared/infra';
import type { Kysely } from 'kysely';
import { getDbConnection } from './infra/db-connection.js';
import {
  createUserRepository,
  type UserRepository,
  type Database,
} from './infra/user-repository.js';
import { createUserService, type UserService } from './service/user-service.js';
import { createJwtSigner, type JwtSigner } from './infra/jwt-signer.js';

const SSM_BUS_ARN_KEY = '/spark-match/eventbridge/bus-arn';
const SSM_JWT_SECRET_ARN_KEY = '/spark-match/secret/jwt-arn';
const DEFAULT_JWT_EXPIRES_SECONDS = 86400;

export interface IdentityContext {
  logger: ReturnType<typeof createLogger>;
  tracer: Tracer;
  ssm: SsmReader;
  eventPublisher: EventPublisher;
  db: Kysely<Database>;
  userRepository: UserRepository;
  userService: UserService;
  jwtSigner: JwtSigner;
  defaultTokenExpiresSeconds: number;
  signForUser(user: { id: string; email: string; role: string }): Promise<string>;
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

    const busArn = await withAwsErrorMapping('SSM', () =>
      ssm.getRequiredString(SSM_BUS_ARN_KEY),
    );
    const eventPublisher = createEventBridgeClient({ busArn });

    const jwtSecretArn = await withAwsErrorMapping('SSM', () =>
      ssm.getRequiredString(SSM_JWT_SECRET_ARN_KEY),
    );
    const jwtSigner = createJwtSigner({ secretArn: jwtSecretArn });

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
      jwtSigner,
      defaultTokenExpiresSeconds: DEFAULT_JWT_EXPIRES_SECONDS,
      async signForUser(user) {
        return jwtSigner.sign({
          subject: user.id,
          email: user.email,
          role: user.role,
          expiresInSeconds: DEFAULT_JWT_EXPIRES_SECONDS,
        });
      },
    };
    context = built;
    return built;
  })();
  return pendingPromise;
}
