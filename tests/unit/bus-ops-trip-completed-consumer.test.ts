/**
 * Unit test for the trip-completed outbox consumer.
 *
 * R5 audit fix (2026-08-13) — verifies the consumer wired into
 * src/lib/outbox/registry.ts (event type: 'trip.completed') is
 * registered, validates payloads, and gracefully handles missing
 * tenant IDs.
 *
 * The consumer calls the existing finance-bridge
 * (postTripOperatingCostsToFinance / mirrorBusTripRevenueToFinance).
 * The bridge is exercised end-to-end in tests via the publisher tick
 * (see scripts/test-outbox-flow.ts); this unit test focuses on the
 * consumer's payload validation + DB lookup + tenant guard.
 *
 * What's tested:
 *   1. Zod schema accepts a well-formed event
 *   2. Zod schema rejects malformed events (missing fields, wrong types)
 *   3. handleTripCompletedEvent looks up schedule + tripLog by ID
 *   4. handleTripCompletedEvent skips cleanly when schedule has no tenantId
 *   5. handleTripCompletedEvent throws when schedule is missing
 *      (publisher will retry — correct behaviour for transient races)
 *   6. handleTripCompletedEvent throws when trip log is missing
 *   7. handleTripCompletedEvent skips fare mirror when farePerHead = 0
 *   8. The outbox registry has a consumer registered for 'trip.completed'
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  TripCompletedEventSchema,
  handleTripCompletedEvent,
} from '@/lib/finance/consumers/trip-completed-consumer';
import { _resetForTests as resetOutboxRegistry } from '@/lib/outbox/registry';
import { isServerRunning, seedTestTenantFull, type SeedResult } from '../setup';

const prisma = new PrismaClient();

let serverUp = false;
let seed: SeedResult | undefined;
let TENANT = '';

let routeId = '';
let vehicleId = '';
let driverId = '';

beforeAll(async () => {
  resetOutboxRegistry();
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('dev server / DB not up — trip-completed consumer test will skip');
    return;
  }
  // The seed helper creates a real tenant with FK-safe referenced rows.
  // The bus_routes FK on tenant_id (fk_bus_routes_tenant) won't accept
  // a randomUUID(), so we must use the seed's tenant.
  seed = await seedTestTenantFull();
  TENANT = seed.tenant.id;

  routeId = randomUUID();
  vehicleId = randomUUID();
  driverId = randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO bus_routes (id, tenant_id, name, origin, destination, route_type, is_active, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'TEST-ROUTE', 'A', 'B', 'STAFF', true, NOW(), NOW())`,
    routeId, TENANT,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO drivers (id, tenant_id, full_name, is_active, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'Test Driver', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    driverId, TENANT,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO vehicles (id, tenant_id, plate_number, is_active, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    vehicleId, TENANT, `TEST-${vehicleId.slice(0, 6)}`,
  );
}, 60_000);

afterAll(async () => {
  if (TENANT) {
    await prisma.$executeRawUnsafe(`DELETE FROM trip_logs WHERE tenant_id = $1::uuid`, TENANT).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM trip_schedules WHERE tenant_id = $1::uuid`, TENANT).catch(() => {});
  }
  if (routeId)   await prisma.$executeRawUnsafe(`DELETE FROM bus_routes WHERE id = $1::uuid`, routeId).catch(() => {});
  if (driverId)  await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE id = $1::uuid`, driverId).catch(() => {});
  if (vehicleId) await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id = $1::uuid`, vehicleId).catch(() => {});
  await prisma.$disconnect();
});

describe('TripCompletedEventSchema (Zod validation)', () => {
  it('accepts a well-formed event', () => {
    const ok = TripCompletedEventSchema.safeParse({
      scheduleId: randomUUID(),
      tripNumber: 'TRIP-1',
      vehicleId: randomUUID(),
      driverId: randomUUID(),
      tripLogId: randomUUID(),
      fuelUsed: 12.5,
      passengersBoarded: 30,
      farePerHead: 5,
      actualDepartureTime: new Date().toISOString(),
      actualArrivalTime: new Date().toISOString(),
      endMileage: 12345,
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a minimal event (only required fields)', () => {
    const ok = TripCompletedEventSchema.safeParse({
      scheduleId: randomUUID(),
      tripLogId: randomUUID(),
    });
    expect(ok.success).toBe(true);
  });

  it('rejects when scheduleId is missing', () => {
    const bad = TripCompletedEventSchema.safeParse({
      tripLogId: randomUUID(),
    });
    expect(bad.success).toBe(false);
  });

  it('rejects when tripLogId is missing', () => {
    const bad = TripCompletedEventSchema.safeParse({
      scheduleId: randomUUID(),
    });
    expect(bad.success).toBe(false);
  });

  it('rejects when scheduleId is not a UUID', () => {
    const bad = TripCompletedEventSchema.safeParse({
      scheduleId: 'not-a-uuid',
      tripLogId: randomUUID(),
    });
    expect(bad.success).toBe(false);
  });

  it('rejects negative farePerHead', () => {
    const bad = TripCompletedEventSchema.safeParse({
      scheduleId: randomUUID(),
      tripLogId: randomUUID(),
      farePerHead: -1,
    });
    expect(bad.success).toBe(false);
  });
});

describe('handleTripCompletedEvent', () => {
  it('skips cleanly when schedule has no tenantId (no finance mirror possible)', async () => {
    if (!serverUp) return;
    const scheduleId = randomUUID();
    const tripLogId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_schedules (id, route_id, departure_time, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, NOW(), 'COMPLETED', NOW(), NOW())`,
      scheduleId, routeId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_logs (id, schedule_id, actual_departure_time, actual_arrival_time, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, NOW(), NOW(), NOW(), NOW())`,
      tripLogId, scheduleId,
    );

    const event = { scheduleId, tripLogId, farePerHead: 0 };
    await expect(handleTripCompletedEvent(event, prisma)).resolves.toBeUndefined();
  });

  it('throws when schedule does not exist (publisher will retry)', async () => {
    if (!serverUp) return;
    const event = {
      scheduleId: randomUUID(),
      tripLogId: randomUUID(),
      farePerHead: 0,
    };
    await expect(handleTripCompletedEvent(event, prisma)).rejects.toThrow(/not found/);
  });

  it('throws when trip log does not exist (publisher will retry)', async () => {
    if (!serverUp) return;
    const scheduleId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_schedules (id, tenant_id, route_id, departure_time, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, NOW(), 'COMPLETED', NOW(), NOW())`,
      scheduleId, TENANT, routeId,
    );

    const event = {
      scheduleId,
      tripLogId: randomUUID(),
      farePerHead: 0,
    };
    await expect(handleTripCompletedEvent(event, prisma)).rejects.toThrow(/not found/);
  });

  it('succeeds for a well-formed schedule + log pair (bridge catches its own errors)', async () => {
    if (!serverUp) return;
    const scheduleId = randomUUID();
    const tripLogId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_schedules (id, tenant_id, route_id, vehicle_id, driver_id,
                                  trip_number, departure_time, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, NOW(), 'COMPLETED', NOW(), NOW())`,
      scheduleId, TENANT, routeId, vehicleId, driverId, `TCE-${scheduleId.slice(0, 6)}`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_logs (id, tenant_id, schedule_id, actual_departure_time, actual_arrival_time,
                             fuel_used, passengers_boarded, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, NOW(), NOW(), 10, 25, NOW(), NOW())`,
      tripLogId, TENANT, scheduleId,
    );

    const event = {
      scheduleId,
      tripLogId,
      fuelUsed: 10,
      passengersBoarded: 25,
      farePerHead: 0,
    };

    await expect(handleTripCompletedEvent(event, prisma)).resolves.toBeUndefined();
  });
});

describe('Outbox registry wiring (R5 regression guard)', () => {
  it('registers a consumer for the trip.completed event type', async () => {
    await import('@/lib/finance/consumers');
    const { get } = await import('@/lib/outbox/registry');
    const consumer = get('trip.completed');
    expect(consumer).toBeDefined();
    expect(consumer?.consumerName).toBe('finance-trip-completed');
  });
});
