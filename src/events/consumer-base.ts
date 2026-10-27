/**
 * BaseEventConsumer — inbox idempotency guard for all Fleet360 event consumers.
 *
 * Subclasses implement handle() with the actual business logic.
 * process() wraps handle() with:
 *   - an exclusive claim on event_consumer_inbox UNIQUE(consumer_name, event_id):
 *     exactly one worker runs handle() for an event; a PROCESSED event is
 *     skipped; a FAILED or abandoned (stale PROCESSING) one is taken over
 *   - structured error capture written back to the inbox row
 *   - per-consumer logging
 */

import { prisma }              from '@/lib/prisma';
import { runWithTenantContext } from '@/lib/rls-scope';
import { withTenantRls }        from '@/lib/rls';
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
   * Run handle() and the PROCESSED mark in ONE tenant transaction.
   *
   * Without it each statement a handler makes commits on its own. A handler
   * that writes two things (an AP payable, then its journal entry) and fails
   * on the second leaves the first committed; the retry then sees the first,
   * takes the event as done, and the second is never written. With it, a
   * failure rolls every write back and the retry starts clean.
   *
   * Global-client calls inside handle() join the transaction
   * (src/lib/prisma.ts), so handlers need no tx parameter. Don't set it for a
   * handler that makes external calls (email, push, HTTP): it would hold the
   * transaction open across them.
   */
  protected readonly transactional: boolean = false;

  /**
   * Entry point called by the outbox-publisher job.
   * Returns true on success/skip (already-processed), false on failure.
   */
  async process(envelope: DomainEventEnvelope<T>): Promise<boolean> {
    // Consumers run in the outbox job, outside any request, so the Prisma
    // client has no tenant to scope queries with and RLS-protected tables
    // return nothing. Every envelope carries exactly one tenant (see
    // outbox-publisher.ts); run the whole delivery in that tenant's context.
    const tenantId = envelope.tenantId;
    if (!tenantId || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) return this.processInTenant(envelope);
    return runWithTenantContext(tenantId, () => this.processInTenant(envelope));
  }

  /** A PROCESSING claim older than this is treated as abandoned (crashed worker). */
  static readonly STALE_CLAIM_MINUTES = 10;

  private async processInTenant(envelope: DomainEventEnvelope<T>): Promise<boolean> {
    // ── Claim the inbox slot, exclusively ─────────────────────────────────
    // One statement decides ownership: a new row, or taking over a FAILED
    // row or an abandoned PROCESSING row. A row PROCESSED, or PROCESSING
    // under a live claim, is left alone and RETURNING yields nothing.
    // Errors propagate: a delivery whose claim could not be recorded must not
    // run the handler (it would bypass the duplicate guard).
    let claimed: Array<{ status: string }>;
    try {
      claimed = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `INSERT INTO event_consumer_inbox
           (consumer_name, event_id, event_type, tenant_id, status, processed_at)
         VALUES ($1, $2::uuid, $3, $4::uuid, 'PROCESSING', NOW())
         ON CONFLICT (consumer_name, event_id) DO UPDATE
           SET status = 'PROCESSING', processed_at = NOW(), error_message = NULL
         WHERE event_consumer_inbox.status = 'FAILED'
            OR (event_consumer_inbox.status = 'PROCESSING'
                AND event_consumer_inbox.processed_at < NOW() - make_interval(mins => $5::int))
         RETURNING status`,
        this.consumerName,
        envelope.eventId,
        envelope.eventType,
        envelope.tenantId,
        BaseEventConsumer.STALE_CLAIM_MINUTES,
      );
    } catch (err) {
      console.error(`[${this.consumerName}] could not claim ${envelope.eventId}; not processing:`, err);
      return false;
    }

    if (claimed.length === 0) {
      // Someone else's row: done already, or being processed right now.
      const [existing] = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM event_consumer_inbox
          WHERE consumer_name = $1 AND event_id = $2::uuid`,
        this.consumerName,
        envelope.eventId,
      );
      if (existing?.status === 'PROCESSED') {
        console.log(`[${this.consumerName}] event ${envelope.eventId} already processed — skipping`);
        return true;
      }
      // In progress elsewhere: not delivered yet; the publisher retries later.
      console.warn(`[${this.consumerName}] event ${envelope.eventId} is being processed by another worker`);
      return false;
    }

    // ── Execute business logic ────────────────────────────────────────────
    const markProcessed = () => prisma.$executeRawUnsafe(
      `UPDATE event_consumer_inbox
          SET status = 'PROCESSED', processed_at = NOW(), error_message = NULL
        WHERE consumer_name = $1 AND event_id = $2::uuid`,
      this.consumerName,
      envelope.eventId,
    );
    try {
      if (this.transactional) {
        const tenantId = envelope.tenantId;
        if (!tenantId || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
          throw new Error(`transactional consumer needs a tenant; event ${envelope.eventId} has none`);
        }
        // The handler's writes and the PROCESSED mark commit together, or
        // not at all. FAILED is recorded below, after the rollback.
        await withTenantRls(prisma, tenantId, async () => {
          await this.handle(envelope);
          await markProcessed();
        }, { timeoutMs: 60_000 });
      } else {
        await this.handle(envelope);
        await markProcessed();
      }

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
      ).catch((e) => console.error(`[${this.consumerName}] could not record failure:`, e));

      return false;
    }
  }
}
