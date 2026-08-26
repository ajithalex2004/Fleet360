/**
 * passenger-attendance — the single write path for trip-passenger
 * attendance.
 *
 * Every channel that can change whether someone is aboard goes through
 * here: the BLE gateway, QR/NFC/manual check-in, the geofence
 * stop-exit sweep, and operator edits. Before this existed each one
 * re-implemented the same three steps slightly differently, and the
 * automated paths skipped the transition guard entirely — the BLE
 * gateway wrote `status: 'BOARDED'` directly, so it could produce a
 * state the manual API would then refuse to move out of.
 *
 * Three steps, always in this order, always in one transaction:
 *
 *   1. validate the transition against the passenger state machine
 *   2. append a BoardingEvent (the immutable history)
 *   3. update TripPassenger.status (the current state)
 *
 * Status answers "where are they now". boarding_events answers "what
 * happened". Keeping both matters for the ABSENT → BOARDED case: a
 * rider who misses their assigned stop and catches the bus further
 * along ends the trip BOARDED, but attendance reporting must still be
 * able to see that they missed Stop A. The absence row is never
 * rewritten or deleted when the later boarding lands.
 *
 * Idempotency is the caller's concern for BLE (the gateway dedups on a
 * ±5s window before calling in), but same-state transitions are
 * accepted here rather than thrown on, so a duplicate that slips
 * through is a no-op instead of a 409.
 */

import type { Prisma, PrismaClient, BoardingEventSource } from '@prisma/client';
import {
  canTransitionPassenger,
  assertPassengerTransition,
  PassengerTransitionError,
  type TripPassengerStatus,
} from './state-machines';

/** Direction values written to boarding_events.direction (a free-text column). */
export const BOARDING_DIRECTION = {
  BOARD:  'BOARD',
  ALIGHT: 'ALIGHT',
  /**
   * Not a movement — a recorded miss. Kept in the same log as BOARD so
   * a single ordered read of boarding_events reconstructs the whole
   * trip narrative for a passenger:
   *
   *   07:05  ABSENT  stop A   (GEOFENCE, bus left without them)
   *   07:18  BOARD   stop B   (BLE, caught it further along)
   */
  ABSENT: 'ABSENT',
} as const;

export type BoardingDirection = typeof BOARDING_DIRECTION[keyof typeof BOARDING_DIRECTION];

/** Minimal client surface — accepts a PrismaClient or a transaction. */
type Db = PrismaClient | Prisma.TransactionClient;

export interface AttendanceContext {
  scheduleId: string;
  passengerId: string;
  staffMemberId?: string | null;
  /**
   * Required. boarding_events.tenant_id is NOT NULL as of 20260910000000; an
   * event written without a tenant used to be visible to every tenant and now
   * simply fails.
   */
  tenantId: string;
  /** Where it happened. Null for channels with no stop context. */
  stopId?: string | null;
  /** How it was detected. Must be a boarding_event_source enum member. */
  source: BoardingEventSource;
  /** Tag id, QR payload, badge number — whatever identified the person. */
  identifier?: string | null;
  occurredAt: Date;
  /** userId, or a system marker like `gateway:GW-1` / `system:stop-exit`. */
  performedBy?: string | null;
  rawPayload?: Prisma.InputJsonValue;
}

export interface AttendanceResult {
  /** False when the transition was rejected; nothing was written. */
  applied: boolean;
  previousStatus: TripPassengerStatus | null;
  status: TripPassengerStatus | null;
  /** Populated when applied === false. */
  reason?: string;
}

/**
 * Apply one attendance transition: guard, log, update.
 *
 * Returns rather than throws on an illegal transition. Callers here are
 * mostly batch ingesters (a gateway pushing 20 tags, a stop-exit sweep
 * over a manifest) where one rejected passenger must not abort the
 * other nineteen. HTTP handlers that want a 409 can inspect `applied`
 * and `reason`.
 */
