// =============================================================================
// EventBridge client with retry and partial-failure handling
// =============================================================================
// Differences vs. naive implementation:
//
//   1. publish() retries 3x with exponential backoff (100ms, 200ms, 400ms).
//   2. publishMany() chunks by AWS limit (10 entries per PutEvents call)
//      AND retries each chunk 3x. Critically, it inspects
//      result.FailedEntryCount and result.Entries[].ErrorCode to detect
//      partial failures (a successful HTTP response can still have
//      FailedEntryCount > 0).
//   3. Both methods throw the LAST error after exhausting retries.
//   4. The client singleton is created per invocation (Lambda reuse model).
// =============================================================================

import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import type { DomainEvent, EventDetail } from './types.js';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 100;
const AWS_BATCH_LIMIT = 10;

export interface EventBridgeConfig {
  busArn: string;
  region?: string;
}

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishMany(events: DomainEvent[]): Promise<void>;
}

export function createEventBridgeClient(config: EventBridgeConfig): EventPublisher {
  const region = config.region ?? process.env.AWS_REGION;
  const client = region ? new EventBridgeClient({ region }) : new EventBridgeClient({});

  function toEntry(event: DomainEvent): PutEventsRequestEntry {
    return {
      EventBusName: config.busArn,
      Source: event.source,
      DetailType: event.detailType,
      Detail: JSON.stringify(event.detail),
    };
  }

  async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function sendWithRetry(entries: PutEventsRequestEntry[]): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await client.send(new PutEventsCommand({ Entries: entries }));

        // AWS returns 200 even if some entries failed individually.
        // FailedEntryCount is the authoritative signal.
        if ((result.FailedEntryCount ?? 0) > 0) {
          const failed = (result.Entries ?? []).filter((e) => e.ErrorCode);
          const codes = failed
            .map((f) => `${f.ErrorCode}: ${f.ErrorMessage ?? 'unknown'}`)
            .join('; ');
          throw new Error(`Partial batch failure: ${codes || 'unknown'}`);
        }

        return; // success
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError;
  }

  return {
    async publish(event: DomainEvent): Promise<void> {
      await sendWithRetry([toEntry(event)]);
    },

    async publishMany(events: DomainEvent[]): Promise<void> {
      // EventBridge has a hard limit of 10 entries per PutEvents call.
      const chunks: DomainEvent[][] = [];
      for (let i = 0; i < events.length; i += AWS_BATCH_LIMIT) {
        chunks.push(events.slice(i, i + AWS_BATCH_LIMIT));
      }

      // Send chunks sequentially. (Parallel would require careful error
      // aggregation and is not warranted for the modest fan-out sizes
      // we expect per request.)
      for (const chunk of chunks) {
        await sendWithRetry(chunk.map(toEntry));
      }
    },
  };
}

/**
 * Helper to build a typed DomainEvent with version=1 detail envelope.
 */
export function makeDomainEvent<T>(
  source: string,
  detailType: string,
  data: T,
  version = 1,
): DomainEvent<T> {
  const detail: EventDetail<T> = { version, data };
  return { source, detailType, detail };
}
