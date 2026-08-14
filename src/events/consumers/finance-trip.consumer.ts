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
      // AR is a separate write from the JE. Whether to retry the whole
      // event on AR failure depends on JE-side idempotency: today
      // createDraftJournalEntry doesn't dedupe on (sourceType, sourceId),
      // so a full-event retry after JE success + AR failure would
      // double-post the JE. Until JE creation is idempotent (follow-up
      // FINANCE-JE-IDEMPOTENCE), AR failure is logged as an error (not
      // a throw) so at least the operator sees it, but the event is
      // treated as delivered. Consider raising a FINANCE_MIRROR_FAILED
      // alert here once the idempotence lands.
      console.error(
        `[finance-trip] AR mirror failed for trip ${data.scheduleId} — ` +
        `event will NOT retry (JE-idempotence follow-up required):`,
        arResult.reason,
      );
    }

    console.log(
      `[finance-trip] trip ${data.scheduleId} → ` +
      `JE ${jeResult.value?.jeId ?? 'skipped'} | ` +
      `AR ${arResult.status === 'fulfilled' ? (arResult.value?.financeInvoiceId ?? 'skipped') : 'warn'}`,
    );
  }
}
