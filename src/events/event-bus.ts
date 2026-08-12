/**
 * EventBus abstraction — Fleet360 Phase 1 (PostgreSQL transactional outbox).
 *
 * publish() / publishBatch() write rows to event_outbox inside the caller's
 * Prisma transaction (or a standalone transaction when none is provided).
 * The outbox-publisher job polls and dispatches events to registered consumers.
 *
 * This interface is intentionally thin so that a future QStash / Kafka adapter
 * can be swapped in without touching call-sites.
 */

import { prisma }            from '@/lib/prisma';
import type { OutboxWriteParams, DomainEventEnvelope } from '@/events/event-envelope';
import { randomUUID }        from 'crypto';

// ── Interface ─────────────────────────────────────────────────────────────────

export type EventHandler<T = unknown> = (
  envelope: DomainEventEnvelope<T>,
) => Promise<void>;

export interface EventBus {
  /**
   * Write a single event to the outbox.
   * Pass `tx` to include the write in an existing Prisma transaction.
   */
  publish<T = unknown>(
    params: OutboxWriteParams<T>,
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<{ eventId: string }>;

  /** Write multiple events atomically. Always creates its own transaction when tx is omitted. */
  publishBatch<T = unknown>(
    events: OutboxWriteParams<T>[],
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<Array<{ eventId: string }>>;

  /**
   * Register an in-process consumer for a given event type.
   * Used by the outbox-publisher job to dispatch events to consumers.
   */
  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): void;

  /** Return all subscribers registered for an event type. */
  getHandlers(eventType: string): EventHandler[];
}

// ── PostgreSQL implementation ─────────────────────────────────────────────────

class PostgreSQLEventBus implements EventBus {
  private readonly _handlers = new Map<string, EventHandler[]>();

  async publish<T = unknown>(
    params: OutboxWriteParams<T>,
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<{ eventId: string }> {
    const [result] = await this._insertRows([params], tx);
    return result;
  }

  async publishBatch<T = unknown>(
    events: OutboxWriteParams<T>[],
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<Array<{ eventId: string }>> {
    if (events.length === 0) return [];
    if (tx) return this._insertRows(events, tx);
    // Wrap in own transaction when caller provides none
    return prisma.$transaction(innerTx => this._insertRows(events, innerTx));
  }

  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): void {
    const existing = this._handlers.get(eventType) ?? [];
    this._handlers.set(eventType, [...existing, handler as EventHandler]);
  }

  getHandlers(eventType: string): EventHandler[] {
    return this._handlers.get(eventType) ?? [];
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _insertRows<T>(
    events: OutboxWriteParams<T>[],
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<Array<{ eventId: string }>> {
    const db    = (tx ?? prisma) as typeof prisma;
    const results: Array<{ eventId: string }> = [];

    for (const e of events) {
      const eventId    = randomUUID();
      const occurredAt = e.occurredAt ?? new Date();

      await (db as typeof prisma).$executeRaw`
        INSERT INTO event_outbox
          (event_id, event_type, event_version,
           aggregate_type, aggregate_id,
           source_module, tenant_id,
           correlation_id, causation_id, actor,
           payload, occurred_at)
        VALUES (
          ${eventId}::uuid,
          ${e.eventType},
          ${e.eventVersion ?? '1'},
          ${e.aggregateType},
          ${e.aggregateId},
          ${e.sourceModule},
          ${e.tenantId}::uuid,
          ${e.correlationId ?? null}::uuid,
          ${e.causationId   ?? null}::uuid,
          ${e.actor         ?? null},
          ${JSON.stringify(e.payload)}::jsonb,
          ${occurredAt.toISOString()}::timestamptz
        )
      `;

      results.push({ eventId });
    }

    return results;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _bus: EventBus | undefined;

/**
 * Returns the Fleet360 EventBus singleton.
 * The first call also wires up all registered consumers from the event registry.
 */
export function getEventBus(): EventBus {
  if (_bus) return _bus;
  _bus = new PostgreSQLEventBus();
  // Consumers are wired lazily via initEventConsumers() called from the
  // outbox-publisher job so they are only loaded in the worker context.
  return _bus;
}

/** Exposed for testing — resets the singleton. */
export function _resetEventBusForTests(): void {
  _bus = undefined;
}