async function applyTransition(
  db: Db,
  ctx: AttendanceContext,
  target: TripPassengerStatus,
  direction: BoardingDirection,
): Promise<AttendanceResult> {
  const passenger = await db.tripPassenger.findFirst({
    where: { id: ctx.passengerId, tripId: ctx.scheduleId },
    select: { id: true, status: true },
  });
  if (!passenger) {
    return { applied: false, previousStatus: null, status: null, reason: 'passenger not on this trip' };
  }

  const from = (passenger.status ?? 'CONFIRMED') as TripPassengerStatus;

  // Same-state is a no-op rather than an error: a duplicate scan that
  // slipped past the caller's dedup shouldn't produce a second event row
  // or a spurious failure.
  if (from === target) {
    return { applied: false, previousStatus: from, status: from, reason: 'already in target state' };
  }

  if (!canTransitionPassenger(from, target)) {
    return {
      applied: false,
      previousStatus: from,
      status: from,
      reason: `illegal transition ${from} → ${target}`,
    };
  }

  // Event first, status second — if the update fails the transaction
  // rolls both back, and the ordering makes the log the thing we'd
  // rather not lose.
  await db.boardingEvent.create({
    data: {
      scheduleId:    ctx.scheduleId,
      passengerId:   ctx.passengerId,
      staffMemberId: ctx.staffMemberId ?? null,
      method:        ctx.source,
      direction,
      identifier:    ctx.identifier ?? null,
      stopId:        ctx.stopId ?? null,
      performedAt:   ctx.occurredAt,
      performedBy:   ctx.performedBy ?? null,
      ...(ctx.rawPayload !== undefined ? { rawPayload: ctx.rawPayload } : {}),
      tenantId:      ctx.tenantId,
    },
  });

  await db.tripPassenger.update({
    where: { id: ctx.passengerId },
    data: {
      status: target,
      // Only stamped on the boarding itself. A later ALIGHT must not
      // overwrite when they got on.
      ...(target === 'BOARDED' ? { boardedAt: ctx.occurredAt } : {}),
    },
  });

  return { applied: true, previousStatus: from, status: target };
}

/**
 * Passenger detected aboard — BLE tag, QR scan, NFC, manual check-in.
 *
 * Legal from CONFIRMED (the normal case) and from ABSENT (they missed
 * their assigned stop and caught the bus at a later one). The earlier
 * ABSENT event stays in the log.
 */
export function recordBoarding(db: Db, ctx: AttendanceContext): Promise<AttendanceResult> {
  return applyTransition(db, ctx, 'BOARDED', BOARDING_DIRECTION.BOARD);
}

/**
 * Passenger got off.
 *
 * Note this changes status to ALIGHTED, unlike the pre-existing BLE
 * ALIGHT branch which deliberately left status at BOARDED and treated
 * the event log as the source of truth for onboard count. Callers that
 * want the old behaviour should log an event without calling this.
 */
export function recordAlighting(db: Db, ctx: AttendanceContext): Promise<AttendanceResult> {
  return applyTransition(db, ctx, 'ALIGHTED', BOARDING_DIRECTION.ALIGHT);
}

/**
 * Passenger was not aboard when the vehicle left their assigned stop.
 *
 * Only legal from CONFIRMED. Someone already BOARDED cannot become
 * absent, and the state machine enforces that — so a late-arriving
 * geofence exit event cannot retroactively mark a boarded rider absent.
 */
export function recordAbsence(db: Db, ctx: AttendanceContext): Promise<AttendanceResult> {
  return applyTransition(db, ctx, 'ABSENT', BOARDING_DIRECTION.ABSENT);
}

/**
 * Append an event WITHOUT touching status.
 *
 * Exists for the BLE ALIGHT case. Onboard count is derived from the
 * event log, and a stop-level alight is not the end of the passenger's
 * trip on a multi-leg route — flipping status to ALIGHTED there would
 * terminate them early, and ALIGHTED is terminal. So the gateway logs
 * the movement and leaves status alone, which is what it did before the
 * service existed; the behaviour is preserved deliberately rather than
 * inherited by accident.
 *
 * Reports `applied: true` because the event genuinely was recorded —
 * the caller's success counter should reflect that.
 */
export async function logAlightEvent(db: Db, ctx: AttendanceContext): Promise<AttendanceResult> {
  const passenger = await db.tripPassenger.findFirst({
    where: { id: ctx.passengerId, tripId: ctx.scheduleId },
    select: { id: true, status: true },
  });
  if (!passenger) {
    return { applied: false, previousStatus: null, status: null, reason: 'passenger not on this trip' };
  }

  const current = (passenger.status ?? 'CONFIRMED') as TripPassengerStatus;

  await db.boardingEvent.create({
    data: {
      scheduleId:    ctx.scheduleId,
      passengerId:   ctx.passengerId,
      staffMemberId: ctx.staffMemberId ?? null,
      method:        ctx.source,
      direction:     BOARDING_DIRECTION.ALIGHT,
      identifier:    ctx.identifier ?? null,
      stopId:        ctx.stopId ?? null,
      performedAt:   ctx.occurredAt,
      performedBy:   ctx.performedBy ?? null,
      ...(ctx.rawPayload !== undefined ? { rawPayload: ctx.rawPayload } : {}),
      tenantId:      ctx.tenantId,
    },
  });

  return { applied: true, previousStatus: current, status: current };
}

/**
 * Throwing variant for HTTP handlers that want a 409 on an illegal move.
 * Mirrors assertPassengerTransition's error type so callers can keep a
 * single catch clause.
 */
export async function recordBoardingOrThrow(db: Db, ctx: AttendanceContext): Promise<AttendanceResult> {
  const result = await recordBoarding(db, ctx);
  if (!result.applied && result.previousStatus && result.previousStatus !== 'BOARDED') {
    assertPassengerTransition(result.previousStatus, 'BOARDED');
  }
  return result;
}

export { PassengerTransitionError };
