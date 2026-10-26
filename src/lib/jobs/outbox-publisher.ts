/**
 * Job: outbox-publisher
 *
 * The only event_outbox publisher: the scheduler's outbox-publisher job and
 * /api/cron/outbox-publish run this same function. Polls event_outbox for
 * unpublished rows, builds the DomainEventEnvelope, fans out to all
 * registered in-process consumers, and marks rows published.
 *
 * Exclusive delivery:
 *   - A run claims its batch in one statement (FOR UPDATE SKIP LOCKED inside
 *     an UPDATE that stamps claimed_by + claim_expires_at). Overlapping runs,
 *     replicas or a manual trigger skip rows with a live claim, and every
 *     status update is conditional on still owning the claim.
 *   - Per consumer, event_consumer_inbox records the outcome; a consumer that
 *     already PROCESSED an event is skipped when the event is retried for
 *     another consumer's failure (consumer-base.ts).
 *
 * Event types without a consumer:
 *   - Listed in EVENTS_WITHOUT_CONSUMERS (recorded facts): acknowledged.
 *   - Anything else is PARKED (dead letter, visible at /admin/events/outbox,
 *     replayable), never marked published: an acknowledgement means a
 *     consumer handled it.
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
import { withPlatformAdmin }          from '@/lib/rls';
import { getEventBus }                from '@/events/event-bus';
import type { DomainEventEnvelope }   from '@/events/event-envelope';
import { EVENTS_WITHOUT_CONSUMERS }   from '@/events/registry';

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE  = 50;   // rows per poll cycle
const MAX_RETRIES = 5;    // permanent park after this many failures
/** A claim outlives a normal batch; a crashed run's rows return after this. */
const CLAIM_TTL_SECONDS = 300;

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
  created_at:     Date;
}

// ── Consumer wiring ───────────────────────────────────────────────────────────

/**
 * Wire up all Finance consumers onto the shared EventBus singleton.
 * Called once at the start of each job run so that the consumer modules
 * are only loaded in the worker context (not in every API route).
 */
const consumerRegistrations = new WeakMap<ReturnType<typeof getEventBus>, Set<string>>();
export async function initEventConsumers(): Promise<void> {
  const bus = getEventBus();
  const registeredConsumers = consumerRegistrations.get(bus) ?? new Set<string>();
  consumerRegistrations.set(bus, registeredConsumers);
  // Dynamic imports keep consumer code out of the API bundle
  const [
    { FinanceTripConsumer },
    { FinanceFuelConsumer },
    { FinanceMaintenanceConsumer },
    { FinanceQuotationConsumer },
    { FinanceShipmentConsumer },
    { FinanceRentalInvoiceConsumer },
    { NotificationDispatchConsumer },
    { TripNotificationDispatchConsumer, TRIP_NOTIFICATION_EVENT_TYPES },
    { AlertEngineConsumer },
    // Phase D — Maintenance lifecycle consumers
    { FleetMaintenanceConsumer },
    { AnalyticsMaintenanceConsumer },
    { FinanceEstimationConsumer },
    { DunningNoticeConsumer },
  ] = await Promise.all([
    import('@/events/consumers/finance-trip.consumer'),
    import('@/events/consumers/finance-fuel.consumer'),
    import('@/events/consumers/finance-maintenance.consumer'),
    import('@/events/consumers/finance-quotation.consumer'),
    import('@/events/consumers/finance-shipment.consumer'),
    import('@/events/consumers/finance-rental-invoice.consumer'),
    import('@/events/consumers/notification-dispatch.consumer'),
    import('@/events/consumers/trip-notification.consumer'),
    import('@/events/consumers/alert-engine.consumer'),
    // Phase D
    import('@/events/consumers/fleet-maintenance.consumer'),
    import('@/events/consumers/analytics-maintenance.consumer'),
    import('@/events/consumers/finance-estimation.consumer'),
    import('@/events/consumers/dunning-notice.consumer'),
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
    // Bus-ops trip lifecycle — one instance per event type. Same idempotency
    // isolation as maintenance. Consumer names use the `notif-trip-*` prefix
    // so ops can grep NotificationLog / logs for trip-triggered messages.
    ...TRIP_NOTIFICATION_EVENT_TYPES.map((type: string) =>
      new TripNotificationDispatchConsumer(type, `notif-${type.replace('.', '-')}`),
    ),
    // Single Alert Engine consumer for `alert.condition_detected` — one
    // event type serves every module's alert conditions; the payload's
    // `code` field disambiguates.
    new AlertEngineConsumer(),
    // Phase D — Maintenance lifecycle
    new FleetMaintenanceConsumer(),
    new FinanceEstimationConsumer(),
    // Analytics — one instance per event type tracked
    // Counted once per job, on work_order_completed — the one completion event
    // both the PATCH route and the state machine emit. It was also registered
    // for maintenance.completed (Closed, PATCH only), so a job closed through
    // PATCH added to vehicles.maintenance_count and total_maintenance_cost twice.
    new AnalyticsMaintenanceConsumer('maintenance.work_order_completed', 'analytics-work-order-completed'),
    // Dunning & Collections — attempt-token claim protocol dispatcher.
    new DunningNoticeConsumer(),
  ];

  for (const consumer of consumers) {
    // Guard: only register once per process lifetime
    if (!registeredConsumers.has(consumer.consumerName)) {
      registeredConsumers.add(consumer.consumerName);
      bus.subscribe(consumer.eventType, async (envelope) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ok = await consumer.process(envelope as DomainEventEnvelope<any>);
        if (!ok) throw new Error(`${consumer.consumerName} processing failed`);
      });
    }
  }
}

