/**
 * Adversarial Challenge Test Suite for Milestone M3 (Features F23 through F31)
 *
 * Empirically stress-tests and adversarially challenges:
 * 1. Vehicle Availability & Grounding Safety Enforcement (F24)
 *    - checkVehicleAssignable with GROUNDED, isActive = false, edge cases
 *    - School-bus and bus-ops pre-trip inspection failure grounding
 * 2. Maintenance State Transitions & Lifecycle Reset (F23)
 *    - FleetMaintenanceConsumer reset of MAINTENANCE / UNDER_REPAIR to AVAILABLE and is_active = true
 *    - Adversarial safety isolation: GROUNDED vehicles must NOT be reset by maintenance completion
 * 3. Multi-Vertical Fine & Toll Matching Engine (F27)
 *    - Logistics shipments, bus trips, school-bus trips, dispatch jobs, and lease contracts
 *    - General Ledger clearing integrity: balanced 2160 clearing lines across 1100 AR and 2000 AP
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrismaVehicleFindFirst = vi.fn();
const mockPrismaVehicleUpdate = vi.fn();
const mockPrismaExecuteRawUnsafe = vi.fn();
const mockPrismaQueryRawUnsafe = vi.fn();
const mockBusPreTripCheckCreate = vi.fn();
const mockTripScheduleFindFirst = vi.fn();
const mockTripScheduleUpdate = vi.fn();
const mockPostOperationalJournalEntry = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vehicle: {
      findFirst: (...args: unknown[]) => mockPrismaVehicleFindFirst(...args),
      update: (...args: unknown[]) => mockPrismaVehicleUpdate(...args),
    },
    busPreTripCheck: {
      create: (...args: unknown[]) => mockBusPreTripCheckCreate(...args),
      findFirst: vi.fn(),
    },
    tripSchedule: {
      findFirst: (...args: unknown[]) => mockTripScheduleFindFirst(...args),
      update: (...args: unknown[]) => mockTripScheduleUpdate(...args),
    },
    trafficFine: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $executeRawUnsafe: (...args: unknown[]) => mockPrismaExecuteRawUnsafe(...args),
    $queryRawUnsafe: (...args: unknown[]) => mockPrismaQueryRawUnsafe(...args),
    $transaction: vi.fn(async (callback) => {
      const mockTx = {
        vehicle: {
          findFirst: (...args: unknown[]) => mockPrismaVehicleFindFirst(...args),
          update: (...args: unknown[]) => mockPrismaVehicleUpdate(...args),
        },
        busPreTripCheck: {
          create: (...args: unknown[]) => mockBusPreTripCheckCreate(...args),
        },
        tripSchedule: {
          findFirst: (...args: unknown[]) => mockTripScheduleFindFirst(...args),
          update: (...args: unknown[]) => mockTripScheduleUpdate(...args),
        },
        $executeRawUnsafe: (...args: unknown[]) => mockPrismaExecuteRawUnsafe(...args),
        $queryRawUnsafe: (...args: unknown[]) => mockPrismaQueryRawUnsafe(...args),
      };
      return callback(mockTx);
    }),
  },
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_prisma, _tenantId, cb) => {
    const mockTx = {
      vehicle: {
        findFirst: (...args: unknown[]) => mockPrismaVehicleFindFirst(...args),
        update: (...args: unknown[]) => mockPrismaVehicleUpdate(...args),
      },
      busPreTripCheck: {
        create: (...args: unknown[]) => mockBusPreTripCheckCreate(...args),
      },
      tripSchedule: {
        findFirst: (...args: unknown[]) => mockTripScheduleFindFirst(...args),
        update: (...args: unknown[]) => mockTripScheduleUpdate(...args),
      },
      $executeRawUnsafe: (...args: unknown[]) => mockPrismaExecuteRawUnsafe(...args),
      $queryRawUnsafe: (...args: unknown[]) => mockPrismaQueryRawUnsafe(...args),
    };
    return cb(mockTx);
  }),
  withSavepoint: vi.fn(async (_tx, _name, cb, fallback) => {
    try {
      return await cb();
    } catch {
      return fallback;
    }
  }),
}));

vi.mock('@/lib/bus-ops/access', () => ({
  requireBusOpsRequest: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/finance/journal-service', () => ({
  postOperationalJournalEntry: (...args: unknown[]) => mockPostOperationalJournalEntry(...args),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  writeRequiredAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
}));

// ── Modules Under Test ─────────────────────────────────────────────────────────

import {
  checkVehicleAssignable,
  VEHICLE_UNASSIGNABLE_STATUSES,
  vehicleAssignableWhere,
} from '@/lib/fleet/vehicle-availability';
import { FleetMaintenanceConsumer } from '@/events/consumers/fleet-maintenance.consumer';
import {
  matchFineOrToll,
  postFineMatchedGlEntry,
  batchAutoMatchTenantFines,
  classifyOffenceLiability,
} from '@/lib/fleet/fine-toll-matcher';
import { PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
import { POST as schoolBusPreTripPost } from '@/app/api/school-bus/trips/[id]/pretrip-check/route';
import { POST as busOpsPreTripPost } from '@/app/api/bus-ops/schedules/[id]/pretrip-check/route';

describe('Adversarial Challenge Suite — Milestone M3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // CHALLENGE 1: Vehicle Availability & Grounding Safety Enforcement
  // ============================================================================
  describe('Challenge 1: Vehicle Availability & Grounding Safety Enforcement (F24)', () => {
    it('CH-01-A: checkVehicleAssignable strictly blocks vehicle with status = GROUNDED', async () => {
      mockPrismaVehicleFindFirst.mockResolvedValueOnce({
        id: 'veh-grounded-01',
        tenantId: 'tenant-uae-1',
        status: 'GROUNDED',
        licensePlate: 'DXB-G101',
        isActive: true,
        deletedAt: null,
      });

      const result = await checkVehicleAssignable('veh-grounded-01', { tenantId: 'tenant-uae-1' });

      expect(result.ok).toBe(false);
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.assignable).toBe(false);
      expect(failure.reason).toBe('Vehicle is grounded');
      expect(failure.error).toContain('DXB-G101 is GROUNDED and cannot be assigned');
    });

    it('CH-01-B: checkVehicleAssignable blocks vehicle with isActive = false regardless of status', async () => {
      mockPrismaVehicleFindFirst.mockResolvedValueOnce({
        id: 'veh-inactive-01',
        tenantId: 'tenant-uae-1',
        status: 'AVAILABLE',
        licensePlate: 'DXB-I102',
        isActive: false,
        deletedAt: null,
      });

      const result = await checkVehicleAssignable('veh-inactive-01', { tenantId: 'tenant-uae-1' });

      expect(result.ok).toBe(false);
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.assignable).toBe(false);
      expect(failure.reason).toBe('Vehicle is inactive');
      expect(failure.error).toContain('is inactive and cannot be assigned');
    });

    it('CH-01-C: checkVehicleAssignable normalizes case and whitespace for status = "  grounded  "', async () => {
      mockPrismaVehicleFindFirst.mockResolvedValueOnce({
        id: 'veh-ws-01',
        tenantId: 'tenant-uae-1',
        status: '  grounded  ',
        licensePlate: 'DXB-W103',
        isActive: true,
        deletedAt: null,
      });
      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]); // no operational_status override

      const result = await checkVehicleAssignable('veh-ws-01', { tenantId: 'tenant-uae-1' });

      expect(result.ok).toBe(false);
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.assignable).toBe(false);
      expect(failure.reason).toBe('Vehicle is grounded');
    });

    it('CH-01-D: checkVehicleAssignable catches operational_status = GROUNDED when column present', async () => {
      mockPrismaVehicleFindFirst.mockResolvedValueOnce({
        id: 'veh-op-01',
        tenantId: 'tenant-uae-1',
        status: 'AVAILABLE',
        licensePlate: 'DXB-OP104',
        isActive: true,
        deletedAt: null,
      });
      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([
        { operational_status: 'GROUNDED' },
      ]);

      const result = await checkVehicleAssignable('veh-op-01', { tenantId: 'tenant-uae-1' });

      expect(result.ok).toBe(false);
      const failure = result as Extract<typeof result, { ok: false }>;
      expect(failure.assignable).toBe(false);
      expect(failure.reason).toBe('Vehicle is grounded');
    });

    it('CH-01-E: checkVehicleAssignable approves vehicle when status = AVAILABLE and isActive = true', async () => {
      mockPrismaVehicleFindFirst.mockResolvedValueOnce({
        id: 'veh-avail-01',
        tenantId: 'tenant-uae-1',
        status: 'AVAILABLE',
        licensePlate: 'DXB-A105',
        isActive: true,
        deletedAt: null,
      });
      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([]);

      const result = await checkVehicleAssignable('veh-avail-01', { tenantId: 'tenant-uae-1' });

      expect(result.ok).toBe(true);
      expect(result.assignable).toBe(true);
      expect(result.status).toBe('AVAILABLE');
      expect(result.licensePlate).toBe('DXB-A105');
    });

    it('CH-01-F: VEHICLE_UNASSIGNABLE_STATUSES set and vehicleAssignableWhere include GROUNDED', () => {
      expect(VEHICLE_UNASSIGNABLE_STATUSES.has('GROUNDED')).toBe(true);
      expect(VEHICLE_UNASSIGNABLE_STATUSES.has('MAINTENANCE')).toBe(true);
      expect(VEHICLE_UNASSIGNABLE_STATUSES.has('UNDER_REPAIR')).toBe(true);

      const where = vehicleAssignableWhere();
      expect(where.isActive).toBe(true);
      expect(where.deletedAt).toBeNull();
      const statusFilter = where.OR[1].status as { notIn: string[] };
      expect(statusFilter.notIn).toContain('GROUNDED');
    });

    it('CH-01-G: School-Bus pre-trip inspection failure sets status = GROUNDED and isActive = false', async () => {
      const tripId = 'trip-school-100';
      const vehicleId = 'veh-bus-school-1';

      // 1. Mock trip existence
      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([
        { id: tripId, vehicle_id: vehicleId, driver_name: 'Driver Salem' },
      ]);

      // 2. Mock pre-trip check creation
      mockBusPreTripCheckCreate.mockResolvedValueOnce({
        id: 'check-school-01',
        scheduleId: tripId,
        vehicleId,
        overallPass: false,
      });

      mockPrismaVehicleUpdate.mockResolvedValueOnce({
        id: vehicleId,
        status: 'GROUNDED',
        isActive: false,
      });

      // Failed inspection payload with a blocking failure: 'brakes' is blocking: true in SCHOOL_BUS_PRETRIP_CHECKLIST
      const req = new NextRequest(`http://localhost:3000/api/school-bus/trips/${tripId}/pretrip-check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-school-1',
          'x-user-id': 'driver-salem-id',
          'x-user-role': 'DRIVER',
        },
        body: JSON.stringify({
          items: [
            { key: 'brakes', ok: false, note: 'Brake pedal spongy, air pressure leaking' },
            { key: 'tyres_pressure', ok: true },
          ],
        }),
      });

      const res = await schoolBusPreTripPost(req, { params: Promise.resolve({ id: tripId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.assessment.overallPass).toBe(false);

      // Verify vehicle update was called with status GROUNDED and isActive false
      expect(mockPrismaVehicleUpdate).toHaveBeenCalledWith({
        where: { id: vehicleId },
        data: {
          status: 'GROUNDED',
          isActive: false,
        },
      });
    });

    it('CH-01-H: Bus-Ops pre-trip inspection failure grounds vehicle and updates notes with UNSAFE TO DEPART', async () => {
      const scheduleId = 'sched-bus-200';
      const vehicleId = 'veh-bus-ops-2';

      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([{ id: scheduleId }]);
      mockTripScheduleFindFirst.mockResolvedValueOnce({
        id: scheduleId,
        status: 'SCHEDULED',
        vehicleId,
        driverId: 'drv-200',
        notes: 'Morning express service',
      });

      mockBusPreTripCheckCreate.mockResolvedValueOnce({
        id: 'check-bus-02',
        scheduleId,
        vehicleId,
        overallPass: false,
      });

      mockTripScheduleUpdate.mockResolvedValueOnce({
        id: scheduleId,
      });
      mockPrismaVehicleUpdate.mockResolvedValueOnce({
        id: vehicleId,
        status: 'GROUNDED',
        isActive: false,
      });

      // Provide all 10 required items in PRETRIP_CHECKLIST, with brakes failed (blocking: true)
      const items = PRETRIP_CHECKLIST.map((item) => ({
        key: item.key,
        ok: item.key === 'brakes' ? false : true,
        note: item.key === 'brakes' ? 'Air brake reservoir below safe threshold' : undefined,
      }));

      const req = new NextRequest(`http://localhost:3000/api/bus-ops/schedules/${scheduleId}/pretrip-check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-bus-ops-1',
          'x-user-id': 'driver-kamal-id',
          'x-user-role': 'DRIVER',
        },
        body: JSON.stringify({ items }),
      });

      const res = await busOpsPreTripPost(req, { params: Promise.resolve({ id: scheduleId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.assessment.overallPass).toBe(false);

      // Verify notes updated with UNSAFE TO DEPART
      expect(mockTripScheduleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: scheduleId },
          data: expect.objectContaining({
            notes: expect.stringContaining('UNSAFE TO DEPART'),
          }),
        }),
      );

      // Verify vehicle grounded
      expect(mockPrismaVehicleUpdate).toHaveBeenCalledWith({
        where: { id: vehicleId },
        data: {
          status: 'GROUNDED',
          isActive: false,
        },
      });
    });

    it('CH-01-I: Passing pre-trip checks do NOT ground the vehicle', async () => {
      const scheduleId = 'sched-bus-300';
      const vehicleId = 'veh-bus-ops-3';

      mockPrismaQueryRawUnsafe.mockResolvedValueOnce([{ id: scheduleId }]);
      mockTripScheduleFindFirst.mockResolvedValueOnce({
        id: scheduleId,
        status: 'SCHEDULED',
        vehicleId,
        driverId: 'drv-300',
        notes: null,
      });

      mockBusPreTripCheckCreate.mockResolvedValueOnce({
        id: 'check-bus-03',
        scheduleId,
        vehicleId,
        overallPass: true,
      });

      const allOkItems = PRETRIP_CHECKLIST.map((item) => ({
        key: item.key,
        ok: true,
      }));

      const req = new NextRequest(`http://localhost:3000/api/bus-ops/schedules/${scheduleId}/pretrip-check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-bus-ops-1',
          'x-user-id': 'driver-kamal-id',
          'x-user-role': 'DRIVER',
        },
        body: JSON.stringify({ items: allOkItems }),
      });

      const res = await busOpsPreTripPost(req, { params: Promise.resolve({ id: scheduleId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.assessment.overallPass).toBe(true);

      // Vehicle must NOT be grounded
      expect(mockPrismaVehicleUpdate).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // CHALLENGE 2: Maintenance State Transitions & Lifecycle Reset
  // ============================================================================
  describe('Challenge 2: Maintenance State Transitions & Lifecycle Reset (F23)', () => {
    class TestableFleetMaintenanceConsumer extends FleetMaintenanceConsumer {
      public async testHandle(envelope: any): Promise<void> {
        return this.handle(envelope);
      }
    }

    it('CH-02-A: FleetMaintenanceConsumer resets status = AVAILABLE and is_active = true on work order completion', async () => {
      const consumer = new TestableFleetMaintenanceConsumer();
      const vehicleId = 'veh-maint-01';
      const requestId = 'req-wo-001';

      mockPrismaExecuteRawUnsafe.mockResolvedValueOnce(1); // 1 row updated

      await consumer.testHandle({
        eventId: 'evt-wo-comp-1',
        eventType: 'maintenance.work_order_completed',
        tenantId: 'tenant-fleet-1',
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId,
          completedAt: new Date().toISOString(),
          actualCostAed: 1250,
        },
      } as any);

      expect(mockPrismaExecuteRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(`UPDATE vehicles
          SET status     = 'AVAILABLE',
              is_active  = true,
              updated_at = NOW()
        WHERE id = $1
          AND status IN ('MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR')`),
        vehicleId,
      );
    });

    it('CH-02-B: FleetMaintenanceConsumer query strictly confines update to MAINTENANCE, IN_MAINTENANCE, and UNDER_REPAIR', async () => {
      const consumer = new TestableFleetMaintenanceConsumer();
      mockPrismaExecuteRawUnsafe.mockResolvedValueOnce(1);

      await consumer.testHandle({
        eventId: 'evt-wo-comp-2',
        eventType: 'maintenance.work_order_completed',
        tenantId: 'tenant-fleet-1',
        occurredAt: new Date(),
        data: {
          vehicleId: 'veh-under-repair-99',
          requestId: 'req-wo-002',
        },
      } as any);

      const executedSql = mockPrismaExecuteRawUnsafe.mock.calls[0][0];
      // Adversarial check: The SQL WHERE clause must contain the allowed maintenance statuses
      expect(executedSql).toContain("status IN ('MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR')");
      // Adversarial check: The SQL MUST NOT match 'GROUNDED' vehicles so safety grounding is preserved!
      expect(executedSql).not.toContain("'GROUNDED'");
    });

    it('CH-02-C: FleetMaintenanceConsumer gracefully handles missing vehicleId without crashing', async () => {
      const consumer = new TestableFleetMaintenanceConsumer();

      await consumer.testHandle({
        eventId: 'evt-wo-comp-3',
        eventType: 'maintenance.work_order_completed',
        tenantId: 'tenant-fleet-1',
        occurredAt: new Date(),
        data: {
          requestId: 'req-wo-no-veh',
        },
      } as any);

      expect(mockPrismaExecuteRawUnsafe).not.toHaveBeenCalled();
    });

    it('CH-02-D: FleetMaintenanceConsumer falls back to operational_status when canonical query fails', async () => {
      const consumer = new TestableFleetMaintenanceConsumer();
      const vehicleId = 'veh-fallback-01';

      // Primary query fails with error (e.g. column missing in legacy DB)
      mockPrismaExecuteRawUnsafe
        .mockRejectedValueOnce(new Error('relation vehicles does not have column is_active'))
        .mockResolvedValueOnce(1); // fallback succeeds

      await consumer.testHandle({
        eventId: 'evt-wo-comp-4',
        eventType: 'maintenance.work_order_completed',
        tenantId: 'tenant-fleet-1',
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-wo-004',
        },
      } as any);

      expect(mockPrismaExecuteRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockPrismaExecuteRawUnsafe.mock.calls[1][0]).toContain('operational_status = \'AVAILABLE\'');
    });
  });

  // ============================================================================
  // CHALLENGE 3: Multi-Vertical Fine & Toll Matching Engine
  // ============================================================================
  describe('Challenge 3: Multi-Vertical Fine & Toll Matching Engine (F27)', () => {
    const tenantId = 'tenant-multi-vert';
    const vehicleId = 'veh-truck-777';
    const violationDate = new Date('2026-09-15T10:30:00Z');

    it('CH-03-A: Matches Drayage & Logistics shipment orders with 85% confidence and DRIVER assignment', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) return [];
          if (query.includes('logistics_shipment_orders')) {
            return [
              {
                id: 'shipment-order-888',
                shipment_no: 'SHP-2026-888',
                assigned_driver_id: 'drv-logistics-1',
                cargo_owner_customer_id: 'cust-dhl-global',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-logistics-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 600,
        offenceType: 'SPEEDING',
      });

      expect(match.matchSource).toBe('LOGISTICS_SHIPMENT');
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-logistics-1');
      expect(match.shipmentId).toBe('shipment-order-888');
      expect(match.agreementNo).toBe('SHP-2026-888');
      expect(match.matchConfidence).toBe(85);
      expect(match.rechargeTarget).toBe('DRIVER');
    });

    it('CH-03-B: Matches Drayage shipment without assigned driver to LOGISTICS_CARRIER', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) return [];
          if (query.includes('logistics_shipment_orders')) {
            return [
              {
                id: 'shipment-order-889',
                shipment_no: 'SHP-CARRIER-ONLY',
                assigned_driver_id: null,
                cargo_owner_customer_id: 'cust-carrier-sub',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-carrier-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 1000,
        offenceType: 'OVERWEIGHT_AXLE',
      });

      expect(match.matchSource).toBe('LOGISTICS_SHIPMENT');
      expect(match.assignedTo).toBe('LOGISTICS_CARRIER');
      expect(match.rechargeTarget).toBe('CARRIER');
      expect(match.driverId).toBeNull();
    });

    it('CH-03-C: Matches Bus-Ops Trip Schedules with 85% confidence and DRIVER assignment', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) return [];
          if (query.includes('logistics_shipment_orders')) return [];
          if (query.includes('trip_schedules')) {
            return [
              {
                id: 'trip-bus-sched-501',
                schedule_number: 'BUS-SCHED-501',
                driver_id: 'drv-bus-ops-5',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-bus-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 400,
        offenceType: 'BUS_LANE_DEVIATION',
      });

      expect(match.matchSource).toBe('BUS_OPS_TRIP');
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-bus-ops-5');
      expect(match.tripId).toBe('trip-bus-sched-501');
      expect(match.agreementNo).toBe('BUS-SCHED-501');
      expect(match.matchConfidence).toBe(85);
    });

    it('CH-03-D: Matches School Bus Trips with 85% confidence and DRIVER assignment', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) return [];
          if (query.includes('logistics_shipment_orders')) return [];
          if (query.includes('trip_schedules')) return [];
          if (query.includes('school_bus_trips')) {
            return [
              {
                id: 'trip-school-701',
                route_name: 'ROUTE-JUMEIRAH-AM',
                driver_id: 'drv-school-7',
                driver_name: 'Rashid Al-Kindi',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-school-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 500,
        offenceType: 'SPEEDING_SCHOOL_ZONE',
      });

      expect(match.matchSource).toBe('SCHOOL_BUS_TRIP');
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-school-7');
      expect(match.driverName).toBe('Rashid Al-Kindi');
      expect(match.tripId).toBe('trip-school-701');
      expect(match.agreementNo).toBe('ROUTE-JUMEIRAH-AM');
      expect(match.matchConfidence).toBe(85);
    });

    it('CH-03-E: Matches Dispatch Jobs with 80% confidence and DRIVER assignment', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) return [];
          if (query.includes('logistics_shipment_orders')) return [];
          if (query.includes('trip_schedules')) return [];
          if (query.includes('school_bus_trips')) return [];
          if (query.includes('dispatch_jobs')) {
            return [
              {
                id: 'disp-job-909',
                job_number: 'JOB-EXP-909',
                driver_id: 'drv-dispatch-9',
                customer_id: 'cust-retail-mart',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-dispatch-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 400,
        offenceType: 'ILLEGAL_PARKING',
      });

      expect(match.matchSource).toBe('DISPATCH_JOB');
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('drv-dispatch-9');
      expect(match.dispatchJobId).toBe('disp-job-909');
      expect(match.agreementNo).toBe('JOB-EXP-909');
      expect(match.matchConfidence).toBe(80);
    });

    it('CH-03-F: Matches Corporate Lease Contracts with 90% confidence and LEASING_CUSTOMER assignment', async () => {
      const mockTx: any = {
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn(async (query: string) => {
          if (query.includes('rental_agreements')) return [];
          if (query.includes('lease_contracts_v2')) {
            return [
              {
                id: 'lease-contract-303',
                contract_number: 'LC-2026-303',
                customer_id: 'cust-emirates-corp',
              },
            ];
          }
          return [];
        }),
      };

      const match = await matchFineOrToll(mockTx, {
        fineId: 'fine-lease-01',
        tenantId,
        vehicleId,
        fineDate: violationDate,
        fineAmount: 800,
        offenceType: 'RED_LIGHT_VIOLATION',
      });

      expect(match.matchSource).toBe('LEASING_CONTRACT');
      expect(match.assignedTo).toBe('LEASING_CUSTOMER');
      expect(match.rechargeTarget).toBe('CUSTOMER');
      expect(match.leaseContractId).toBe('lease-contract-303');
      expect(match.agreementNo).toBe('LC-2026-303');
      expect(match.customerId).toBe('cust-emirates-corp');
      expect(match.matchConfidence).toBe(90);
    });

    it('CH-03-G: postFineMatchedGlEntry creates balanced 4-line GL clearing for recoverable fine', async () => {
      const fineAmount = 750;
      const fine = {
        id: 'fine-recoverable-01',
        fineAmount,
        fineDate: '2026-09-15T12:00:00Z',
        offenceType: 'SPEEDING',
        authority: 'Dubai Police',
      };
      const match = {
        assignedTo: 'DRIVER' as const,
      } as any;

      mockPostOperationalJournalEntry.mockResolvedValueOnce({
        id: 'je-fine-001',
        number: 'JE-202609-00001-ABCD',
        created: true,
      });

      await postFineMatchedGlEntry({} as any, tenantId, fine, match);

      expect(mockPostOperationalJournalEntry).toHaveBeenCalledTimes(1);
      const params = mockPostOperationalJournalEntry.mock.calls[0][1];

      expect(params.tenantId).toBe(tenantId);
      expect(params.sourceType).toBe('TRAFFIC_FINE');
      expect(params.sourceId).toBe('fine-recoverable-01');

      // Verify the 4 clearing GL lines
      const lines = params.lines;
      expect(lines).toHaveLength(4);

      // Line 1: AR 1100
      expect(lines[0].code).toBe('1100');
      expect(lines[0].debit).toBe(750);
      expect(lines[0].credit).toBe(0);

      // Line 2: Clearing 2160 (credit)
      expect(lines[1].code).toBe('2160');
      expect(lines[1].debit).toBe(0);
      expect(lines[1].credit).toBe(750);

      // Line 3: Clearing 2160 (debit)
      expect(lines[2].code).toBe('2160');
      expect(lines[2].debit).toBe(750);
      expect(lines[2].credit).toBe(0);

      // Line 4: AP 2000 (credit)
      expect(lines[3].code).toBe('2000');
      expect(lines[3].debit).toBe(0);
      expect(lines[3].credit).toBe(750);

      // Mathematical proof of double-entry balance:
      const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1500);

      // Mathematical proof of clearing account 2160 netting to 0:
      const clearingLines = lines.filter((l: any) => l.code === '2160');
      const clearingDebit = clearingLines.reduce((s: number, l: any) => s + l.debit, 0);
      const clearingCredit = clearingLines.reduce((s: number, l: any) => s + l.credit, 0);
      expect(clearingDebit - clearingCredit).toBe(0);
    });

    it('CH-03-H: postFineMatchedGlEntry creates balanced 2-line GL entry for company liability fine', async () => {
      const fineAmount = 1500;
      const fine = {
        id: 'fine-company-defect-01',
        fineAmount,
        fineDate: '2026-09-15T12:00:00Z',
        offenceType: 'EXPIRED_MULKIYA',
        authority: 'Abu Dhabi Police',
      };
      const match = {
        assignedTo: 'COMPANY' as const,
      } as any;

      mockPostOperationalJournalEntry.mockResolvedValueOnce({
        id: 'je-fine-002',
        number: 'JE-202609-00002-EFGH',
        created: true,
      });

      await postFineMatchedGlEntry({} as any, tenantId, fine, match);

      expect(mockPostOperationalJournalEntry).toHaveBeenCalledTimes(1);
      const params = mockPostOperationalJournalEntry.mock.calls[0][1];

      const lines = params.lines;
      expect(lines).toHaveLength(2);

      // Line 1: Operating Expense 5170
      expect(lines[0].code).toBe('5170');
      expect(lines[0].debit).toBe(1500);
      expect(lines[0].credit).toBe(0);

      // Line 2: Accounts Payable 2000
      expect(lines[1].code).toBe('2000');
      expect(lines[1].debit).toBe(0);
      expect(lines[1].credit).toBe(1500);

      const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1500);
    });

    it('CH-03-I: postFineMatchedGlEntry ignores non-positive fine amounts', async () => {
      const resZero = await postFineMatchedGlEntry({} as any, tenantId, { id: 'f0', fineAmount: 0 }, {} as any);
      expect(resZero).toBeNull();

      const resNeg = await postFineMatchedGlEntry({} as any, tenantId, { id: 'fneg', fineAmount: -50 }, {} as any);
      expect(resNeg).toBeNull();
      expect(mockPostOperationalJournalEntry).not.toHaveBeenCalled();
    });

    it('CH-03-J: batchAutoMatchTenantFines in dryRun mode computes matches without posting GL', async () => {
      const mockTx: any = {
        trafficFine: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'fine-batch-1',
              vehicleId: 'veh-batch-1',
              fineDate: new Date('2026-09-15T09:00:00Z'),
              fineAmount: 500,
              offenceType: 'EXPIRED_INSURANCE', // Company defect
              authority: 'RTA Dubai',
              assignedTo: null,
            },
          ]),
          update: vi.fn(),
        },
        driverShift: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      };

      const summary = await batchAutoMatchTenantFines(mockTx, tenantId, { dryRun: true });

      expect(summary.processedCount).toBe(1);
      expect(summary.assignedToCompanyCount).toBe(1);
      expect(summary.totalCompanyLiabilityAed).toBe(500);
      // In dryRun, update is NOT called
      expect(mockTx.trafficFine.update).not.toHaveBeenCalled();
      // In dryRun, GL entry is NOT posted
      expect(mockPostOperationalJournalEntry).not.toHaveBeenCalled();
    });
  });
});
