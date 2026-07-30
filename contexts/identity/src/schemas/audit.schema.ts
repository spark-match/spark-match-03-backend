import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

/**
 * Audit entry as returned by `GET /v1/audit` (admin only).
 *
 * `id` is BIGSERIAL in the DB (monotonic), `occurredAt` is the
 * server-side event timestamp (defaults to current_timestamp on insert).
 *
 * `metadata` is the discriminated union declared in `domain/audit.ts` —
 * we re-export it through the schema for the API surface but allow
 * `z.unknown()` at the boundary so OpenAPI consumers see a flexible
 * shape. We avoid declaring it as a tagged union here because the
 * discriminator `action` is at the parent object level.
 */
export const AuditEntrySchema = z.object({
  id: z.number().int().positive(),
  action: z.string(), // narrowed at runtime to AuditAction (validated by ops registry)
  actorUserId: PublicUserSchema.shape.id.nullable(),
  subjectUserId: PublicUserSchema.shape.id.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditListInputSchema = z.object({
  query: z
    .object({
      /** Cursor (opaque) returned from a previous response. */
      cursor: z.string().optional(),
      /** Page size (1-200, default 50). */
      limit: z.coerce.number().int().min(1).max(200).optional(),
      /** Filter by the user who performed the action. */
      actorUserId: PublicUserSchema.shape.id.optional(),
      /** Filter by the user the action targeted. */
      subjectUserId: PublicUserSchema.shape.id.optional(),
      /** Filter by event type. */
      action: z.string().optional(),
      /** Filter events at-or-after this ISO datetime (inclusive). */
      since: z.iso.datetime().optional(),
      /** Filter events at-or-before this ISO datetime (inclusive). */
      until: z.iso.datetime().optional(),
    })
    .optional(),
});
export type AuditListInput = z.infer<typeof AuditListInputSchema>;

export const AuditListOutputSchema = z.object({
  entries: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditListOutput = z.infer<typeof AuditListOutputSchema>;
