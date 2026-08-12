/**
 * Shared types for the domain event outbox.
 *
 * The outbox pattern: every Command writes a row to event_outbox in
 * the same Postgres transaction as its business mutation. A background
 * publisher (publisher.ts) reads unpublished rows, dispatches each
 * to its registered consumer, and marks the row published. Consumers
 * record their work in event_consumer_inbox for per-consumer
 * idempotency.
 *
 * See migration 20260811000001_domain_event_outbox for the schema.
 */

/**
 * One outbox row, as the publisher sees it.
 *
 * Field types match the Postgres columns. `payload` is left as
 * `unknown` — consumers parse it according to their own event_type +
 * event_version contract (typically a Zod schema).
 */
export interface OutboxEvent {
  id: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  sourceModule: string;
  tenantId: string;
  correlationId: string | null;
  causationId: string | null;
  actor: string | null;
  /** JSON parsed from the JSONB column. Consumers should narrow this. */
  payload: unknown;
  occurredAt: Date;
  publishedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: Date;
}

/**
 * A consumer that handles one or more event types.
 *
 * `consumerName` is the stable identifier used for the per-consumer
 * idempotency row in event_consumer_inbox. It must be unique across
 * the deployment — two consumers with the same name share the same
 * idempotency window.
 *
 * `handle` is invoked by the publisher. The publisher passes the
 * Prisma client so consumers don't depend on a specific module-level
 * instance (important for testability and for running the publisher
 * outside the Next.js request context). Throwing from `handle` marks
 * the outbox row for retry; returning normally marks it published
 * and records the consumer-inbox row.
 */
import type { PrismaClient } from '@prisma/client';

export interface OutboxConsumer {
  consumerName: string;
  handle(event: OutboxEvent, prisma: PrismaClient): Promise<void>;
}

export interface TickOptions {
  /**
   * Maximum number of outbox rows to process in one tick.
   * Defaults to 50. Tune for your worst-case burst.
   */
  batchSize?: number;
  /**
   * Maximum retry attempts before an event is parked in failed state
   * and stops being dispatched. Defaults to 10. After this many
   * failures, the event needs manual intervention (or a one-off
   * script) to clear retry_count and re-enable processing.
   */
  maxRetries?: number;
}

export interface TickResult {
  /** Total rows the tick considered (after FOR UPDATE SKIP LOCKED). */
  total: number;
  /** Rows successfully dispatched to a consumer. */
  dispatched: number;
  /** Rows that failed during consumer.handle(); marked for retry. */
  failed: number;
  /** Rows with no consumer registered; marked published to skip them. */
  skipped: number;
}
