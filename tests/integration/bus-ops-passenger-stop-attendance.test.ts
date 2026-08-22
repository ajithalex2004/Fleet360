/**
 * The passenger stop-attendance narrative, end to end.
 *
 * The operational rule this pins:
 *
 *   Passenger expected at Stop A
 *        ↓  bus reaches Stop A, leaves without detecting their tag
 *   ABSENT
 *        ↓  they walk to Stop B and board the same bus
 *   BOARDED
 *
 * Two things must both hold at the end, and they pull in opposite
 * directions:
 *
 *   current status      = BOARDED   (they really are aboard)
 *   attendance history  = still shows they missed Stop A
 *
 * ABSENT used to be terminal, so the second half of that journey was
 * impossible — the manifest stayed wrong for the rest of the trip and
 * headcount disagreed with who was physically on the vehicle. Asserting
 * only the final status would pass against a naive fix that simply
 * overwrote the absence, which is why the event-log assertions matter
 * as much as the status one.
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - DATABASE_URL set
 *
 * Run: npx vitest run tests/integration/bus-ops-passenger-stop-attendance.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { recordAbsence } from '@/lib/bus-ops/passenger-attendance';
import {
  seedTestTenantFull,
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  type SeedResult,
} from '../setup';

const hasDb = Boolean(process.env.DATABASE_URL);
let serverAvailable = false;
let tenant: SeedResult | null = null;

const runId = crypto.randomUUID();
const GATEWAY_ID = `GW-ATT-${runId}`;
const TAG_ID     = `TAG-ATT-${runId}`;
const SECRET     = `secret-${runId}`;

let vehicleId: string | null = null;
let routeId: string | null = null;
let tripId: string | null = null;
let staffId: string | null = null;
let passengerId: string | null = null;
let stopAId: string | null = null;

function sign(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Push a BLE BOARD detection through the real gateway endpoint. */
async function bleBoard(occurredAt: Date) {
  const raw = JSON.stringify({
    gatewayId: GATEWAY_ID,
    events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt: occurredAt.toISOString(), rssiDbm: -55 }],
  });
  return fetch('http://localhost:3000/api/bus-ops/gateway/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gateway-signature': sign(raw, SECRET) },
    body: raw,
  });
}

async function readState() {
  return withPlatformAdmin(prisma, async (tx) => {
    const pax = await tx.tripPassenger.findUnique({
      where: { id: passengerId! },
      select: { status: true, boardedAt: true },
    });
    const events = await tx.boardingEvent.findMany({
      where: { scheduleId: tripId!, passengerId: passengerId! },
      select: { direction: true, method: true, stopId: true, performedAt: true, performedBy: true },
      orderBy: { performedAt: 'asc' },
    });
    return { pax, events };
  });
}

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable || !hasDb) return;

  tenant = await seedTestTenantFull();
  const tid = tenant.tenant.id;

  await withPlatformAdmin(prisma, async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: {
        tenantId: tid, make: 'ATT', model: 'Fixture',
        licensePlate: `ATT-${runId}`, seatingCapacity: 30, isActive: true,
      },
    });
    vehicleId = vehicle.id;

    const route = await tx.busRoute.create({
      data: {
        tenantId: tid, name: `ATT-ROUTE-${runId}`,
        origin: 'A', destination: 'B', routeType: 'STAFF', isActive: true,
      },
    });
    routeId = route.id;

    const stopA = await tx.routeStop.create({
      data: { tenantId: tid, routeId: route.id, stopName: 'Stop A', sequence: 1 },
    });
    stopAId = stopA.id;

    const trip = await tx.tripSchedule.create({
      data: {
        tenantId: tid, routeId: route.id, vehicleId: vehicle.id,
        departureTime: new Date(), status: 'SCHEDULED',
        capacity: 30, confirmedCount: 1,
      },
    });
    tripId = trip.id;

    const staff = await tx.staffMember.create({
      data: { tenantId: tid, name: `Rider ${runId.slice(0, 8)}`, employeeId: `EA-${runId.slice(0, 8)}` },
    });
    staffId = staff.id;

    await tx.staffBleTag.create({
      data: { tenantId: tid, staffMemberId: staff.id, tagId: TAG_ID, isActive: true },
    });
    await tx.bleGateway.create({
      data: { tenantId: tid, vehicleId: vehicle.id, gatewayId: GATEWAY_ID, secret: SECRET, isActive: true },
    });

    // Assigned to Stop A — the stop they are going to miss.
    const pax = await tx.tripPassenger.create({
      data: {
        tenantId: tid, tripId: trip.id, staffMemberId: staff.id,
        boardingStopId: stopA.id, status: 'CONFIRMED',
      },
    });
    passengerId = pax.id;
  });
}, 90_000);

