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

    if (jeResult.status === 'rejected') {
      throw new Error(`postTripOperatingCostsToFinance failed: ${jeResult.reason}`);
    }
    if (arResult.status === 'rejected') {
      // AR mirror is best-effort — log but do not fail the consumer
      console.warn(
        `[finance-trip] mirrorBusTripRevenueToFinance non-fatal:`,
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
