export { validatePayload, EventEnvelopeSchema, type EventEnvelope } from './schema-validator.js';
export {
  createEventBridgeClient,
  makeDomainEvent,
  type EventBridgeConfig,
  type EventPublisher,
} from './eventbridge-client.js';
export { type DomainEvent, type EventDetail } from './types.js';
