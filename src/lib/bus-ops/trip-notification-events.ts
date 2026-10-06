import type { Prisma } from '@prisma/client';
import { getEventBus } from '@/events/event-bus';
import { TRIP_ARRIVING, TRIP_DELAYED, type TripArrivingPayload, type TripDelayedPayload } from '@/events/contracts/trip.events';

type StopEvent =
  | { kind: 'arriving'; payload: TripArrivingPayload }
  | { kind: 'delayed'; payload: TripDelayedPayload };

/** The marker and outbox row commit together, including across concurrent workers. */
export async function queueStopEventOnce(
  tx: Prisma.TransactionClient,
  tenantId: string,
  scheduleId: string,
  stopId: string,
  event: StopEvent,
): Promise<boolean> {
  await tx.$executeRaw`
    INSERT INTO trip_stop_visits (id, tenant_id, schedule_id, stop_id, updated_at)
    VALUES (gen_random_uuid(), ${tenantId}, ${scheduleId}, ${stopId}, NOW())
    ON CONFLICT (schedule_id, stop_id) DO NOTHING
  `;
  const claimed = event.kind === 'arriving'
    ? await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE trip_stop_visits SET approach_notified_at = NOW(), updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND schedule_id = ${scheduleId} AND stop_id = ${stopId}
          AND approach_notified_at IS NULL RETURNING id
      `
    : await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE trip_stop_visits SET delay_notified_at = NOW(), updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND schedule_id = ${scheduleId} AND stop_id = ${stopId}
          AND delay_notified_at IS NULL RETURNING id
      `;
  if (!claimed.length) return false;
  await getEventBus().publish({
    eventType: event.kind === 'arriving' ? TRIP_ARRIVING : TRIP_DELAYED,
    aggregateType: 'TripSchedule', aggregateId: scheduleId,
    sourceModule: 'bus-ops', tenantId, payload: event.payload,
  }, tx);
  return true;
}