afterAll(async () => {
  if (!hasDb) return;
  await withPlatformAdmin(prisma, async (tx) => {
    if (tripId) {
      await tx.boardingEvent.deleteMany({ where: { scheduleId: tripId } }).catch(() => {});
      await tx.tripPassenger.deleteMany({ where: { tripId } }).catch(() => {});
      await tx.tripSchedule.deleteMany({ where: { id: tripId } }).catch(() => {});
    }
    await tx.bleGateway.deleteMany({ where: { gatewayId: GATEWAY_ID } }).catch(() => {});
    await tx.staffBleTag.deleteMany({ where: { tagId: TAG_ID } }).catch(() => {});
    if (stopAId)   await tx.routeStop.deleteMany({ where: { id: stopAId } }).catch(() => {});
    if (staffId)   await tx.staffMember.deleteMany({ where: { id: staffId } }).catch(() => {});
    if (routeId)   await tx.busRoute.deleteMany({ where: { id: routeId } }).catch(() => {});
    if (vehicleId) await tx.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => {});
  }).catch(() => {});

  if (tenant) {
    await cleanupTenant(tenant.tenant.id).catch(() => {});
    await cleanupUser(tenant.user.id).catch(() => {});
  }
}, 90_000);

describe('missed assigned stop, then boarded at a later stop', () => {
  const absentAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago

  it('marks the passenger ABSENT when the bus leaves their assigned stop', async () => {
    if (!serverAvailable || !hasDb || !passengerId) return;

    const result = await prisma.$transaction((tx) =>
      recordAbsence(tx, {
        scheduleId:    tripId!,
        passengerId:   passengerId!,
        staffMemberId: staffId,
        tenantId:      tenant!.tenant.id,
        stopId:        stopAId,
        source:        'GEOFENCE',
        occurredAt:    absentAt,
        performedBy:   'system:stop-exit',
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.previousStatus).toBe('CONFIRMED');
    expect(result.status).toBe('ABSENT');

    const { pax, events } = await readState();
    expect(pax?.status).toBe('ABSENT');
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe('ABSENT');
    expect(events[0].method).toBe('GEOFENCE');
    // The stop is on the row — an absence with no stop is unattributable
    // and useless for per-stop SLA reporting.
    expect(events[0].stopId).toBe(stopAId);
  }, 90_000);

  it('re-boards them via BLE at a later stop, and keeps the absence on record', async () => {
    if (!serverAvailable || !hasDb || !passengerId) return;

    const boardAt = new Date();
    const res = await bleBoard(boardAt);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; boarded: number; summary: { errors: number } };
    expect(body.summary.errors, JSON.stringify(body)).toBe(0);
    expect(body.boarded).toBe(1);
    expect(body.ok).toBe(true);

    const { pax, events } = await readState();

    // Current state: genuinely aboard.
    expect(pax?.status).toBe('BOARDED');
    expect(pax?.boardedAt).not.toBeNull();

    // History: BOTH facts survive, in order. This is the assertion that
    // separates a correct fix from one that simply overwrites the miss.
    expect(events).toHaveLength(2);
    expect(events[0].direction).toBe('ABSENT');
    expect(events[0].stopId).toBe(stopAId);
    expect(events[0].performedBy).toBe('system:stop-exit');
    expect(events[1].direction).toBe('BOARD');
    expect(events[1].method).toBe('BLE');
    expect(events[1].performedBy).toBe(`gateway:${GATEWAY_ID}`);

    // The absence event was not rewritten to point at the later stop.
    expect(events[0].performedAt.getTime()).toBeLessThan(events[1].performedAt.getTime());
  }, 90_000);

  it('does not let a late stop-exit sweep mark an already-boarded rider absent', async () => {
    if (!serverAvailable || !hasDb || !passengerId) return;

    // A geofence EXIT for an earlier stop can arrive after the rider has
    // boarded further along — GPS pings are batched and can lag. The
    // state machine has to reject it, or the manifest flips back to
    // ABSENT for someone sitting on the bus.
    const before = await readState();

    const result = await prisma.$transaction((tx) =>
      recordAbsence(tx, {
        scheduleId:  tripId!,
        passengerId: passengerId!,
        tenantId:    tenant!.tenant.id,
        stopId:      stopAId,
        source:      'GEOFENCE',
        occurredAt:  new Date(),
        performedBy: 'system:stop-exit',
      }),
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/illegal transition BOARDED → ABSENT/);

    const after = await readState();
    expect(after.pax?.status).toBe('BOARDED');
    // Rejected means nothing written — not even an orphan event row.
    expect(after.events).toHaveLength(before.events.length);
  }, 90_000);
});
