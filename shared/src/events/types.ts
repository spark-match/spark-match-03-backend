// =============================================================================
// DomainEvent - typed wrapper around an EventBridge entry
// =============================================================================
// All events published to the spark-match-events bus follow this envelope:
//   - source:    'spark-match.<context>'         (e.g. 'spark-match.identity')
//   - detailType:'PascalCasePastTense'           (e.g. 'UserRegistered')
//   - detail:    { version: 1, data: T }         (forward-compatible)
// =============================================================================

export interface DomainEvent<T = unknown> {
  source: string;
  detailType: string;
  detail: EventDetail<T>;
}

export interface EventDetail<T = unknown> {
  /** Version of the event payload schema (incremented on breaking changes). */
  version: number;
  /** The actual event payload. */
  data: T;
}
