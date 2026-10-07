/**
 * Finance consumer: trip.completed → Finance
 *
 * Mirrors a completed bus trip to Finance by calling the existing bridge
 * functions postTripOperatingCostsToFinance() + mirrorBusTripRevenueToFinance().
 * Idempotency is handled at the bridge level (sourceId dedup) and at the
 * inbox level (consumer-base).
 */

import { BaseEventConsumer }          from '@/events/consumer-base';
import type { DomainEventEnvelope }   from '@/events/event-envelope';
import { TRIP_COMPLETED }             from '@/events/registry';
import type { TripCompletedPayload }  from '@/events/contracts/trip.events';
import {
  postTripOperatingCostsToFinance,
  mirrorBusTripRevenueToFinance,
} from '@/lib/bus-ops/finance-bridge';

export class FinanceTripConsumer extends BaseEventConsumer<TripCompletedPayload> {
  readonly consumerName = 'finance-trip';
  readonly eventType    = TRIP_COMPLETED;

  protected async handle(
    envelope: DomainEventEnvelope<TripCompletedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;

    const schedule = {
      id:         data.scheduleId,
      tripNumber: data.tripNumber,
      vehicleId:  data.vehicleId,
      driverId:   data.driverId,
    };

    const tripLog = {
      id:                  data.tripLogId,
      scheduleId:          data.scheduleId,
      fuelUsed:            data.fuelUsed,
      passengersBoarded:   data.passengersBoarded,
      actualDepartureTime: data.actualDepartureTime ? new Date(data.actualDepartureTime) : null,
      actualArrivalTime:   data.actualArrivalTime   ? new Date(data.actualArrivalTime)   : null,
    };

    const [jeResult, arResult] = await Promise.allSettled([
      postTripOperatingCostsToFinance(schedule, tripLog, tenantId),
      mirrorBusTripRevenueToFinance(schedule, tripLog, data.farePerHead, tenantId),
    ]);

    // R5 (2026-08-14): the bridge now THROWS FinanceBridgeError on real
    // failures (used to silently return null). Propagating rejections
    // makes the outbox retry — retryCount/maxRetries in event_outbox
    // caps the loop; unresolvable failures land in the failed queue
    // visible at /admin/events/outbox.
    if (jeResult.status === 'rejected') {
      throw new Error(`postTripOperatingCostsToFinance failed: ${jeResult.reason}`);
    }
    if (arResult.status === 'rejected') {
      // Retry the whole event: both sides are idempotent now. The cost
      // journal is keyed on its source (createDraftJournalEntry returns the
      // existing entry on a retry), and the revenue invoice is an upsert on
      // (BUS_OPERATIONS, BUS_TRIP, scheduleId). Logging and acknowledging,
      // as before, lost the revenue side for good (architecture audit A5);
      // after the publisher's retries the event is parked, visible and
      // replayable at /admin/events/outbox.
      throw new Error(`mirrorBusTripRevenueToFinance failed: ${arResult.reason}`);
    }

    console.log(
      `[finance-trip] trip ${data.scheduleId} → ` +
      `JE ${jeResult.value?.jeId ?? 'skipped'} | ` +
      `AR ${arResult.status === 'fulfilled' ? (arResult.value?.financeInvoiceId ?? 'skipped') : 'warn'}`,
    );
  }
}
