/**
 * Job: outbox-publisher
 *
 * Polls event_outbox for unpublished rows, builds the DomainEventEnvelope,
 * fans out to all registered in-process consumers, and marks rows published.
 *
 * Retry logic:
 *   - Up to MAX_RETRIES attempts; each failure increments retry_count and
 *     sets failed_at (cleared on next attempt so the row stays eligible).
 *   - After MAX_RETRIES the row is permanently parked (failed_at stays set).
 *
 * Dead Letter:
 *   - Parked rows (retry_count >= MAX_RETRIES, failed_at IS NOT NULL) are
 *     logged at WARN level and skipped; they remain in the table for manual
 *     inspection / replay.
 *
 * Tenant isolation:
 *   - tenant_id is propagated through to every consumer via the envelope.
 *   - No cross-tenant fan-out: each envelope carries exactly one tenant_id.
 */

import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { prisma }                     from '@/lib/prisma';
import { getEventBus }                from '@/events/event-bus';
import type { DomainEventEnvelope }   from '@/events/event-envelope';

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE  = 50;   // rows per poll cycle
const MAX_RETRIES = 5;    // permanent park after this many failures

// ── Types ─────────────────────────────────────────────────────────────────────

interface OutboxRow {
  id:             string;
  event_id:       string;
  event_type:     string;
  event_version:  string;
  aggregate_type: string;
  aggregate_id:   string;
  source_module:  string;
  tenant_id:      string;
  correlation_id: string | null;
  causation_id:   string | null;
  actor:          string | null;
  payload:        unknown;
  occurred_at:    Date;
  retry_count:    number;
}

// ── Consumer wiring ───────────────────────────────────────────────────────────

/**
 * Wire up all Finance consumers onto the shared EventBus singleton.
 * Called once at the start of each job run so that the consumer modules
 * are only loaded in the worker context (not in every API route).
 */
async function initEventConsumers(): Promise<void> {
  const bus = getEventBus();
  // Dynamic imports keep consumer code out of the API bundle
  const [
    { FinanceTripConsumer },
    { FinanceFuelConsumer },
    { FinanceMaintenanceConsumer },
    { FinanceQuotationConsumer },
    { FinanceShipmentConsumer },
    { FinanceRentalInvoiceConsumer },
    { NotificationDispatchConsumer },
    // Phase D — Maintenance lifecycle consumers
    { FleetMaintenanceConsumer },
    { AnalyticsMaintenanceConsumer },
    { FinanceEstimationConsumer },
  ] = await Promise.all([
    import('@/events/consumers/finance-trip.consumer'),
    import('@/events/consumers/finance-fuel.consumer'),
    import('@/events/consumers/finance-maintenance.consumer'),
    import('@/events/consumers/finance-quotation.consumer'),
    import('@/events/consumers/finance-shipment.consumer'),
    import('@/events/consumers/finance-rental-invoice.consumer'),
    import('@/events/consumers/notification-dispatch.consumer'),
    // Phase D
    import('@/events/consumers/fleet-maintenance.consumer'),
    import('@/events/consumers/analytics-maintenance.consumer'),
    import('@/events/consumers/finance-estimation.consumer'),
  ]);

  const consumers = [
    new FinanceTripConsumer(),
    new FinanceFuelConsumer(),
    new FinanceMaintenanceConsumer(),
    new FinanceQuotationConsumer(),
    new FinanceShipmentConsumer(),
    new FinanceRentalInvoiceConsumer(),
    // Maintenance QC — one consumer instance per event type for idempotency isolation
    new NotificationDispatchConsumer('maintenance.repair_completed',           'notif-repair-completed'),
    new NotificationDispatchConsumer('maintenance.quality_inspection_started', 'notif-qc-started'),
    new NotificationDispatchConsumer('maintenance.inspection_failed',          'notif-inspection-failed'),
    new NotificationDispatchConsumer('maintenance.vehicle_ready_for_service',  'notif-vehicle-ready'),
    // Phase D — Maintenance lifecycle
    new FleetMaintenanceConsumer(),
    new FinanceEstimationConsumer(),
    // Analytics — one instance per event type tracked
    new AnalyticsMaintenanceConsumer('maintenance.work_order_completed', 'analytics-work-order-completed'),
    new AnalyticsMaintenanceConsumer('maintenance.completed',            'analytics-maintenance-closed'),
  ];

  for (const consumer of consumers) {
    // Guard: only register once per process lifetime
    if (bus.getHandlers(consumer.eventType).length === 0) {
      bus.subscribe(consumer.eventType, async (envelope) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ok = await consumer.process(envelope as DomainEventEnvelope<any>);
        if (!ok) throw new Error(`${consumer.consumerName} processing failed`);
      });
    }
  }
}

// ── Job handler ───────────────────────────────────────────────────────────────

