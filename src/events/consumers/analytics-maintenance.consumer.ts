/**
 * Analytics consumer: maintenance domain events → analytics aggregation
 *
 * Subscribes to WorkOrderCompleted and other key lifecycle events to update
 * vehicle-level maintenance analytics (cost, count, last service date).
 *
 * Design note:
 *   - All DB writes are best-effort: exceptions are caught and logged rather
 *     than re-thrown, so analytics failures never block Finance or Fleet consumers.
 *   - The consumer can be instantiated for multiple event types (same class,
 *     different consumerName) via the constructor override pattern.
 *
 * Consumers registered in outbox-publisher:
 *   new AnalyticsMaintenanceConsumer(MAINTENANCE_WORK_ORDER_COMPLETED, 'analytics-work-order-completed')
 *   new AnalyticsMaintenanceConsumer(MAINTENANCE_COMPLETED,            'analytics-maintenance-closed')
 */

import { BaseEventConsumer }                         from '@/events/consumer-base';
import type { DomainEventEnvelope }                  from '@/events/event-envelope';
import { prisma }                                    from '@/lib/prisma';

type AnyMaintenancePayload = {
  requestId:     string;
  vehicleId:     string;
  totalCost?:    number | null;
  requestType?:  string;
  tenantId:      string;
  completedAt?:  string;
  invoiceSubmittedAt?: string;
};

export class AnalyticsMaintenanceConsumer extends BaseEventConsumer<AnyMaintenancePayload> {
  readonly consumerName: string;
  readonly eventType:    string;

  constructor(eventType: string, consumerName: string) {
    super();
    this.eventType    = eventType;
    this.consumerName = consumerName;
  }

  protected async handle(
    envelope: DomainEventEnvelope<AnyMaintenancePayload>,
  ): Promise<void> {
    const { data } = envelope;
    const { vehicleId, requestId, totalCost, requestType } = data;
    const occurredAt = data.invoiceSubmittedAt ?? data.completedAt ?? envelope.occurredAt;

    // ── 1. Update vehicle-level maintenance summary (best-effort) ──────────
    await prisma.$executeRawUnsafe(
      `UPDATE vehicles
          SET last_maintenance_at     = $1::timestamptz,
              maintenance_count       = COALESCE(maintenance_count, 0) + 1,
              total_maintenance_cost  = COALESCE(total_maintenance_cost, 0) + $2,
              updated_at              = NOW()
        WHERE id = $3`,
      occurredAt,
      totalCost ?? 0,
      vehicleId,
    ).catch(err =>
      console.warn(`[${this.consumerName}] vehicle aggregate update skipped for ${vehicleId}: ${err.message}`),
    );

    // ── 2. Emit a structured analytics log line ────────────────────────────
    // This structured log can be ingested by any log-based analytics pipeline
    // (Datadog, OpenSearch, BigQuery, etc.) via the Fleet360 log shipper.
    console.info(JSON.stringify({
      analyticsEvent:  this.eventType,
      vehicleId,
      requestId,
      requestType:     requestType ?? null,
      totalCost:       totalCost   ?? null,
      tenantId:        data.tenantId,
      occurredAt,
      processedAt:     new Date().toISOString(),
    }));

    // ── 3. Upsert analytics summary row (best-effort) ──────────────────────
    // Target table: analytics.maintenance_kpi (may not exist in all envs)
    await prisma.$executeRawUnsafe(
      `INSERT INTO analytics.maintenance_kpi
         (vehicle_id, tenant_id, event_type, request_id, cost, request_type, occurred_at, recorded_at)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::timestamptz, NOW())
       ON CONFLICT DO NOTHING`,
      vehicleId,
      data.tenantId,
      this.eventType,
      requestId,
      totalCost ?? 0,
      requestType ?? null,
      occurredAt,
    ).catch(err =>
      console.debug(`[${this.consumerName}] analytics.maintenance_kpi upsert skipped: ${err.message}`),
    );
  }
}
