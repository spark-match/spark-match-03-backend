import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 100;

export interface DomainEvent<T = unknown> {
  source: string;
  detailType: string;
  detail: T;
  eventId?: string;
  metadata?: {
    correlationId?: string;
    userId?: string;
    occurredAt?: string;
  };
}

export interface EventPublisher {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  publishMany<T>(events: DomainEvent<T>[]): Promise<void>;
}

export function createEventBridgeClient(options: {
  busArn: string;
  region?: string;
  client?: EventBridgeClient;
}): EventPublisher {
  const client = options.client ?? new EventBridgeClient({
    region: options.region ?? process.env.AWS_REGION,
  });

  async function publishWithRetry(entry: PutEventsRequestEntry): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await client.send(new PutEventsCommand({ Entries: [entry] }));
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }
    throw new Error(
      `Failed to publish event ${entry.DetailType} after ${MAX_RETRIES} attempts: ${String(lastError)}`,
    );
  }

  return {
    async publish<T>(event: DomainEvent<T>): Promise<void> {
      const entry = buildEntry(options.busArn, event);
      await publishWithRetry(entry);
    },

    async publishMany<T>(events: DomainEvent<T>[]): Promise<void> {
      if (events.length === 0) return;
      const entries = events.map((e) => buildEntry(options.busArn, e));
      await client.send(new PutEventsCommand({ Entries: entries }));
    },
  };
}

function buildEntry<T>(busArn: string, event: DomainEvent<T>): PutEventsRequestEntry {
  return {
    EventBusName: busArn,
    Source: event.source,
    DetailType: event.detailType,
    Detail: JSON.stringify(event.detail),
    Time: new Date(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
