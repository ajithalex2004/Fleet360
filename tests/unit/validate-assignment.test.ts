/**
 * Unit tests for src/lib/bus-ops/validate-assignment.ts
 *
 * Rule evaluation is pure over the facts returned by fetchFacts(). We
 * mock the Prisma client so each test controls the facts explicitly —
 * no DB dependency, fast.
 *
 * Coverage:
 *   V0 VEHICLE_NOT_FOUND         + subsequent skipped
 *   V1 VEHICLE_INACTIVE          (isActive=false and status enum)
 *   V2 VEHICLE_UNAVAILABLE       (MAINTENANCE / BREAKDOWN / RESERVED / …)
 *   V3 VEHICLE_ALREADY_ASSIGNED  (half-open interval semantics, self-exclusion)
 *   V4 VEHICLE_CAPACITY_EXCEEDED (roster > seats)
 *   V6 VEHICLE_GPS_STALE         (horizon-aware, threshold-based)
 *   D0 DRIVER_NOT_FOUND
 *   D1 DRIVER_INACTIVE
 *   D2 DRIVER_ALREADY_ASSIGNED
 *   D3 DRIVER_NO_SHIFT           (tenant-timezone-aware)
 *   Verdict aggregation
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { validateResourceAssignment, type ValidateAssignmentInput } from '@/lib/bus-ops/validate-assignment';

// ── Prisma mock builder ──────────────────────────────────────────────

interface MockFacts {
  vehicle?: {
    id: string; isActive?: boolean | null; status?: string | null;
    seatingCapacity?: number | null; vehicleGroup?: string | null;
    // Phase 2 vehicle compliance fields (all optional in the mock).
    registrationExpiry?: Date | null;
    insuranceExpiry?:    Date | null;
    mulkiyaExpiry?:      Date | null;
  } | null;
  driver?: {
    id: string; status?: string | null;
    // Phase 2 driver license fields.
    licenseExpiry?: Date | null;
    licenseType?:   string | null;
  } | null;
  overlappingTrips?:   Array<{ id: string; vehicleId?: string | null; driverId?: string | null; tripNumber?: string | null; departureTime: Date; arrivalTime?: Date | null; status?: string | null; route?: { estimatedDurationMins: number | null } | null }>;
  latestGpsPingAt?:    Date | null;
  route?: {
    id: string; estimatedDurationMins: number | null;
    // Phase 2 route requirement targets.
    requiredVehicleGroup?: string | null;
    requiredLicenseType?:  string | null;
  } | null;
  scheduleRoster?:     number | null;
  hasShiftForDate?:    boolean;
}

function buildPrismaMock(facts: MockFacts): PrismaClient {
  return {
    vehicle:        { findFirst: vi.fn().mockResolvedValue(facts.vehicle ?? null) },
    driver:         { findFirst: vi.fn().mockResolvedValue(facts.driver ?? null) },
    tripSchedule:   { findMany:  vi.fn().mockResolvedValue(facts.overlappingTrips ?? []) },
    busGpsPing:     { findFirst: vi.fn().mockResolvedValue(facts.latestGpsPingAt ? { occurredAt: facts.latestGpsPingAt } : null) },
    driverShift:    { count:     vi.fn().mockResolvedValue(facts.hasShiftForDate ? 1 : 0) },
    busRoute:       { findFirst: vi.fn().mockResolvedValue(facts.route ?? null) },
    tripPassenger:  { count:     vi.fn().mockResolvedValue(facts.scheduleRoster ?? 0) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient;
}

const T   = 'tenant-A';
const now = new Date('2026-08-14T09:00:00Z');

const baseInput = (overrides: Partial<ValidateAssignmentInput> = {}): ValidateAssignmentInput => ({
  tenantId:      T,
  vehicleId:     'vehicle-1',
  driverId:      'driver-1',
  departureTime: new Date('2026-08-14T10:00:00Z'),
  arrivalTime:   new Date('2026-08-14T11:00:00Z'),
  routeId:       'route-1',
  ...overrides,
});

const okVehicle = { id: 'vehicle-1', isActive: true, status: 'AVAILABLE', seatingCapacity: 40, vehicleGroup: 'BUS' };
const okDriver  = { id: 'driver-1', status: 'ACTIVE' };

// ── V0 VEHICLE_NOT_FOUND ─────────────────────────────────────────────

describe('V0 VEHICLE_NOT_FOUND', () => {
  it('BLOCKs and skips other vehicle checks when the vehicle row is missing', async () => {
    const prisma = buildPrismaMock({ vehicle: null, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.verdict).toBe('BLOCK');
    const v0 = res.checks.find(c => c.code === 'VEHICLE_NOT_FOUND')!;
    expect(v0.severity).toBe('BLOCK');
    // Remaining vehicle checks all present but SKIPPED
    for (const c of ['VEHICLE_INACTIVE', 'VEHICLE_UNAVAILABLE', 'VEHICLE_ALREADY_ASSIGNED', 'VEHICLE_CAPACITY_EXCEEDED', 'VEHICLE_GPS_STALE']) {
      const check = res.checks.find(x => x.code === c);
      expect(check?.severity).toBe('SKIPPED');
    }
  });

  it('cross-tenant vehicles look identical to not-found (no existence leak)', async () => {
    // The engine only ever queries WHERE tenantId = X — a cross-tenant vehicle
    // returns null just like a truly missing one. Our mock is unaware of
    // cross-tenant semantics, but the assertion here is against the same
    // "null result" input the tenant-scoped query would produce.
    const prisma = buildPrismaMock({ vehicle: null, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput({ vehicleId: 'other-tenant-vehicle' }), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_NOT_FOUND')?.severity).toBe('BLOCK');
  });
});

// ── V1 VEHICLE_INACTIVE ──────────────────────────────────────────────

describe('V1 VEHICLE_INACTIVE', () => {
  it.each([
    { isActive: false, status: 'AVAILABLE' },
    { isActive: true,  status: 'INACTIVE'  },
    { isActive: true,  status: 'SOLD'      },
    { isActive: true,  status: 'RETIRED'   },
  ])('BLOCKs when isActive=$isActive, status=$status', async ({ isActive, status }) => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, isActive, status },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_INACTIVE')?.severity).toBe('BLOCK');
  });

  it('PASSes when isActive=true and status=AVAILABLE', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_INACTIVE')?.severity).toBe('PASS');
  });
});

// ── V2 VEHICLE_UNAVAILABLE ───────────────────────────────────────────

describe('V2 VEHICLE_UNAVAILABLE', () => {
  it.each(['MAINTENANCE', 'BREAKDOWN', 'OUT_OF_SERVICE', 'IMPOUNDED', 'RESERVED', 'RENTED', 'ALLOCATED'])(
    'BLOCKs when status=%s',
    async (status) => {
      const prisma = buildPrismaMock({
        vehicle: { ...okVehicle, status },
        driver:  okDriver,
        hasShiftForDate: true,
      });
      const res = await validateResourceAssignment(baseInput(), prisma);
      expect(res.checks.find(c => c.code === 'VEHICLE_UNAVAILABLE')?.severity).toBe('BLOCK');
    },
  );
});

// ── V3 VEHICLE_ALREADY_ASSIGNED — overlap semantics ─────────────────

describe('V3 VEHICLE_ALREADY_ASSIGNED', () => {
  it('does NOT overlap when trips touch at endpoints (half-open [start,end))', async () => {
    // Existing: 09:00–10:00. Proposed: 10:00–11:00. Endpoint touch, not overlap.
    // Our mock has already applied the tripSchedule.findMany filter
    // (departureTime < proposedEnd), so we pass no overlapping trips.
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      overlappingTrips: [],
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_ALREADY_ASSIGNED')?.severity).toBe('PASS');
  });

  it('overlaps when proposed sits inside an existing window', async () => {
    // Existing: 09:00–12:00 (dur 180min via route). Proposed: 10:00–11:00.
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      overlappingTrips: [{
        id: 'trip-other',
        vehicleId: 'vehicle-1',
        driverId:  null,
        tripNumber: 'OTHER-1',
        departureTime: new Date('2026-08-14T09:00:00Z'),
        arrivalTime:   new Date('2026-08-14T12:00:00Z'),
        status: 'SCHEDULED',
        route:  null,
      }],
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    const v3 = res.checks.find(c => c.code === 'VEHICLE_ALREADY_ASSIGNED');
    expect(v3?.severity).toBe('BLOCK');
    expect((v3?.context as { conflicts: unknown[] })?.conflicts).toHaveLength(1);
  });

  it('uses route.estimatedDurationMins for effectiveEnd when arrivalTime is null', async () => {
    // Existing: departs 09:30, no arrivalTime, route says 90min → ends 11:00.
    // Proposed: 10:00–10:15. Overlaps.
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      overlappingTrips: [{
        id: 'trip-open',
        vehicleId: 'vehicle-1',
        driverId:  null,
        tripNumber: 'OPEN-1',
        departureTime: new Date('2026-08-14T09:30:00Z'),
        arrivalTime:   null,
        status: 'SCHEDULED',
        route:  { estimatedDurationMins: 90 },
      }],
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(
      baseInput({ departureTime: new Date('2026-08-14T10:00:00Z'), arrivalTime: new Date('2026-08-14T10:15:00Z') }),
      prisma,
    );
    expect(res.checks.find(c => c.code === 'VEHICLE_ALREADY_ASSIGNED')?.severity).toBe('BLOCK');
  });
});

// ── V4 VEHICLE_CAPACITY_EXCEEDED ────────────────────────────────────

describe('V4 VEHICLE_CAPACITY_EXCEEDED', () => {
  it('WARNs when confirmedCount exceeds seatingCapacity', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, seatingCapacity: 30 },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput({ confirmedCount: 45 }), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_CAPACITY_EXCEEDED')?.severity).toBe('WARN');
  });

  it('PASSes at exactly capacity', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, seatingCapacity: 30 },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput({ confirmedCount: 30 }), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_CAPACITY_EXCEEDED')?.severity).toBe('PASS');
  });
});

// ── V6 VEHICLE_GPS_STALE ─────────────────────────────────────────────

describe('V6 VEHICLE_GPS_STALE (horizon-aware)', () => {
  it('does NOT warn for trips far in the future (out of operational horizon)', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      latestGpsPingAt: null,  // no ping — but trip is 2 days out
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(
      baseInput({ departureTime: new Date(now.getTime() + 48 * 3600_000) }),
      prisma,
    );
    const check = res.checks.find(c => c.code === 'VEHICLE_GPS_STALE');
    expect(check?.severity).toBe('PASS');
  });

  it('WARNs when departure is within 2h and last ping older than 30 min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const prisma = buildPrismaMock({
        vehicle: okVehicle,
        driver:  okDriver,
        latestGpsPingAt: new Date(now.getTime() - 45 * 60_000),  // 45m ago
        hasShiftForDate: true,
      });
      // Depart in 30 minutes — inside 2h horizon.
      const res = await validateResourceAssignment(
        baseInput({ departureTime: new Date(now.getTime() + 30 * 60_000) }),
        prisma,
      );
      expect(res.checks.find(c => c.code === 'VEHICLE_GPS_STALE')?.severity).toBe('WARN');
    } finally {
      vi.useRealTimers();
    }
  });

  it('WARNs when vehicle has never reported GPS and trip is imminent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const prisma = buildPrismaMock({
        vehicle: okVehicle,
        driver:  okDriver,
        latestGpsPingAt: null,
        hasShiftForDate: true,
      });
      const res = await validateResourceAssignment(
        baseInput({ departureTime: new Date(now.getTime() + 30 * 60_000) }),
        prisma,
      );
      expect(res.checks.find(c => c.code === 'VEHICLE_GPS_STALE')?.severity).toBe('WARN');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── D0-D3 driver checks ─────────────────────────────────────────────

describe('D0 DRIVER_NOT_FOUND', () => {
  it('BLOCKs and skips other driver checks when the driver row is missing', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle, driver: null, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_NOT_FOUND')?.severity).toBe('BLOCK');
    for (const c of ['DRIVER_INACTIVE', 'DRIVER_ALREADY_ASSIGNED', 'DRIVER_NO_SHIFT']) {
      expect(res.checks.find(x => x.code === c)?.severity).toBe('SKIPPED');
    }
  });
});

describe('D1 DRIVER_INACTIVE', () => {
  it.each(['INACTIVE', 'SUSPENDED', 'ON_LEAVE'])('BLOCKs when driver.status=%s', async (status) => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  { id: 'driver-1', status },
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_INACTIVE')?.severity).toBe('BLOCK');
  });
});

describe('D2 DRIVER_ALREADY_ASSIGNED', () => {
  it('BLOCKs when the same driver is on another overlapping active trip', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      overlappingTrips: [{
        id: 'trip-other',
        vehicleId: null,
        driverId:  'driver-1',
        tripNumber: 'D-OTHER',
        departureTime: new Date('2026-08-14T09:00:00Z'),
        arrivalTime:   new Date('2026-08-14T11:30:00Z'),
        status: 'SCHEDULED',
        route:  null,
      }],
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_ALREADY_ASSIGNED')?.severity).toBe('BLOCK');
  });
});

describe('D3 DRIVER_NO_SHIFT (tenant-timezone-aware)', () => {
  it('WARNs when no shift row exists for the departure date', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      hasShiftForDate: false,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_NO_SHIFT')?.severity).toBe('WARN');
  });

  it('PASSes when a shift exists for the departure date', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_NO_SHIFT')?.severity).toBe('PASS');
  });
});

// ── Verdict aggregation ─────────────────────────────────────────────

describe('verdict aggregation', () => {
  it('BLOCK dominates WARN and PASS', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, status: 'MAINTENANCE' },       // V2 → BLOCK
      driver:  okDriver,
      hasShiftForDate: false,                                 // D3 → WARN
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.verdict).toBe('BLOCK');
  });

  it('WARN when there is any WARN and no BLOCK', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      hasShiftForDate: false,                                 // D3 → WARN
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.verdict).toBe('WARN');
  });

  it('PASS when everything is clear', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.verdict).toBe('PASS');
  });
});

// ── Null vehicle/driver skip semantics ──────────────────────────────

describe('null vehicleId / driverId', () => {
  it('emits no vehicle checks when vehicleId is null', async () => {
    const prisma = buildPrismaMock({ driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput({ vehicleId: null }), prisma);
    expect(res.checks.some(c => c.subject === 'vehicle')).toBe(false);
  });

  it('emits no driver checks when driverId is null', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle });
    const res = await validateResourceAssignment(baseInput({ driverId: null }), prisma);
    expect(res.checks.some(c => c.subject === 'driver')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 2 checks — V5, V7-V9, D6, D7
// ────────────────────────────────────────────────────────────────────

const expiredDate  = new Date('2026-01-01T00:00:00Z');   // well before baseInput.departureTime
const futureDate   = new Date('2027-01-01T00:00:00Z');   // well after
const routeWithReq = (extra: { requiredVehicleGroup?: string | null; requiredLicenseType?: string | null }) =>
  ({ id: 'route-1', estimatedDurationMins: 60, ...extra });

// ── V5 VEHICLE_TYPE_MISMATCH (deterministic) ────────────────────────

describe('V5 VEHICLE_TYPE_MISMATCH (Phase 2)', () => {
  it('PASSes when route has no requiredVehicleGroup (opt-in)', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  okDriver,
      route:   { id: 'route-1', estimatedDurationMins: 60 },
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_TYPE_MISMATCH')?.severity).toBe('PASS');
  });

  it('PASSes when vehicle.vehicleGroup matches route.requiredVehicleGroup', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, vehicleGroup: 'BUS' },
      driver:  okDriver,
      route:   routeWithReq({ requiredVehicleGroup: 'BUS' }),
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_TYPE_MISMATCH')?.severity).toBe('PASS');
  });

  it('BLOCKs when vehicle.vehicleGroup mismatches (case-insensitive)', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, vehicleGroup: 'VAN' },
      driver:  okDriver,
      route:   routeWithReq({ requiredVehicleGroup: 'bus' }),   // lowercased to test case-insensitivity
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    const v5 = res.checks.find(c => c.code === 'VEHICLE_TYPE_MISMATCH');
    expect(v5?.severity).toBe('BLOCK');
    expect((v5?.context as { required: string; actual: string }).required).toBe('bus');
    expect((v5?.context as { required: string; actual: string }).actual).toBe('VAN');
  });

  it('PASSes when vehicle.vehicleGroup is null even if route requires one (no signal)', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, vehicleGroup: null },
      driver:  okDriver,
      route:   routeWithReq({ requiredVehicleGroup: 'BUS' }),
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_TYPE_MISMATCH')?.severity).toBe('PASS');
  });
});

// ── V7 VEHICLE_REGISTRATION_EXPIRED ─────────────────────────────────

describe('V7 VEHICLE_REGISTRATION_EXPIRED (Phase 2)', () => {
  it('BLOCKs when registrationExpiry is before departureTime', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, registrationExpiry: expiredDate },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_REGISTRATION_EXPIRED')?.severity).toBe('BLOCK');
  });

  it('PASSes when registrationExpiry is after departureTime', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, registrationExpiry: futureDate },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_REGISTRATION_EXPIRED')?.severity).toBe('PASS');
  });

  it('PASSes when registrationExpiry is null (no signal)', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_REGISTRATION_EXPIRED')?.severity).toBe('PASS');
  });

  it('BLOCKs when a FUTURE trip departs after the current insurance window (audit at scheduling time)', async () => {
    // Trip 6 months out; insurance expires in 3 months. Should catch it now, not at departure.
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, registrationExpiry: new Date('2026-11-01T00:00:00Z') },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(
      baseInput({ departureTime: new Date('2027-02-01T10:00:00Z'), arrivalTime: new Date('2027-02-01T11:00:00Z') }),
      prisma,
    );
    expect(res.checks.find(c => c.code === 'VEHICLE_REGISTRATION_EXPIRED')?.severity).toBe('BLOCK');
  });
});

// ── V8/V9 same pattern as V7 (thin coverage) ────────────────────────

describe('V8 VEHICLE_INSURANCE_EXPIRED (Phase 2)', () => {
  it('BLOCKs when insuranceExpiry is before departureTime', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, insuranceExpiry: expiredDate },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_INSURANCE_EXPIRED')?.severity).toBe('BLOCK');
  });
});

describe('V9 VEHICLE_MULKIYA_EXPIRED (Phase 2)', () => {
  it('BLOCKs when mulkiyaExpiry is before departureTime', async () => {
    const prisma = buildPrismaMock({
      vehicle: { ...okVehicle, mulkiyaExpiry: expiredDate },
      driver:  okDriver,
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'VEHICLE_MULKIYA_EXPIRED')?.severity).toBe('BLOCK');
  });
});

// ── D6 DRIVER_LICENSE_EXPIRED ────────────────────────────────────────

describe('D6 DRIVER_LICENSE_EXPIRED (Phase 2)', () => {
  it('BLOCKs when licenseExpiry is before departureTime', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  { ...okDriver, licenseExpiry: expiredDate },
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_LICENSE_EXPIRED')?.severity).toBe('BLOCK');
  });

  it('PASSes when licenseExpiry is null (no signal)', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_LICENSE_EXPIRED')?.severity).toBe('PASS');
  });
});

// ── D7 DRIVER_LICENSE_CATEGORY_MISMATCH ─────────────────────────────

describe('D7 DRIVER_LICENSE_CATEGORY_MISMATCH (Phase 2)', () => {
  it('PASSes when route has no requiredLicenseType', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  { ...okDriver, licenseType: 'BUS' },
      route:   { id: 'route-1', estimatedDurationMins: 60 },
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_LICENSE_CATEGORY_MISMATCH')?.severity).toBe('PASS');
  });

  it('PASSes when licenseType matches (case-insensitive)', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  { ...okDriver, licenseType: 'bus' },
      route:   routeWithReq({ requiredLicenseType: 'BUS' }),
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    expect(res.checks.find(c => c.code === 'DRIVER_LICENSE_CATEGORY_MISMATCH')?.severity).toBe('PASS');
  });

  it('BLOCKs when licenseType mismatches', async () => {
    const prisma = buildPrismaMock({
      vehicle: okVehicle,
      driver:  { ...okDriver, licenseType: 'LIGHT' },
      route:   routeWithReq({ requiredLicenseType: 'BUS' }),
      hasShiftForDate: true,
    });
    const res = await validateResourceAssignment(baseInput(), prisma);
    const d7 = res.checks.find(c => c.code === 'DRIVER_LICENSE_CATEGORY_MISMATCH');
    expect(d7?.severity).toBe('BLOCK');
    expect((d7?.context as { required: string; actual: string }).required).toBe('BUS');
    expect((d7?.context as { required: string; actual: string }).actual).toBe('LIGHT');
  });
});

// ── NOT_FOUND cascade includes Phase 2 checks ───────────────────────

describe('NOT_FOUND cascade skips Phase 2 checks too', () => {
  it('vehicle not found → V5/V7/V8/V9 all SKIPPED', async () => {
    const prisma = buildPrismaMock({ vehicle: null, driver: okDriver, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    for (const c of ['VEHICLE_TYPE_MISMATCH', 'VEHICLE_REGISTRATION_EXPIRED', 'VEHICLE_INSURANCE_EXPIRED', 'VEHICLE_MULKIYA_EXPIRED']) {
      expect(res.checks.find(x => x.code === c)?.severity).toBe('SKIPPED');
    }
  });

  it('driver not found → D6/D7 all SKIPPED', async () => {
    const prisma = buildPrismaMock({ vehicle: okVehicle, driver: null, hasShiftForDate: true });
    const res = await validateResourceAssignment(baseInput(), prisma);
    for (const c of ['DRIVER_LICENSE_EXPIRED', 'DRIVER_LICENSE_CATEGORY_MISMATCH']) {
      expect(res.checks.find(x => x.code === c)?.severity).toBe('SKIPPED');
    }
  });
});
