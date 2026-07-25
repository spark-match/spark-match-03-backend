import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../http/api-error.js';
import { EventEnvelopeSchema, validatePayload } from './schema-validator.js';

describe('validatePayload', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('returns parsed data when input is valid', () => {
    const result = validatePayload(schema, { name: 'ada', age: 36 });
    expect(result).toEqual({ name: 'ada', age: 36 });
  });

  it('throws an ApiError when input is invalid', () => {
    let caught: unknown;
    try {
      validatePayload(schema, { name: 12, age: 'not a number' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('bad_request');
    expect((caught as ApiError).statusCode).toBe(400);
  });

  it('reports one ErrorDetail per Zod issue', () => {
    let caught: ApiError | null = null;
    try {
      validatePayload(schema, { name: 1, age: 'x' });
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.details).toHaveLength(2);
  });
});

describe('EventEnvelopeSchema', () => {
  const validEnvelope = {
    version: '0',
    id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
    'detail-type': 'UserRegistered',
    source: 'spark-match.identity',
    account: '123456789012',
    time: '2026-07-25T00:00:00.000Z',
    region: 'us-east-1',
    resources: [],
    detail: { foo: 'bar' },
  };

  it('accepts a complete envelope', () => {
    const result = EventEnvelopeSchema.parse(validEnvelope);
    expect(result.id).toBe(validEnvelope.id);
  });

  it('rejects an envelope with a non-uuid id', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects an envelope missing required fields', () => {
    const { id: _id, ...incomplete } = validEnvelope;
    expect(() => EventEnvelopeSchema.parse(incomplete)).toThrow();
  });
});
