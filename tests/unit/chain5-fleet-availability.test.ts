/**
 * Chain 5 regressions: vehicle grounding, trip status vocabulary, SLA
 * priority, per-day vehicle assignment.
 */
import { describe, it, expect, vi } from 'vitest';
import { findGroundingBlocks, ungroundIfClear, isCriticalPriority } from '@/lib/fleet/grounding-blocks';
import { executeFleetExpirySweep } from '@/lib/fleet/expiry-grounding-engine';
import { evaluateTransition, toDriverTripStatus, startButtonState } from '@/lib/trip-state';
import { normalizeTripStatus, assertTripTransition, TripTransitionError } from '@/lib/bus-ops/state-machines';
import { isTripInFlight, TRIP_OPEN_STATUSES } from '@/lib/trip-status';
import { pickSlaHours, normalizeTicketPriority } from '@/lib/service-config/resolvers';
import { assignVehiclesToBlocks, type BlockVehicleRequirement, type VehicleCandidate } from '@/lib/plan/assign-vehicles';

// ─── Grounding ──────────────────────────────────────────────────────

function groundingDb(opts: {
  tickets?: Array<{ id: string; vehicle_id: string; readable_id: string | null; title: string | null }>;
  maintenance?: Array<{ id: string; vehicle_id: string; status: string | null }>;
  docs?: Array<{ id: string; vehicleId: string; docType: string; docNumber: string | null; expiryDate: Date | null }>;
  vehicles?: Array<{ id: string; status: string; isActive: boolean }>;
} = {}) {
  const queryRawUnsafe = vi.fn(async (sql: string) => {
    if (sql.includes('FROM service_tickets')) return opts.tickets ?? [];
    if (sql.includes('FROM maintenance_requests')) return opts.maintenance ?? [];
    return [];
  });
  return {
    $queryRawUnsafe: queryRawUnsafe,
    vehicleDocument: {
      findMany: vi.fn(async () => opts.docs ?? []),
      update: vi.fn(async () => ({})),
    },
    vehicle: {
      findMany: vi.fn(async () => (opts.vehicles ?? []).map((v) => ({
        id: v.id, vehicleCode: v.id, licensePlate: v.id, make: null, model: null, status: v.status, isActive: v.isActive,
      }))),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

const validDocs = (vehicleId: string) => [
  { id: `${vehicleId}-ins`, vehicleId, docType: 'INSURANCE', docNumber: 'I', expiryDate: new Date(Date.now() + 200 * 86_400_000) },
];

describe('ungroundIfClear', () => {
  it('keeps the vehicle grounded while an open critical DVIR ticket holds it', async () => {
    const db = groundingDb({ tickets: [{ id: 't2', vehicle_id: 'v1', readable_id: 'MNT-2', title: 'Brakes' }], docs: validDocs('v1') });
    const r = await ungroundIfClear(db as never, 'tenant', 'v1', { excludeTicketId: 't1' });
    expect(r.released).toBe(false);
    expect(r.blocks.map((b) => b.source)).toEqual(['SERVICE_TICKET']);
    expect(db.vehicle.updateMany).not.toHaveBeenCalled();
    // The vehicle row is locked first, then the ticket being closed is
    // excluded from its own check.
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(db.$queryRawUnsafe.mock.calls[1]).toContain('t1');
  });

  it('keeps the vehicle grounded while a workshop job is open', async () => {
    const db = groundingDb({ maintenance: [{ id: 'm1', vehicle_id: 'v1', status: 'Under Maintenance' }], docs: validDocs('v1') });
    const r = await ungroundIfClear(db as never, 'tenant', 'v1');
    expect(r.released).toBe(false);
    expect(r.blocks[0].source).toBe('MAINTENANCE');
  });

  it('keeps the vehicle grounded when its insurance has expired', async () => {
    const db = groundingDb({
      docs: [{ id: 'd', vehicleId: 'v1', docType: 'INSURANCE', docNumber: 'I', expiryDate: new Date(Date.now() - 5 * 86_400_000) }],
    });
    const r = await ungroundIfClear(db as never, 'tenant', 'v1');
    expect(r.released).toBe(false);
    expect(r.blocks[0].source).toBe('DOCUMENTS');
  });

  it('releases only a GROUNDED vehicle when nothing holds it', async () => {
    const db = groundingDb({ docs: validDocs('v1') });
    const r = await ungroundIfClear(db as never, 'tenant', 'v1');
    expect(r.released).toBe(true);
    expect(db.vehicle.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', tenantId: 'tenant', status: 'GROUNDED' },
      data: { status: 'AVAILABLE', isActive: true },
    });
  });

  it('matches critical tickets by priority in any case and by DVIR grounding flags', async () => {
    const db = groundingDb();
    await findGroundingBlocks(db as never, 'tenant', ['v1']);
    const sql = db.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("upper(coalesce(priority, '')) = 'CRITICAL'");
    expect(sql).toContain("custom_fields->>'isGrounded'");
    expect(isCriticalPriority('Critical')).toBe(true);
    expect(isCriticalPriority('CRITICAL')).toBe(true);
    expect(isCriticalPriority('High')).toBe(false);
  });
});

describe('executeFleetExpirySweep', () => {
  it('does not restore a vehicle whose documents are valid while a DVIR defect is open', async () => {
    const db = groundingDb({
      vehicles: [{ id: 'v1', status: 'GROUNDED', isActive: false }, { id: 'v2', status: 'GROUNDED', isActive: false }],
      docs: [...validDocs('v1'), ...validDocs('v2')],
      tickets: [{ id: 't1', vehicle_id: 'v1', readable_id: 'MNT-1', title: 'Steering' }],
    });
    const summary = await executeFleetExpirySweep(db as never, 'tenant');
    const v1 = summary.vehicleRecords.find((r) => r.vehicleId === 'v1');
    const v2 = summary.vehicleRecords.find((r) => r.vehicleId === 'v2');
    expect(v1?.actionTaken).toBe('MAINTAINED');
    expect(v1?.actionReason).toContain('MNT-1');
    expect(v2?.actionTaken).toBe('UNGROUNDED');
    const released = (db.vehicle.updateMany.mock.calls as unknown as Array<[{ where: { id: string } }]>).map((c) => c[0].where.id);
    expect(released).toEqual(['v2']);
  });
});

// ─── SLA priority ───────────────────────────────────────────────────

describe('ticket SLA priority', () => {
  const matrix = { Low: 72, Medium: 24, High: 4 };
  it('gives a Critical / CRITICAL ticket the tightest SLA, not Medium', () => {
    expect(pickSlaHours(matrix, 'Critical')).toBe(4);
    expect(pickSlaHours(matrix, 'CRITICAL')).toBe(4);
    expect(pickSlaHours(matrix, 'high')).toBe(4);
    expect(pickSlaHours(matrix, 'Low')).toBe(72);
    expect(normalizeTicketPriority('whatever')).toBe('Medium');
  });
});

// ─── Trip status vocabulary ─────────────────────────────────────────

describe('trip status vocabulary', () => {
  it('lets the driver app end a trip started from Bus Ops or telematics', () => {
    for (const status of ['STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT', 'IN_PROGRESS']) {
      expect(evaluateTransition({ currentStatus: status, transition: 'END' })).toEqual({ allowed: true, nextStatus: 'COMPLETED' });
      expect(startButtonState({ status, scheduledDeparture: new Date().toISOString(), actualDeparture: null, actualArrival: null, durationMinutes: null }).action).toBe('END');
    }
  });

  it('refuses transitions from an unrecognised status instead of guessing', () => {
    expect(evaluateTransition({ currentStatus: 'BOGUS', transition: 'START' }).allowed).toBe(false);
    expect(toDriverTripStatus('BOGUS')).toBeNull();
    expect(toDriverTripStatus('AUTO_CLOSED')).toBe('COMPLETED');
  });

  it('Bus Ops reads IN_PROGRESS as STARTED and no longer maps unknown values to SCHEDULED', () => {
    expect(normalizeTripStatus('IN_PROGRESS')).toBe('STARTED');
    expect(normalizeTripStatus('AUTO_CLOSED')).toBe('COMPLETED');
    expect(normalizeTripStatus(null)).toBe('SCHEDULED');
    expect(normalizeTripStatus('BOGUS')).toBeNull();
    expect(() => assertTripTransition(normalizeTripStatus('IN_PROGRESS'), 'COMPLETED')).not.toThrow();
    expect(() => assertTripTransition(normalizeTripStatus('BOGUS'), 'CANCELLED')).toThrow(TripTransitionError);
  });

  it('every reader shares one set that includes the driver app status', () => {
    expect(isTripInFlight('in_progress')).toBe(true);
    expect(isTripInFlight('SCHEDULED')).toBe(false);
    expect(TRIP_OPEN_STATUSES).toContain('IN_PROGRESS');
    expect(TRIP_OPEN_STATUSES).toContain('SCHEDULED');
  });
});

// ─── Per-day vehicle assignment ─────────────────────────────────────

const block = (blockId: string, date: string): BlockVehicleRequirement => ({
  blockId, date, maxPassengers: 10, requiredVehicleGroup: null, zoneId: null, pickupPoint: { lat: null, lng: null },
});
const vehicle = (id: string): VehicleCandidate => ({
  id, licensePlate: id, seatingCapacity: 20, vehicleGroup: null, zoneId: null, lat: null, lng: null,
} as VehicleCandidate);

describe('assignVehiclesToBlocks across a multi-day plan', () => {
  it('reuses a vehicle on different days but not twice on the same day', () => {
    const r = assignVehiclesToBlocks(
      [block('mon-1', '2026-10-19'), block('tue-1', '2026-10-20'), block('tue-2', '2026-10-20')],
      [vehicle('v1')],
    );
    expect(r.map((x) => x.vehicleId)).toEqual(['v1', 'v1', null]);
    expect(r[2].reason).toBe('NO_VEHICLES_AVAILABLE');
  });
});

describe('assignVehiclesToBlocks with undated blocks', () => {
  const undated = (blockId: string): BlockVehicleRequirement => ({ ...block(blockId, ''), date: null });

  it('an undated block reserves its vehicle across every date', () => {
    const r = assignVehiclesToBlocks([undated('u1'), block('mon-1', '2026-10-19')], [vehicle('v1')]);
    expect(r.map((x) => x.vehicleId)).toEqual(['v1', null]);
  });

  it('a vehicle used on a dated block is not free for an undated one', () => {
    const r = assignVehiclesToBlocks([block('mon-1', '2026-10-19'), undated('u1')], [vehicle('v1')]);
    expect(r.map((x) => x.vehicleId)).toEqual(['v1', null]);
  });
});
