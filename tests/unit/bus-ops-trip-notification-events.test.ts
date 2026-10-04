import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const publish = vi.hoisted(() => vi.fn().mockResolvedValue({ eventId: 'event-1' }));
vi.mock('@/events/event-bus', () => ({ getEventBus: () => ({ publish }) }));
import { queueStopEventOnce } from '@/lib/bus-ops/trip-notification-events';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scheduleId = 'trip-1';
const stopId = 'stop-1';
const arriving = { kind: 'arriving' as const, payload: {
  scheduleId, tripNumber: null, vehicleId: 'bus-1', driverId: 'driver-1', routeId: 'route-1',
  stopId, stopName: 'Gate', etaAt: '2026-10-04T08:00:00Z', distanceM: 400, minutesToArrival: 3,
} };

describe('trip stop notification marker', () => {
  it('queues the event using the same transaction only when the marker is claimed', async () => {
    publish.mockClear();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'visit-1' }]).mockResolvedValueOnce([]),
    } as unknown as Prisma.TransactionClient;
    expect(await queueStopEventOnce(tx, tenantId, scheduleId, stopId, arriving)).toBe(true);
    expect(await queueStopEventOnce(tx, tenantId, scheduleId, stopId, arriving)).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'trip.arriving', tenantId, aggregateId: scheduleId,
    }), tx);
  });

  it('propagates an outbox failure so the caller rolls back its transaction', async () => {
    publish.mockReset().mockRejectedValueOnce(new Error('outbox unavailable'));
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'visit-1' }]),
    } as unknown as Prisma.TransactionClient;
    await expect(queueStopEventOnce(tx, tenantId, scheduleId, stopId, arriving)).rejects.toThrow('outbox unavailable');
  });
});
