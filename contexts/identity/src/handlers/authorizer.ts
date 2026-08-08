// =============================================================================
// Identity Authorizer Lambda - HttpApi v2 Lambda Authorizer (REQUEST type).
// =============================================================================
// Wired to every protected route in template.yaml. API Gateway invokes this
// function BEFORE invoking the protected handler; if we return
// { isAuthorized: false }, the request is rejected with 401 and never
// reaches the handler.
//
// We use the **Simple Response** format (HTTP API v2 payload format 2.0),
// which avoids the need for IAM permissions on the Authorizer Lambda to
// invoke downstream Lambdas. The Authorizer only needs:
//   - SecretsManagerRead on the JWT secret ARN
//   - SSM:Get on /spark-match/{environment}/config/jwt-secret-arn
//     (contrato ADR-0002; el path lo arma ssmConfigPath desde ENVIRONMENT)
//
// Output shape (Simple Response):
//   {
//     isAuthorized: true,
//     context: { userId, email, role }   // attached to event.requestContext.authorizer.lambda
//   }
// or
//   { isAuthorized: false }
//
// The protected handlers' requireAuth middleware trusts this context
// (event.requestContext.authorizer.lambda) over the Bearer header. The
// Bearer fallback in requireAuth remains active for defense in depth and
// local-dev / direct-invoke paths.
// =============================================================================

import { loadJwtSecret, verifyJwt, type AuthContext } from '@spark-match/shared/auth';
import { createLogger } from '@spark-match/shared/logger';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const logger = createLogger('identity-authorizer');

interface SimpleAuthorizerResponse {
  isAuthorized: boolean;
  context?: Pick<AuthContext, 'userId' | 'email' | 'role'>;
}

function deny(): SimpleAuthorizerResponse {
  return { isAuthorized: false };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<SimpleAuthorizerResponse> => {
  const headers = event.headers ?? {};
  const authHeader =
    headers.authorization ?? headers.Authorization ?? headers.AUTHORIZATION;

  const path = event.requestContext?.http?.path ?? event.rawPath;

  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn('Authorizer: missing or non-Bearer Authorization header', {
      path,
    });
    return deny();
  }

  const token = authHeader.slice(7);
  try {
    const secret = await loadJwtSecret();
    const claims = await verifyJwt(token, secret);
    if (typeof claims.sub !== 'string') {
      logger.warn('Authorizer: JWT missing subject claim', {
        path,
      });
      return deny();
    }
    return {
      isAuthorized: true,
      context: {
        userId: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : '',
        role: typeof claims.role === 'string' ? claims.role : '',
      },
    };
  } catch (err) {
    logger.warn('Authorizer: JWT verify failed', {
      path,
      error: String(err),
    });
    return deny();
  }
};