export async function runOutboxPublisher(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === 'true';

  await initEventConsumers();
  const bus = getEventBus();

  // ── Queue-health snapshot at the top of every run ─────────────────────────
  const [healthRow] = await prisma.$queryRaw<Array<{
    parked:  bigint | number;
    lag_ms:  number | null;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE published_at IS NULL
                        AND  failed_at IS NOT NULL
                        AND  retry_count >= ${MAX_RETRIES})              AS parked,
      EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) * 1000
        FILTER (WHERE published_at IS NULL
                  AND (failed_at IS NULL OR retry_count < ${MAX_RETRIES})) AS lag_ms
    FROM event_outbox
  `.catch(() => [{ parked: 0, lag_ms: null }]);

  const parkedCount = Number(healthRow?.parked ?? 0);
  const lagMs       = healthRow?.lag_ms != null ? Math.round(Number(healthRow.lag_ms)) : null;

  if (parkedCount > 0) {
    console.warn(
      `[outbox-publisher] ${parkedCount} permanently parked (dead-letter) row(s) — ` +
      `use POST /api/admin/events/outbox/replay to re-queue`,
    );
  }
  if (lagMs !== null && lagMs > 0) {
    console.info(`[outbox-publisher] queue lag: ${lagMs}ms (oldest unpublished event)`);
  }

  // Fetch unpublished rows (skip permanently parked ones)
  const rows = await prisma.$queryRaw<OutboxRow[]>`
    SELECT id, event_id::text, event_type, event_version,
           aggregate_type, aggregate_id,
           source_module, tenant_id::text,
           correlation_id::text, causation_id::text, actor,
           payload, occurred_at, retry_count
      FROM event_outbox
     WHERE published_at IS NULL
       AND (failed_at IS NULL OR retry_count < ${MAX_RETRIES})
     ORDER BY created_at ASC
     LIMIT ${BATCH_SIZE}
  `;

  if (rows.length === 0) {
    return {
      status:  'ok',
      summary: 'No unpublished events',
      data:    { processed: 0, parked: parkedCount, lagMs },
    };
  }

  let published = 0;
  let failed    = 0;
  let skipped   = 0;

  for (const row of rows) {
    if (dryRun) {
      console.log(`[outbox-publisher] DRY RUN — would publish ${row.event_type} ${row.event_id}`);
      skipped++;
      continue;
    }

    const envelope: DomainEventEnvelope<unknown> = {
      eventId:       row.event_id,
      eventType:     row.event_type,
      eventVersion:  row.event_version,
      occurredAt:    row.occurred_at.toISOString(),
      tenantId:      row.tenant_id,
      aggregateType: row.aggregate_type,
      aggregateId:   row.aggregate_id,
      sourceModule:  row.source_module,
      correlationId: row.correlation_id,
      causationId:   row.causation_id,
      actor:         row.actor,
      data:          row.payload,
    };

    const handlers = bus.getHandlers(row.event_type);
    if (handlers.length === 0) {
      // No consumer registered — mark published so we don't re-poll it
      console.warn(`[outbox-publisher] no consumers for ${row.event_type} — marking published`);
      await prisma.$executeRaw`
        UPDATE event_outbox
           SET published_at = NOW()
         WHERE id = ${row.id}::uuid
      `;
      skipped++;
      continue;
    }

    // Fan-out to all consumers; track per-event latency
    const eventStart = Date.now();
    const results = await Promise.allSettled(
      handlers.map(h => h(envelope)),
    );
    const eventDurationMs = Date.now() - eventStart;

    const anyFailed = results.some(r => r.status === 'rejected');

    if (anyFailed) {
      const newCount = row.retry_count + 1;
      const nowParked = newCount >= MAX_RETRIES;
      const reason   = results
        .filter(r => r.status === 'rejected')
        .map(r => (r as PromiseRejectedResult).reason?.message ?? String((r as PromiseRejectedResult).reason))
        .join('; ')
        .slice(0, 1000);

      if (nowParked) {
        console.warn(
          `[outbox-publisher] PARKING ${row.event_type} ${row.event_id} ` +
          `after ${newCount} attempts (${eventDurationMs}ms): ${reason}`,
        );
      } else {
        console.warn(
          `[outbox-publisher] attempt ${newCount}/${MAX_RETRIES} FAILED ` +
          `${row.event_type} ${row.event_id} (${eventDurationMs}ms): ${reason}`,
        );
      }

      await prisma.$executeRaw`
        UPDATE event_outbox
           SET retry_count    = ${newCount},
               failed_at      = NOW(),
               failure_reason = ${reason}
         WHERE id = ${row.id}::uuid
      `;
      failed++;
    } else {
      console.info(
        `[outbox-publisher] published ${row.event_type} ${row.event_id} ` +
        `in ${eventDurationMs}ms (attempt ${row.retry_count + 1})`,
      );
      await prisma.$executeRaw`
        UPDATE event_outbox
           SET published_at   = NOW(),
               failed_at      = NULL,
               failure_reason = NULL
         WHERE id = ${row.id}::uuid
      `;
      published++;
    }
  }

  return {
    status:  failed > 0 && published === 0 ? 'error' : 'ok',
    summary: `Published ${published}, failed ${failed}, skipped ${skipped} of ${rows.length} event(s)` +
             (parkedCount > 0 ? ` — ${parkedCount} parked (dead-letter)` : ''),
    data:    { published, failed, skipped, total: rows.length, parked: parkedCount, lagMs },
  };
}
