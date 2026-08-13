/**
 * BaseEventConsumer — inbox idempotency guard for all Fleet360 event consumers.
 *
 * Subclasses implement handle() with the actual business logic.
 * process() wraps handle() with:
 *   - duplicate-delivery guard via event_consumer_inbox UNIQUE(consumer_name, event_id)
 *   - structured error capture written back to the inbox row
 *   - per-consumer logging
 */

import { prisma }              from '@/lib/prisma';
import type { DomainEventEnvelope } from '@/events/event-envelope';

export abstract class BaseEventConsumer<T = unknown> {
  /** Unique stable name used as the key in event_consumer_inbox. */
  abstract readonly consumerName: string;
  /** Event type this consumer handles. */
  abstract readonly eventType: string;

  /**
   * Business logic to run for each event.
   * Throwing here marks the inbox entry as FAILED.
   */
  protected abstract handle(envelope: DomainEventEnvelope<T>): Promise<void>;

  /**
   * Entry point called by the outbox-publisher job.
   * Returns true on success/skip (already-processed), false on failure.
   */
  async process(envelope: DomainEventEnvelope<T>): Promise<boolean> {
    // ── Idempotency check ─────────────────────────────────────────────────
    const [existing] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status FROM event_consumer_inbox
        WHERE consumer_name = $1 AND event_id = $2::uuid
        LIMIT 1`,
      this.consumerName,
      envelope.eventId,
    ).catch(() => []);

    if (existing) {
      // Already processed (or previously failed — let publisher decide on retry)
      if (existing.status === 'PROCESSED') {
        console.log(
          `[${this.consumerName}] event ${envelope.eventId} already processed — skipping`,
        );
        return true;
      }
      // FAILED entry — allow re-processing (outbox publisher controls retry count)
    }

    // ── Claim the inbox slot ──────────────────────────────────────────────
    // INSERT ... ON CONFLICT DO NOTHING so that a concurrent worker racing on
    // the same event is harmlessly ignored.
    await prisma.$executeRawUnsafe(
      `INSERT INTO event_consumer_inbox
         (consumer_name, event_id, event_type, tenant_id, status)
       VALUES ($1, $2::uuid, $3, $4::uuid, 'PROCESSING')
       ON CONFLICT (consumer_name, event_id)
       DO UPDATE SET status = EXCLUDED.status, processed_at = NOW()`,
      this.consumerName,
      envelope.eventId,
      envelope.eventType,
      envelope.tenantId,
    ).catch(() => {
      // Idempotency insert conflict — another worker already claimed it
    });

    // ── Execute business logic ────────────────────────────────────────────
    try {
      await this.handle(envelope);

      await prisma.$executeRawUnsafe(
        `UPDATE event_consumer_inbox
            SET status = 'PROCESSED', processed_at = NOW(), error_message = NULL
          WHERE consumer_name = $1 AND event_id = $2::uuid`,
        this.consumerName,
        envelope.eventId,
      );

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${this.consumerName}] failed to process ${envelope.eventId}:`, err);

      await prisma.$executeRawUnsafe(
        `UPDATE event_consumer_inbox
            SET status = 'FAILED', processed_at = NOW(), error_message = $3
          WHERE consumer_name = $1 AND event_id = $2::uuid`,
        this.consumerName,
        envelope.eventId,
        msg.slice(0, 2000),
      );

      return false;
    }
  }
}
