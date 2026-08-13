/**
 * DomainEventEnvelope — standard wrapper for all Fleet360 domain events.
 *
 * Every event published via the outbox is serialised into this shape.
 * Consumers always receive a DomainEventEnvelope<T> where T is the
 * event-specific payload defined in src/events/contracts/*.
 */

export interface DomainEventEnvelope<T = unknown> {
  /** Stable unique identifier for this event instance (UUID v4). */
  eventId:       string;
  /** Dot-namespaced event type, e.g. 'trip.completed'. */
  eventType:     string;
  /** Schema version — increment when the payload shape is not backward-compatible. */
  eventVersion:  string;
  /** Wall-clock time the business fact occurred (not when it was published). */
  occurredAt:    string;   // ISO 8601
  /** Tenant that owns this event. */
  tenantId:      string;
  /** Domain aggregate type, e.g. 'TripSchedule'. */
  aggregateType: string;
  /** Domain aggregate id — the primary key of the mutated row. */
  aggregateId:   string;
  /** Source module / bounded context, e.g. 'bus-ops', 'fleet', 'maintenance'. */
  sourceModule:  string;
  /** Propagated trace identifier — links all events from a single user action. */
  correlationId: string | null;
  /** The event that caused this one — enables causation chains. */
  causationId:   string | null;
  /** userId or 'system' — the actor who triggered the originating mutation. */
  actor:         string | null;
  /** Event-specific payload. */
  data:          T;
}

/** Minimum fields required to write a row to event_outbox. */
export interface OutboxWriteParams<T = unknown> {
  eventType:     string;
  eventVersion?: string;
  aggregateType: string;
  aggregateId:   string;
  sourceModule:  string;
  tenantId:      string | null;
  correlationId?: string | null;
  causationId?:   string | null;
  actor?:         string | null;
  payload:        T;
  occurredAt?:    Date;
}
