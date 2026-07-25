// =============================================================================
// Zod schema validator
// =============================================================================
// Wraps safeParse and converts errors to ApiError via ApiError.fromZodError,
// producing one ErrorDetail per Zod issue. Used by build-handler.ts to
// validate request bodies and by consumer Lambdas to validate incoming
// event payloads.
// =============================================================================

import { z, type ZodSchema } from 'zod';
import { ApiError } from '../http/api-error.js';

export function validatePayload<T>(schema: ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw ApiError.fromZodError(result.error);
  }
  return result.data;
}

/**
 * Standard EventBridge envelope (compliant with the AWS EventBridge schema
 * for scheduled / put-events entries). Detail is opaque `unknown` here -
 * consumer Lambdas should narrow it with a typed schema in their own
 * bounded context.
 */
export const EventEnvelopeSchema = z.object({
  version: z.string(),
  id: z.string().uuid(),
  'detail-type': z.string(),
  source: z.string(),
  account: z.string(),
  time: z.string(),
  region: z.string(),
  resources: z.array(z.string()),
  detail: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
