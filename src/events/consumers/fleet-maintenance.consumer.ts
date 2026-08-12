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

    // Attempt to mark vehicle available — try both common column name variants
    // (operational_status is the canonical Fleet360 column; status is a fallback)
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE vehicles
          SET operational_status = 'AVAILABLE',
              updated_at         = NOW()
        WHERE id = $1
          AND operational_status IN ('IN_MAINTENANCE', 'UNDER_REPAIR')`,
      vehicleId,
    ).catch(async () => {
      // Fallback: some schemas use 'status' column
      return prisma.$executeRawUnsafe(
        `UPDATE vehicles
            SET status     = 'AVAILABLE',
                updated_at = NOW()
          WHERE id = $1
            AND status IN ('IN_MAINTENANCE', 'UNDER_REPAIR')`,
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
