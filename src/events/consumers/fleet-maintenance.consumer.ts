/**
 * Fleet consumer: maintenance.work_order_completed → Fleet
 *
 * When a maintenance work order is completed (garage invoice submitted),
 * marks the vehicle's operational status back to AVAILABLE in the fleet module.
 *
 * The vehicle was set to IN_MAINTENANCE when the request was approved.
 * This consumer closes that loop so dispatch, leasing, and rental can
 * see the vehicle is back in service.
 *
 * Idempotency:
 *   - event_consumer_inbox UNIQUE(consumer_name, event_id) — inbox level
 *   - UPDATE is idempotent: setting status = AVAILABLE when already AVAILABLE is a no-op
 */

import { BaseEventConsumer }                         from '@/events/consumer-base';
import type { DomainEventEnvelope }                  from '@/events/event-envelope';
import { MAINTENANCE_WORK_ORDER_COMPLETED }          from '@/events/registry';
import type { MaintenanceWorkOrderCompletedPayload } from '@/events/contracts/maintenance.events';
import { prisma }                                    from '@/lib/prisma';

export class FleetMaintenanceConsumer extends BaseEventConsumer<MaintenanceWorkOrderCompletedPayload> {
  readonly consumerName = 'fleet-vehicle-available';
  readonly eventType    = MAINTENANCE_WORK_ORDER_COMPLETED;

  protected async handle(
    envelope: DomainEventEnvelope<MaintenanceWorkOrderCompletedPayload>,
  ): Promise<void> {
    const { vehicleId, requestId } = envelope.data;

    if (!vehicleId) {
      console.warn(`[fleet-maintenance] no vehicleId on request ${requestId} — skipping`);
      return;
    }

    // Attempt to mark vehicle available — canonical vehicle status is 'status' and 'is_active'
    // Guard against releasing vehicles with unresolved safety defects (e.g. failed pre-trip inspection)
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE vehicles
          SET status     = 'AVAILABLE',
              is_active  = true,
              updated_at = NOW()
        WHERE id = $1
          AND status IN ('MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR')
          AND NOT EXISTS (
            SELECT 1 FROM bus_pretrip_checks bpc
             WHERE bpc.vehicle_id = vehicles.id
               AND bpc.deleted_at IS NULL
               AND bpc.overall_pass = false
               AND NOT EXISTS (
                 SELECT 1 FROM bus_pretrip_checks bpc2
                  WHERE bpc2.vehicle_id = bpc.vehicle_id
                    AND bpc2.deleted_at IS NULL
                    AND bpc2.overall_pass = true
                    AND bpc2.performed_at > bpc.performed_at
               )
          )`,
      vehicleId,
    ).catch(async () => {
      // Fallback: operational_status column variant if present
      return prisma.$executeRawUnsafe(
        `UPDATE vehicles
            SET operational_status = 'AVAILABLE',
                updated_at         = NOW()
          WHERE id = $1
            AND operational_status IN ('MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR')
            AND NOT EXISTS (
              SELECT 1 FROM bus_pretrip_checks bpc
               WHERE bpc.vehicle_id = vehicles.id
                 AND bpc.deleted_at IS NULL
                 AND bpc.overall_pass = false
                 AND NOT EXISTS (
                   SELECT 1 FROM bus_pretrip_checks bpc2
                    WHERE bpc2.vehicle_id = bpc.vehicle_id
                      AND bpc2.deleted_at IS NULL
                      AND bpc2.overall_pass = true
                      AND bpc2.performed_at > bpc.performed_at
                 )
            )`,
        vehicleId,
      ).catch(err => {
        // Column doesn't exist or table structure differs — log and continue
        console.warn(
          `[fleet-maintenance] vehicle ${vehicleId} status update skipped: ${err.message}`,
        );
        return 0;
      });
    });

    if (updated > 0) {
      console.log(
        `[fleet-maintenance] vehicle ${vehicleId} → AVAILABLE ` +
        `(request ${requestId})`,
      );
    } else {
      console.log(
        `[fleet-maintenance] vehicle ${vehicleId} status unchanged ` +
        `(already available or not found) — request ${requestId}`,
      );
    }
  }
}