// ── Claims ────────────────────────────────────────────────────────────────────

const ROW_COLUMNS = `id, event_id::text, event_type, event_version,
       aggregate_type, aggregate_id,
       source_module, tenant_id::text,
       correlation_id::text, causation_id::text, actor,
       payload, occurred_at, retry_count`;

/**
 * Claim up to BATCH_SIZE deliverable rows for this run, atomically: rows
 * another run holds (live claim) or that are row-locked right now are
 * skipped, so no event is handed to two runs at once.
 */
async function claimRows(token: string): Promise<OutboxRow[]> {
  const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<OutboxRow[]>(
    `UPDATE event_outbox
        SET claimed_by = $1, claim_expires_at = NOW() + make_interval(secs => $2::double precision)
      WHERE id IN (
        SELECT id FROM event_outbox
         WHERE published_at IS NULL
           AND (failed_at IS NULL OR retry_count < $3)
           AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
         ORDER BY created_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${ROW_COLUMNS}, created_at`,
    token, CLAIM_TTL_SECONDS, MAX_RETRIES, BATCH_SIZE,
  ));
  // RETURNING has no order; deliver oldest first, as before.
  return rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

/** Dry run: what a claim would take, without claiming. */
async function peekRows(): Promise<OutboxRow[]> {
  return withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<OutboxRow[]>(
    `SELECT ${ROW_COLUMNS}, created_at FROM event_outbox
      WHERE published_at IS NULL
        AND (failed_at IS NULL OR retry_count < $1)
        AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
      ORDER BY created_at ASC
      LIMIT $2`,
    MAX_RETRIES, BATCH_SIZE,
  ));
}

// ── Job handler ───────────────────────────────────────────────────────────────

// The outbox is a queue across every tenant: its reads and status updates run
// in platform context (event_outbox is under FORCE ROW LEVEL SECURITY). Event
// handlers run outside it, each in its event's own tenant (consumer-base.ts).
export async function runOutboxPublisher(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === 'true';

  await initEventConsumers();
  const bus = getEventBus();

  // ── Queue-health snapshot at the top of every run ─────────────────────────
  const [healthRow] = await withPlatformAdmin(prisma, (tx) => tx.$queryRaw<Array<{
    parked:  bigint | number;
    lag_ms:  number | null;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE published_at IS NULL
                        AND  failed_at IS NOT NULL
                        AND  retry_count >= ${MAX_RETRIES})              AS parked,
      EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at) FILTER (WHERE published_at IS NULL
                  AND (failed_at IS NULL OR retry_count < ${MAX_RETRIES})))) * 1000 AS lag_ms
    FROM event_outbox
  `).catch(() => [{ parked: 0, lag_ms: null }]);

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

  // Claim a batch of unpublished, unparked rows no other run holds.
  const claimToken = crypto.randomUUID();
  const rows = dryRun ? await peekRows() : await claimRows(claimToken);

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
  let unrouted  = 0;

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
    if (handlers.length === 0 && EVENTS_WITHOUT_CONSUMERS.has(row.event_type)) {
      // A recorded fact no consumer needs yet (src/events/registry.ts).
      await withPlatformAdmin(prisma, (tx) => tx.$executeRaw`
        UPDATE event_outbox
           SET published_at = NOW(), claimed_by = NULL, claim_expires_at = NULL
         WHERE id = ${row.id}::uuid AND claimed_by = ${claimToken}
      `);
      skipped++;
      continue;
    }
    if (handlers.length === 0) {
      // No consumer registered: park it where an operator sees it, rather
      // than acknowledging an event nothing handled. Replay re-queues it
      // once a consumer exists.
      const reason = `No consumer registered for event type ${row.event_type}`;
      console.warn(`[outbox-publisher] PARKING ${row.event_type} ${row.event_id}: ${reason}`);
      await withPlatformAdmin(prisma, (tx) => tx.$executeRaw`
        UPDATE event_outbox
           SET retry_count      = ${MAX_RETRIES},
               failed_at        = NOW(),
               failure_reason   = ${reason},
               claimed_by       = NULL,
               claim_expires_at = NULL
         WHERE id = ${row.id}::uuid AND claimed_by = ${claimToken}
      `);
      unrouted++;
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

      await withPlatformAdmin(prisma, (tx) => tx.$executeRaw`
        UPDATE event_outbox
           SET retry_count      = ${newCount},
               failed_at        = NOW(),
               failure_reason   = ${reason},
               claimed_by       = NULL,
               claim_expires_at = NULL
         WHERE id = ${row.id}::uuid AND claimed_by = ${claimToken}
      `);
      failed++;
    } else {
      console.info(
        `[outbox-publisher] published ${row.event_type} ${row.event_id} ` +
        `in ${eventDurationMs}ms (attempt ${row.retry_count + 1})`,
      );
      await withPlatformAdmin(prisma, (tx) => tx.$executeRaw`
        UPDATE event_outbox
           SET published_at     = NOW(),
               failed_at        = NULL,
               failure_reason   = NULL,
               claimed_by       = NULL,
               claim_expires_at = NULL
         WHERE id = ${row.id}::uuid AND claimed_by = ${claimToken}
      `);
      published++;
    }
  }

  return {
    status:  failed > 0 && published === 0 ? 'error' : 'ok',
    summary: `Published ${published}, failed ${failed}, skipped ${skipped}, parked without a consumer ${unrouted} of ${rows.length} event(s)` +
             (parkedCount > 0 ? ` — ${parkedCount} parked (dead-letter)` : ''),
    data:    { published, failed, skipped, unrouted, total: rows.length, parked: parkedCount, lagMs },
  };
}
