/**
 * Regression guard for BLE gateway boarding ingest.
 *
 * The route recorded BoardingEvent.method as the string 'BLE_GATEWAY',
 * which is not a member of the boarding_event_source enum
 * (BLE | QR | NFC | MANUAL | DRIVER_APP | GEOFENCE). Both the dedup
 * lookup and the insert threw "Invalid value for argument `method`" on
 * every single event. Those throws were caught into summary.errors, and
 * the handler returned a hardcoded `ok: true` — so the gateway received
 * HTTP 200 with a success flag while nothing was written and no
 * passenger was ever marked BOARDED.
 *
 * That combination is what made this survivable in production: a broken
 * integration that reports success. The tests below therefore assert
 * BOTH halves —
 *
 *   1. a valid BLE boarding actually lands (row written, status flipped)
 *   2. `ok` tracks whether events were recorded, so a future silent
 *      failure cannot masquerade as success
 *
 * Asserting only the HTTP status would have passed against the broken
 * version, since it returned 200 throughout.
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - DATABASE_URL set
 *
 * Run: npx vitest run tests/integration/bus-ops-gateway-ble-source.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
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
const GATEWAY_ID = `GW-${runId}`;
const TAG_ID     = `TAG-${runId}`;
const SECRET     = `secret-${runId}`;

let vehicleId: string | null = null;
let routeId: string | null = null;
let tripId: string | null = null;
let staffId: string | null = null;
let passengerId: string | null = null;

/** Sign a payload the way the gateway firmware does (HMAC-SHA256 hex). */
function sign(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

async function postEvents(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  return fetch('http://localhost:3000/api/bus-ops/gateway/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gateway-signature': sign(raw, secret),
    },
    body: raw,
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
        tenantId: tid, make: 'BLE', model: 'Fixture',
        licensePlate: `BLE-${runId}`, seatingCapacity: 30, isActive: true,
      },
    });
    vehicleId = vehicle.id;

    const route = await tx.busRoute.create({
      data: {
        tenantId: tid, name: `BLE-ROUTE-${runId}`,
        origin: 'A', destination: 'B', routeType: 'STAFF', isActive: true,
      },
    });
    routeId = route.id;

    // Departure "now" so the route's ±2h active-trip window matches.
    // status SCHEDULED is in the accepted set under both the old and the
    // renamed trip vocabulary, so this fixture is independent of the
    // status-reconciliation change.
    const trip = await tx.tripSchedule.create({
      data: {
        tenantId: tid, routeId: route.id, vehicleId: vehicle.id,
        departureTime: new Date(), status: 'SCHEDULED',
        capacity: 30, confirmedCount: 1,
      },
    });
    tripId = trip.id;

    const staff = await tx.staffMember.create({
      data: { tenantId: tid, name: `BLE Rider ${runId.slice(0, 8)}`, employeeId: `E-${runId.slice(0, 8)}` },
    });
    staffId = staff.id;

    await tx.staffBleTag.create({
      data: { tenantId: tid, staffMemberId: staff.id, tagId: TAG_ID, isActive: true },
    });

    await tx.bleGateway.create({
      data: {
        tenantId: tid, vehicleId: vehicle.id, gatewayId: GATEWAY_ID,
        secret: SECRET, isActive: true,
      },
    });

    const pax = await tx.tripPassenger.create({
      data: { tenantId: tid, tripId: trip.id, staffMemberId: staff.id, status: 'CONFIRMED' },
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
    if (staffId)   await tx.staffMember.deleteMany({ where: { id: staffId } }).catch(() => {});
    if (routeId)   await tx.busRoute.deleteMany({ where: { id: routeId } }).catch(() => {});
    if (vehicleId) await tx.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => {});
  }).catch(() => {});

  if (tenant) {
    await cleanupTenant(tenant.tenant.id).catch(() => {});
    await cleanupUser(tenant.user.id).catch(() => {});
  }
}, 90_000);

