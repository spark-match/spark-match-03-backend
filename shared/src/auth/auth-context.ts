// =============================================================================
// AuthContext - typed representation of the authenticated caller
// =============================================================================
// Populated by the Lambda Authorizer (REQUEST type) and attached to the event
// at event.requestContext.authorizer.lambda. The requireAuth middleware reads
// this and produces an AuthContext that handlers receive as a parameter.
// =============================================================================

export interface AuthContext {
  /** Subject (user id) from the JWT `sub` claim. */
  userId: string;
  /** Email from the JWT `email` claim (optional, may be empty). */
  email: string;
  /** Role from the JWT `role` claim (e.g. 'admin'). */
  role: string;
  /** Raw JWT claims for advanced use cases (rarely needed). */
  rawClaims: Record<string, unknown>;
}

/**
 * Shape of the Lambda Authorizer context attached to event.requestContext.authorizer.lambda.
 * The Lambda Authorizer function returns this as its `context` field.
 */
export interface LambdaAuthorizerContext {
  userId?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}
