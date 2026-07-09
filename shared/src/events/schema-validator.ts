import { z, type ZodSchema } from 'zod';
import { ApiError } from '../http/api-error.js';

export function validatePayload<T>(schema: ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw ApiError.badRequest('Validation failed', {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    });
  }
  return result.data;
}

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
