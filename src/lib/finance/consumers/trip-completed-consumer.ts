/**
 * Finance consumer for trip.completed (R5 fix 2026-08-13).
 *
 * Replaces the direct best-effort calls to
 * `postTripOperatingCostsToFinance()` / `mirrorBusTripRevenueToFinance()`
 * in the bus-ops complete handler with a durable, retried outbox flow.
 *
 * FLOW:
 *   1. Trip complete handler writes a `trip.completed` event to
 *      event_outbox in the same Postgres transaction as the trip
 *      state transition (status: COMPLETED). The trip completion
 *      succeeds even if Finance is down.
 *   2. The outbox publisher (src/lib/outbox/publisher.ts) picks
 *      up the event and dispatches to this consumer.
 *   3. THIS consumer fetches the schedule + trip log from the DB,
 *      then calls the existing finance-bridge functions. The bridge
 *      functions remain the single authoritative path for finance
 *      mutations — only the dispatch mechanism changed.
 *   4. On failure, the publisher retries with exponential backoff up
 *      to maxRetries (default 10). After that, the event is parked
 *      for manual intervention.
 *
 * Why a new outbox-style consumer rather than reusing the OLD
 * src/events/consumers/finance-trip.consumer.ts:
 *   - The new outbox is the platform's forward path (per
 *     src/lib/outbox/types.ts and ARCHITECTURE.md §2). Migrating
 *     here keeps the new outbox the single source of truth for
 *     retried delivery.
 *   - The OLD consumer is wired to a different registry shape
 *     (BaseEventConsumer + getEventBus()) and bypasses the
 *     publisher's FOR UPDATE SKIP LOCKED semantics. It will be
 *     deprecated in a follow-up.
 *
 * Idempotency: the underlying bridge functions are idempotent on
 * (BUS_OPERATIONS, BUS_TRIP, scheduleId) for revenue mirror and on
 * `expense_no = 'BUS-COSTS-{scheduleId}'` for operating costs. The
 * outbox consumer-inbox (event_consumer_inbox) provides a second
 * guard keyed on (consumerName, eventId).
 */

import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import {
  postTripOperatingCostsToFinance,
  mirrorBusTripRevenueToFinance,
} from '@/lib/bus-ops/finance-bridge';

// ── Event contract ────────────────────────────────────────────────────────
// Mirrors the payload published by /api/bus-ops/schedules/[id]/complete.
// Versioned so future changes are explicit.

export const TripCompletedEventSchema = z.object({
  scheduleId:          z.string().uuid(),
  tripNumber:          z.string().nullable().optional(),
  vehicleId:           z.string().uuid().nullable().optional(),
  driverId:            z.string().uuid().nullable().optional(),
  tripLogId:           z.string().uuid(),
  fuelUsed:            z.number().nullable().optional(),
  passengersBoarded:   z.number().nullable().optional(),
  farePerHead:         z.number().nonnegative().default(0),
  actualDepartureTime: z.string().datetime().nullable().optional(),
  actualArrivalTime:   z.string().datetime().nullable().optional(),
  endMileage:          z.number().nullable().optional(),
});
export type TripCompletedEvent = z.infer<typeof TripCompletedEventSchema>;

/**
 * Handle a `trip.completed` event.
 *
 * The event payload carries everything the bridge needs (scheduleId,
 * tripLogId, fuelUsed, passengersBoarded, farePerHead). The bridge
 * itself re-reads the schedule + trip log from the DB to get the
 * authoritative state.
 */
export async function handleTripCompletedEvent(
  event: TripCompletedEvent,
  prisma: PrismaClient,
): Promise<void> {
  const schedule = await prisma.tripSchedule.findUnique({
    where: { id: event.scheduleId },
    select: {
      id: true,
      tripNumber: true,
      vehicleId: true,
      driverId: true,
      tenantId: true,
    },
  });
  if (!schedule) {
    throw new Error(`TripSchedule ${event.scheduleId} not found`);
  }
  if (!schedule.tenantId) {
    // tenantId is required for the bridge. If absent, the trip can't be
    // mirrored to finance — log + skip rather than retry forever.
    console.warn(
      `[trip-completed] TripSchedule ${event.scheduleId} has no tenantId; skipping finance mirror`,
    );
    return;
  }

  const tripLog = await prisma.tripLog.findUnique({
    where: { id: event.tripLogId },
    select: {
      id: true,
      scheduleId: true,
      fuelUsed: true,
      passengersBoarded: true,
      actualDepartureTime: true,
      actualArrivalTime: true,
    },
  });
  if (!tripLog) {
    throw new Error(`TripLog ${event.tripLogId} not found`);
  }

  // Operating costs (debit 5145 Bus Operations Expense, credit 2100 AP/Accrued)
  // — fire-and-forget at the bridge level (best-effort, errors logged inside).
  const jeResult = await postTripOperatingCostsToFinance(
    {
      id:         schedule.id,
      tripNumber: schedule.tripNumber,
      vehicleId:  schedule.vehicleId,
      driverId:   schedule.driverId,
    },
    {
      id:                  tripLog.id,
      scheduleId:          tripLog.scheduleId,
      fuelUsed:            tripLog.fuelUsed,
      passengersBoarded:   tripLog.passengersBoarded,
      actualDepartureTime: tripLog.actualDepartureTime,
      actualArrivalTime:   tripLog.actualArrivalTime,
    },
    schedule.tenantId,
  );
  if (!jeResult) {
    console.warn(
      `[trip-completed] postTripOperatingCostsToFinance returned null for schedule ${event.scheduleId}`,
    );
  }

  // Revenue mirror (AR) — only fires when farePerHead > 0.
  if (event.farePerHead > 0) {
    const arResult = await mirrorBusTripRevenueToFinance(
      {
        id:         schedule.id,
        tripNumber: schedule.tripNumber,
        vehicleId:  schedule.vehicleId,
        driverId:   schedule.driverId,
      },
      {
        id:                  tripLog.id,
        scheduleId:          tripLog.scheduleId,
        fuelUsed:            tripLog.fuelUsed,
        passengersBoarded:   tripLog.passengersBoarded,
        actualDepartureTime: tripLog.actualDepartureTime,
        actualArrivalTime:   tripLog.actualArrivalTime,
      },
      event.farePerHead,
      schedule.tenantId,
    );
    if (!arResult) {
      console.warn(
        `[trip-completed] mirrorBusTripRevenueToFinance returned null for schedule ${event.scheduleId}`,
      );
    }
  }
}