describe('BLE gateway boarding ingest', () => {
  it('records the boarding event and marks the passenger BOARDED', async () => {
    if (!serverAvailable || !hasDb || !tripId || !passengerId) return;

    const occurredAt = new Date().toISOString();
    const res = await postEvents({
      gatewayId: GATEWAY_ID,
      events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt, rssiDbm: -58 }],
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean; boarded?: number; errors?: number;
      summary: { transitionsApplied: number; errors: number; unknownTags: unknown[] };
    };

    // The bug produced errors=1, transitionsApplied=0 while still
    // reporting ok:true — so these are the assertions that catch it.
    // Failures here are swallowed server-side into a counter, so dump the
    // whole summary rather than leaving "expected 1 to be 0" to guess at.
    const ctx = JSON.stringify(body);
    expect(body.summary.errors, `errors>0 — ${ctx}`).toBe(0);
    expect(body.summary.transitionsApplied, `no transition applied — ${ctx}`).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.boarded).toBe(1);

    // Substantive half: the row exists and carries the valid enum value.
    const state = await withPlatformAdmin(prisma, async (tx) => {
      const events = await tx.boardingEvent.findMany({
        where: { scheduleId: tripId!, passengerId: passengerId! },
        select: { method: true, direction: true, identifier: true },
      });
      const pax = await tx.tripPassenger.findUnique({
        where: { id: passengerId! },
        select: { status: true, boardedAt: true },
      });
      return { events, pax };
    });

    expect(state.events).toHaveLength(1);
    expect(state.events[0].method).toBe('BLE');
    expect(state.events[0].direction).toBe('BOARD');
    expect(state.events[0].identifier).toBe(TAG_ID);
    expect(state.pax?.status).toBe('BOARDED');
    expect(state.pax?.boardedAt).not.toBeNull();
  }, 90_000);

  it('dedups a repeat of the same event instead of double-recording', async () => {
    if (!serverAvailable || !hasDb || !tripId || !passengerId) return;

    // The dedup lookup queried on method too, so it threw on the same
    // invalid enum — meaning dedup never worked either.
    const occurredAt = new Date().toISOString();
    await postEvents({ gatewayId: GATEWAY_ID, events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt }] });
    const res = await postEvents({ gatewayId: GATEWAY_ID, events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt }] });

    const body = await res.json() as { ok: boolean; summary: { duplicates: number; errors: number } };
    expect(body.summary.errors).toBe(0);
    expect(body.summary.duplicates).toBeGreaterThanOrEqual(1);
    expect(body.ok).toBe(true);
  }, 90_000);

  it('never reports ok:true while events failed to record', async () => {
    if (!serverAvailable || !hasDb) return;

    // The invariant, asserted against whatever the batch actually did:
    // `ok` must track recorded-ness, not merely "the handler returned".
    // An unknown tag is a rejected event rather than an error, so this
    // also pins that unknownTags does not silently inflate success.
    const res = await postEvents({
      gatewayId: GATEWAY_ID,
      events: [{ kind: 'BOARD', tagId: `UNKNOWN-${runId}`, occurredAt: new Date().toISOString() }],
    });

    const body = await res.json() as {
      ok: boolean; boarded?: number; errors?: number;
      summary: { transitionsApplied: number; errors: number; unknownTags: unknown[] };
    };

    expect(body.ok).toBe(body.summary.errors === 0);
    expect(body.errors).toBe(body.summary.errors);
    expect(body.boarded).toBe(body.summary.transitionsApplied);
    // Unknown tag: recorded as such, not counted as a boarding.
    expect(body.summary.unknownTags.length).toBe(1);
    expect(body.summary.transitionsApplied).toBe(0);
  }, 90_000);

  it('rejects a wrongly-signed payload', async () => {
    if (!serverAvailable || !hasDb) return;

    const res = await postEvents(
      { gatewayId: GATEWAY_ID, events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt: new Date().toISOString() }] },
      'wrong-secret',
    );
    expect(res.status).toBe(401);
  }, 90_000);

  it('rejects a payload with no signature header at all', async () => {
    if (!serverAvailable || !hasDb) return;

    // Distinct from the wrong-signature case: this exercises the
    // `!signatureHex → false` branch in verifyGatewaySignatureWithSecret,
    // i.e. that a missing header fails closed rather than skipping the
    // check. Worth pinning now the route is reachable without a session.
    const raw = JSON.stringify({
      gatewayId: GATEWAY_ID,
      events: [{ kind: 'BOARD', tagId: TAG_ID, occurredAt: new Date().toISOString() }],
    });
    const res = await fetch('http://localhost:3000/api/bus-ops/gateway/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no x-gateway-signature
      body: raw,
    });
    expect(res.status).toBe(401);
  }, 90_000);

  it('does not leak which gateway ids exist', async () => {
    if (!serverAvailable || !hasDb) return;

    // The route is unauthenticated at the middleware layer, so a
    // distinguishable "not registered" response would let anyone
    // enumerate valid gateway ids by posting garbage and watching for
    // 404 vs 401. Registered-but-badly-signed and simply-unknown must be
    // indistinguishable in both status AND body.
    const unknown = await postEvents({ gatewayId: `NOPE-${runId}`, events: [] }, 'wrong-secret');
    const known   = await postEvents({ gatewayId: GATEWAY_ID,      events: [] }, 'wrong-secret');

    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    expect(await unknown.json()).toEqual(await known.json());
  }, 90_000);
});
