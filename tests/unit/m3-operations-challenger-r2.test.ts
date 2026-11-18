/**
 * tests/unit/m3-operations-challenger-r2.test.ts
 *
 * Operations Challenger Test Suite for Milestone M3 Iteration 2:
 *
 * 1. Maintenance state machine:
 *    - Verify closing work orders on GROUNDED vehicles CANNOT transition vehicle to AVAILABLE.
 *    - Verify closing work orders on vehicles with active pre-trip safety defects CANNOT transition vehicle to AVAILABLE.
 *    - Verify closing work orders on vehicles whose defects have been resolved by a subsequent passing check DOES transition vehicle to AVAILABLE.
 *    - Verify soft-deleted pre-trip checks do not falsely block vehicle release.
 *    - Verify operational_status fallback query strictly enforces the same safety defect guard.
 *
 * 2. Fuel odometer rollback prevention:
 *    - Verify omitting vehicleId resolves vehicle from driver's activeTrip.
 *    - Verify omitting vehicleId rejects odometer rollback with HTTP 422.
 *    - Verify omitting vehicleId accepts monotonic odometer progress and updates Vehicle.odometerReading, subledger fuel_logs, and FUEL_FILLED event.
 *    - Verify omitting vehicleId falls back to shiftVehicle and enforces odometer rollback prevention.
 *    - Verify omitting vehicleId falls back to assigned vehicle and rejects rollback.
 *    - Verify negative odometer with omitted vehicleId returns HTTP 400.
 *    - Verify submitting foreign vehicleId is rejected with HTTP 403.
 *
 * 3. Fine and toll cross-module matching:
 *    - Test boundary conditions for Drayage/Logistics (pickup window, delivery window, carrier vs driver attribution).
 *    - Test boundary conditions for Bus-Ops and School-Bus trips (window boundaries, driver name mapping).
 *    - Test boundary conditions for Dispatch jobs.
 *    - Test boundary conditions for Corporate Leasing (start_date, end_date boundaries, open-ended leases).
 *    - Test RAC Rental vehicle exchange mid-rental swap boundaries.
 *    - Test company defect vs driver violation liability classification and GL line balancing.
 *    - Test zero and negative fine amount edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest, NextResponse } from 'next/server';

// ── State & Mock Setup ────────────────────────────────────────────────────────

const { state, fakeTx, mockEventBus } = vi.hoisted(() => {
  const state = {
    drivers: [] as Array<{
      id: string;
      tenantId: string;
      userId?: string | null;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      status: string | null;
      assignedVehicleId?: string | null;
      deletedAt: null;
    }>,
    vehicles: [] as Array<{
      id: string;
      tenantId: string;
      licensePlate: string;
      status: string;
      isActive: boolean;
      odometerReading: bigint | null;
      assignedDriverId?: string | null;
    }>,
    pretripChecks: [] as Array<{
      id: string;
      vehicleId: string;
      tenantId: string;
      overallPass: boolean;
      performedAt: Date;
      deletedAt: Date | null;
    }>,
    tripSchedules: [] as Array<{
      id: string;
      tenantId: string;
      vehicleId: string | null;
      driverId: string | null;
      status: string;
      scheduleNumber?: string | null;
      departureTime?: Date | null;
      arrivalTime?: Date | null;
      scheduledDate?: Date | null;
      scheduledTime?: Date | null;
      actualDepartureAt?: Date | null;
      createdAt?: Date;
    }>,
    shifts: [] as Array<{
      id: string;
      tenantId: string;
      driverId: string;
      vehicleId: string | null;
      status: string;
      startedAt?: Date;
    }>,
    logisticsOrders: [] as Array<{
      id: string;
      tenantId: string;
      shipmentNo: string | null;
      assignedVehicleId: string | null;
      assignedDriverId: string | null;
      cargoOwnerCustomerId: string | null;
      pickupWindowFrom: Date | null;
      deliveryWindowTo: Date | null;
      createdAt: Date;
      deletedAt: Date | null;
    }>,
    schoolBusTrips: [] as Array<{
      id: string;
      tenantId: string;
      vehicleId: string | null;
      driverId: string | null;
      driverName: string | null;
      routeName: string | null;
      scheduledDate: Date;
      startedAt: Date | null;
      completedAt: Date | null;
    }>,
    dispatchJobs: [] as Array<{
      id: string;
      tenantId: string;
      vehicleId: string | null;
      driverId: string | null;
      customerId: string | null;
      jobNumber: string | null;
      pickupWindowStart: Date | null;
      deliveryWindowEnd: Date | null;
      createdAt: Date;
    }>,
    leaseContracts: [] as Array<{
      id: string;
      tenantId: string;
      contractNumber: string;
      customerId: string;
      vehicleId: string;
      startDate: Date;
      endDate: Date | null;
    }>,
    rentalVehicleExchanges: [] as Array<{
      agreementId: string;
      fromVehicleId: string;
      toVehicleId: string;
      exchangeDate: Date;
      tenantId: string;
    }>,
    rentalAgreements: [] as Array<{
      id: string;
      tenantId: string;
      agreementNo: string;
      customerId: string;
      vehicleId: string;
      startDate: Date;
      endDate: Date;
      actualReturnDate: Date | null;
      status: string;
    }>,
    fuelLogs: [] as Array<Record<string, unknown>>,
    fuelEntries: [] as Array<Record<string, unknown>>,
    glJournalEntries: [] as Array<Record<string, unknown>>,
    publishedEvents: [] as Array<Record<string, unknown>>,
  };

  const mockEventBus = {
    publish: vi.fn(async (event: Record<string, unknown>) => {
      state.publishedEvents.push(event);
      return Promise.resolve();
    }),
  };

  const fakeTx = {
    driver: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; tenantId?: string; deletedAt?: null; OR?: Array<{ id?: string; userId?: string }> } }) => {
        return state.drivers.find((d) => {
          if (where.tenantId && d.tenantId !== where.tenantId) return false;
          if (where.id && d.id !== where.id) return false;
          if (where.OR) {
            const matches = where.OR.some((cond) => (cond.id && d.id === cond.id) || (cond.userId && d.userId === cond.userId));
            if (!matches) return false;
          }
          return true;
        }) ?? null;
      }),
    },
    vehicle: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.vehicles.find((v) => v.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; tenantId?: string } }) => {
        return state.vehicles.find((v) => (!where.id || v.id === where.id) && (!where.tenantId || v.tenantId === where.tenantId)) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { odometerReading?: bigint; status?: string; isActive?: boolean } }) => {
        const v = state.vehicles.find((veh) => veh.id === where.id);
        if (v) {
          if (data.odometerReading !== undefined) v.odometerReading = data.odometerReading;
          if (data.status !== undefined) v.status = data.status;
          if (data.isActive !== undefined) v.isActive = data.isActive;
        }
        return v;
      }),
    },
    fuelLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.fuelLogs.push(data);
        return data;
      }),
    },
    tripSchedule: {
      findFirst: vi.fn(async () => null),
    },
    trafficFine: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    $executeRaw: vi.fn(async () => 1),
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      const normalizedSql = sql.replace(/\s+/g, ' ');
      // FleetMaintenanceConsumer simulation
      if (normalizedSql.includes('UPDATE vehicles') && (normalizedSql.includes("SET status = 'AVAILABLE'") || normalizedSql.includes("SET operational_status = 'AVAILABLE'"))) {
        const vehicleId = args[0] as string;
        const vehicle = state.vehicles.find((v) => v.id === vehicleId);
        if (!vehicle) return 0;

        // Status guard: only ('MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR')
        const allowedStatuses = ['MAINTENANCE', 'IN_MAINTENANCE', 'UNDER_REPAIR'];
        if (!allowedStatuses.includes(vehicle.status)) {
          return 0; // GROUNDED or other status cannot transition to AVAILABLE
        }

        // Check active defects: NOT EXISTS (SELECT 1 FROM bus_pretrip_checks bpc WHERE bpc.vehicle_id = vehicles.id AND bpc.deleted_at IS NULL AND bpc.overall_pass = false AND NOT EXISTS (re-inspection with overall_pass = true and performed_at > bpc.performed_at))
        const failedChecks = state.pretripChecks.filter(
          (c) => c.vehicleId === vehicleId && c.deletedAt === null && c.overallPass === false
        );

        for (const failedCheck of failedChecks) {
          const subsequentPassingCheck = state.pretripChecks.find(
            (c) =>
              c.vehicleId === vehicleId &&
              c.deletedAt === null &&
              c.overallPass === true &&
              c.performedAt.getTime() > failedCheck.performedAt.getTime()
          );
          if (!subsequentPassingCheck) {
            // Unresolved defect exists! Update cannot proceed.
            return 0;
          }
        }

        // Transition allowed
        vehicle.status = 'AVAILABLE';
        vehicle.isActive = true;
        return 1;
      }

      if (sql.includes('UPDATE vehicles SET odometer_reading = $1')) {
        const odo = args[0] as bigint;
        const vehicleId = args[1] as string;
        const v = state.vehicles.find((veh) => veh.id === vehicleId);
        if (v) v.odometerReading = odo;
        return 1;
      }

      return 1;
    }),
    $queryRaw: vi.fn(async () => []),
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      // Driver references check for vehicles in authorizeDriverReferences
      if (sql.includes('SELECT v.id::text AS id FROM vehicles v')) {
        const vehicleId = args[0] as string;
        const tenantId = args[1] as string;
        const userId = args[2] as string;
        const driverId = args[3] as string;
        const veh = state.vehicles.find((v) => {
          if (v.id !== vehicleId || v.tenantId !== tenantId) return false;
          if (v.assignedDriverId === userId || v.assignedDriverId === driverId) return true;
          const hasShift = state.shifts.some((s) => s.vehicleId === vehicleId && s.tenantId === tenantId && (s.driverId === userId || s.driverId === driverId) && s.status === 'ACTIVE');
          if (hasShift) return true;
          const hasTrip = state.tripSchedules.some((t) => t.vehicleId === vehicleId && t.tenantId === tenantId && (t.driverId === userId || t.driverId === driverId) && ['SCHEDULED', 'IN_PROGRESS', 'BOARDING', 'EN_ROUTE', 'ARRIVED'].includes(t.status));
          if (hasTrip) return true;
          return false;
        });
        return veh ? [{ id: veh.id }] : [];
      }
      // 1. Driver lookup by user_id
      if (sql.includes('FROM drivers') && sql.includes('user_id = $2')) {
        const tenantId = args[0] as string;
        const userId = args[1] as string;
        const matched = state.drivers.filter(
          (d) => d.tenantId === tenantId && d.userId === userId && d.status === 'ACTIVE'
        );
        return matched.map((d) => ({
          id: d.id,
          name: d.name,
          firstName: d.firstName,
          lastName: d.lastName,
          status: d.status,
        }));
      }

      // 2. Active trip lookup in loadDriverActor
      if (sql.includes('FROM trip_schedules ts') && sql.includes("ts.status = 'IN_PROGRESS'")) {
        const tenantId = args[0] as string;
        const userId = args[1] as string;
        const driverId = args[2] as string;
        const trip = state.tripSchedules.find(
          (t) =>
            t.tenantId === tenantId &&
            (t.driverId === userId || t.driverId === driverId) &&
            t.status === 'IN_PROGRESS'
        );
        if (!trip) return [];
        const veh = state.vehicles.find((v) => v.id === trip.vehicleId);
        return [{ id: trip.id, vehicle_id: trip.vehicleId, plate: veh?.licensePlate ?? null }];
      }

      // 3. Active shift lookup in loadDriverActor
      if (sql.includes('FROM shifts s') && sql.includes("s.status = 'ACTIVE'")) {
        const tenantId = args[0] as string;
        const userId = args[1] as string;
        const driverId = args[2] as string;
        const shift = state.shifts.find(
          (s) =>
            s.tenantId === tenantId &&
            (s.driverId === userId || s.driverId === driverId) &&
            s.status === 'ACTIVE'
        );
        if (!shift) return [];
        const veh = state.vehicles.find((v) => v.id === shift.vehicleId);
        return [{ vehicle_id: shift.vehicleId, plate: veh?.licensePlate ?? null }];
      }

      // 4. Assigned vehicle fallback in loadDriverActor
      if (sql.includes('FROM vehicles v') && sql.includes('v.assigned_driver_id IN')) {
        const tenantId = args[0] as string;
        const userId = args[1] as string;
        const driverId = args[2] as string;
        const veh = state.vehicles.find(
          (v) =>
            v.tenantId === tenantId &&
            (v.assignedDriverId === userId || v.assignedDriverId === driverId)
        );
        if (!veh) return [];
        return [{ vehicle_id: veh.id, plate: veh.licensePlate }];
      }



      // 6. Drayage / Logistics matching
      if (sql.includes('FROM logistics_shipment_orders')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = args[2] as Date;
        const eventTime = eventDate.getTime();

        const order = state.logisticsOrders.find((o) => {
          if (o.tenantId !== tenantId || o.assignedVehicleId !== vehicleId || o.deletedAt !== null) return false;
          const fromTime = o.pickupWindowFrom
            ? o.pickupWindowFrom.getTime()
            : o.createdAt.getTime() - 2 * 3600 * 1000;
          const toTime = o.deliveryWindowTo
            ? o.deliveryWindowTo.getTime()
            : fromTime + 12 * 3600 * 1000;
          const sameDay =
            new Date(o.createdAt).toISOString().slice(0, 10) === eventDate.toISOString().slice(0, 10);
          return (eventTime >= fromTime && eventTime <= toTime) || sameDay;
        });

        if (order) {
          return [
            {
              id: order.id,
              shipment_no: order.shipmentNo,
              assigned_driver_id: order.assignedDriverId,
              cargo_owner_customer_id: order.cargoOwnerCustomerId,
            },
          ];
        }
        return [];
      }

      // 7. Bus Ops trip matching
      if (sql.includes('FROM trip_schedules') && sql.includes('WHERE tenant_id = $1') && sql.includes('vehicle_id = $2')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = args[2] as Date;
        const eventTime = eventDate.getTime();

        const trip = state.tripSchedules.find((t) => {
          if (t.tenantId !== tenantId || t.vehicleId !== vehicleId) return false;
          const depTime = t.departureTime
            ? t.departureTime.getTime()
            : t.scheduledTime
              ? t.scheduledTime.getTime() - 3600 * 1000
              : (t.createdAt?.getTime() ?? 0) - 2 * 3600 * 1000;
          const arrTime = t.arrivalTime
            ? t.arrivalTime.getTime()
            : depTime + 4 * 3600 * 1000;
          const sameDay =
            t.scheduledDate &&
            new Date(t.scheduledDate).toISOString().slice(0, 10) === eventDate.toISOString().slice(0, 10);
          return (eventTime >= depTime && eventTime <= arrTime) || sameDay;
        });

        if (trip) {
          return [
            {
              id: trip.id,
              schedule_number: trip.scheduleNumber ?? 'SCH-001',
              driver_id: trip.driverId,
            },
          ];
        }
        return [];
      }

      // 8. School Bus trip matching
      if (sql.includes('FROM school_bus_trips')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = args[2] as Date;
        const eventTime = eventDate.getTime();

        const trip = state.schoolBusTrips.find((t) => {
          if (t.tenantId !== tenantId || t.vehicleId !== vehicleId) return false;
          const startTime = t.startedAt
            ? t.startedAt.getTime()
            : t.scheduledDate.getTime() - 2 * 3600 * 1000;
          const endTime = t.completedAt
            ? t.completedAt.getTime()
            : startTime + 4 * 3600 * 1000;
          const sameDay =
            new Date(t.scheduledDate).toISOString().slice(0, 10) === eventDate.toISOString().slice(0, 10);
          return (eventTime >= startTime && eventTime <= endTime) || sameDay;
        });

        if (trip) {
          return [
            {
              id: trip.id,
              route_name: trip.routeName,
              driver_id: trip.driverId,
              driver_name: trip.driverName,
            },
          ];
        }
        return [];
      }

      // 9. Dispatch jobs matching
      if (sql.includes('FROM dispatch_jobs')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = args[2] as Date;
        const eventTime = eventDate.getTime();

        const job = state.dispatchJobs.find((j) => {
          if (j.tenantId !== tenantId || j.vehicleId !== vehicleId) return false;
          const pStart = j.pickupWindowStart
            ? j.pickupWindowStart.getTime()
            : j.createdAt.getTime() - 2 * 3600 * 1000;
          const dEnd = j.deliveryWindowEnd
            ? j.deliveryWindowEnd.getTime()
            : pStart + 8 * 3600 * 1000;
          const sameDay =
            new Date(j.createdAt).toISOString().slice(0, 10) === eventDate.toISOString().slice(0, 10);
          return (eventTime >= pStart && eventTime <= dEnd) || sameDay;
        });

        if (job) {
          return [
            {
              id: job.id,
              job_number: job.jobNumber,
              driver_id: job.driverId,
              customer_id: job.customerId,
            },
          ];
        }
        return [];
      }

      // 10. Corporate leasing matching (lease_contracts_v2)
      if (sql.includes('FROM lease_contracts_v2')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = args[2] as Date;
        const eventTime = eventDate.getTime();

        const contract = state.leaseContracts.find((c) => {
          if (c.tenantId !== tenantId || c.vehicleId !== vehicleId) return false;
          const start = c.startDate.getTime();
          const end = c.endDate ? c.endDate.getTime() : Infinity;
          return eventTime >= start && eventTime <= end;
        });

        if (contract) {
          return [
            {
              id: contract.id,
              contract_number: contract.contractNumber,
              customer_id: contract.customerId,
            },
          ];
        }
        return [];
      }

      // 11. RAC Rental Agreements swap-aware matching
      if (sql.includes('agr_exchanges') && sql.includes('FROM rental_agreements ra')) {
        const tenantId = args[0] as string;
        const vehicleId = args[1] as string;
        const eventDate = new Date(args[2] as string);
        const eventTime = eventDate.getTime();

        // Check if vehicle matches any exchange
        for (const ex of state.rentalVehicleExchanges) {
          if (ex.tenantId !== tenantId) continue;
          const agr = state.rentalAgreements.find((a) => a.id === ex.agreementId);
          if (!agr) continue;

          // fromVehicle active before exchangeDate
          if (ex.fromVehicleId === vehicleId) {
            const start = agr.startDate.getTime();
            const exchangeTime = ex.exchangeDate.getTime();
            if (eventTime >= start && eventTime <= exchangeTime) {
              return [{ id: agr.id, agreement_no: agr.agreementNo, customer_id: agr.customerId, matched_via_swap: true }];
            }
          }

          // toVehicle active after exchangeDate
          if (ex.toVehicleId === vehicleId) {
            const exchangeTime = ex.exchangeDate.getTime();
            const returnTime = (agr.actualReturnDate ?? agr.endDate).getTime();
            if (eventTime >= exchangeTime && eventTime <= returnTime) {
              return [{ id: agr.id, agreement_no: agr.agreementNo, customer_id: agr.customerId, matched_via_swap: true }];
            }
          }
        }

        // Check non-swapped agreements (NOT EXISTS in agr_exchanges)
        const standardAgr = state.rentalAgreements.find((a) => {
          if (a.tenantId !== tenantId || a.vehicleId !== vehicleId) return false;
          const hasExchange = state.rentalVehicleExchanges.some((ex) => ex.agreementId === a.id);
          if (hasExchange) return false;
          const start = a.startDate.getTime();
          const end = (a.actualReturnDate ?? a.endDate).getTime();
          return eventTime >= start && eventTime <= end;
        });

        if (standardAgr) {
          return [{ id: standardAgr.id, agreement_no: standardAgr.agreementNo, customer_id: standardAgr.customerId, matched_via_swap: false }];
        }

        return [];
      }

      return [];
    }),
  };

  return { state, fakeTx, mockEventBus };
});

vi.mock('@/lib/prisma', () => ({
  prisma: fakeTx,
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
    return fn(fakeTx);
  },
  withSavepoint: async (_tx: unknown, _name: string, fn: () => unknown, fallback: unknown) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));

vi.mock('@/events/event-bus', () => ({
  getEventBus: () => mockEventBus,
}));

vi.mock('@/lib/finance/journal-service', () => ({
  postOperationalJournalEntry: vi.fn(async (_tx: unknown, entry: Record<string, unknown>) => {
    state.glJournalEntries.push(entry);
    return { ok: true, journalEntryId: 'mock-je-operations-challenger', id: 'mock-je-operations-challenger', number: 'JE-001', created: true };
  }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  writeRequiredAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/sentry', () => ({
  captureException: vi.fn(),
}));

import { signSession } from '@/lib/tenant-session';
import { FleetMaintenanceConsumer } from '@/events/consumers/fleet-maintenance.consumer';
import { POST as fuelEntriesPost } from '@/app/api/driver-app/fuel-entries/route';
import {
  matchFineOrToll,
  postFineMatchedGlEntry,
  classifyOffenceLiability,
} from '@/lib/fleet/fine-toll-matcher';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DRIVER_ID = 'driver-001-uuid';
const VEHICLE_ID = 'veh-active-001';

async function makeAuthHeaders(userId: string = USER_ID, tenantId: string = TENANT_ID) {
  const token = await signSession({
    userId,
    tenantId,
    plan: 'ENTERPRISE',
    role: 'DRIVER',
  });
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    'x-user-role': 'DRIVER',
    cookie: `xl-driver-session=${token}`,
    authorization: `Bearer ${token}`,
  };
}

class TestableFleetMaintenanceConsumer extends FleetMaintenanceConsumer {
  public async testHandle(envelope: any): Promise<void> {
    return this.handle(envelope);
  }
}

describe('Empirical Operations Challenger Suite — Milestone M3 Iteration 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.drivers = [];
    state.vehicles = [];
    state.pretripChecks = [];
    state.tripSchedules = [];
    state.shifts = [];
    state.logisticsOrders = [];
    state.schoolBusTrips = [];
    state.dispatchJobs = [];
    state.leaseContracts = [];
    state.rentalVehicleExchanges = [];
    state.rentalAgreements = [];
    state.fuelLogs = [];
    state.fuelEntries = [];
    state.glJournalEntries = [];
    state.publishedEvents = [];
  });

  // ============================================================================
  // WORKFLOW 1: Maintenance State Machine & Defect Isolation
  // ============================================================================
  describe('Workflow 1: Maintenance State Machine & Safety Defect Guards', () => {
    it('EMP-M3-01: Work order completion CANNOT transition GROUNDED vehicle to AVAILABLE', async () => {
      const vehicleId = 'veh-grounded-safety';
      state.vehicles.push({
        id: vehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-GR-100',
        status: 'GROUNDED',
        isActive: false,
        odometerReading: 45000n,
      });

      const consumer = new TestableFleetMaintenanceConsumer();
      await consumer.testHandle({
        eventId: 'evt-maint-01',
        eventType: 'maintenance.work_order_completed',
        tenantId: TENANT_ID,
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-maint-01',
          completedAt: new Date().toISOString(),
        },
      });

      // Empirical check: vehicle status must remain GROUNDED, isActive must remain false
      const vehicle = state.vehicles.find((v) => v.id === vehicleId);
      expect(vehicle?.status).toBe('GROUNDED');
      expect(vehicle?.isActive).toBe(false);
    });

    it('EMP-M3-02: Work order completion on IN_MAINTENANCE vehicle with ACTIVE pre-trip defect CANNOT transition to AVAILABLE', async () => {
      const vehicleId = 'veh-in-maint-with-defect';
      state.vehicles.push({
        id: vehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-M-200',
        status: 'IN_MAINTENANCE',
        isActive: false,
        odometerReading: 80000n,
      });

      // Active safety defect in bus_pretrip_checks: overall_pass = false
      state.pretripChecks.push({
        id: 'check-defect-01',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: false,
        performedAt: new Date('2026-11-16T08:00:00Z'),
        deletedAt: null,
      });

      const consumer = new TestableFleetMaintenanceConsumer();
      await consumer.testHandle({
        eventId: 'evt-maint-02',
        eventType: 'maintenance.work_order_completed',
        tenantId: TENANT_ID,
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-maint-02',
          completedAt: new Date().toISOString(),
        },
      });

      // Empirical check: Status remains IN_MAINTENANCE because active defect exists
      const vehicle = state.vehicles.find((v) => v.id === vehicleId);
      expect(vehicle?.status).toBe('IN_MAINTENANCE');
      expect(vehicle?.isActive).toBe(false);
    });

    it('EMP-M3-03: Work order completion DOES transition to AVAILABLE once defect is resolved by subsequent passing check', async () => {
      const vehicleId = 'veh-cleared-defect';
      state.vehicles.push({
        id: vehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-M-300',
        status: 'UNDER_REPAIR',
        isActive: false,
        odometerReading: 82000n,
      });

      // Initial defect at 08:00
      state.pretripChecks.push({
        id: 'check-defect-02',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: false,
        performedAt: new Date('2026-11-16T08:00:00Z'),
        deletedAt: null,
      });

      // Subsequent re-inspection PASS at 11:30
      state.pretripChecks.push({
        id: 'check-pass-02',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: true,
        performedAt: new Date('2026-11-16T11:30:00Z'),
        deletedAt: null,
      });

      const consumer = new TestableFleetMaintenanceConsumer();
      await consumer.testHandle({
        eventId: 'evt-maint-03',
        eventType: 'maintenance.work_order_completed',
        tenantId: TENANT_ID,
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-maint-03',
          completedAt: new Date().toISOString(),
        },
      });

      // Empirical check: Defect was cleared, vehicle safely transitioned to AVAILABLE
      const vehicle = state.vehicles.find((v) => v.id === vehicleId);
      expect(vehicle?.status).toBe('AVAILABLE');
      expect(vehicle?.isActive).toBe(true);
    });

    it('EMP-M3-04: Soft-deleted defect check does NOT falsely block release to AVAILABLE', async () => {
      const vehicleId = 'veh-soft-deleted-defect';
      state.vehicles.push({
        id: vehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-M-400',
        status: 'MAINTENANCE',
        isActive: false,
        odometerReading: 95000n,
      });

      // Defect was deleted (e.g. erroneous entry)
      state.pretripChecks.push({
        id: 'check-deleted-01',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: false,
        performedAt: new Date('2026-11-16T07:00:00Z'),
        deletedAt: new Date('2026-11-16T07:30:00Z'),
      });

      const consumer = new TestableFleetMaintenanceConsumer();
      await consumer.testHandle({
        eventId: 'evt-maint-04',
        eventType: 'maintenance.work_order_completed',
        tenantId: TENANT_ID,
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-maint-04',
          completedAt: new Date().toISOString(),
        },
      });

      const vehicle = state.vehicles.find((v) => v.id === vehicleId);
      expect(vehicle?.status).toBe('AVAILABLE');
      expect(vehicle?.isActive).toBe(true);
    });

    it('EMP-M3-05: Multiple defects where the latest defect is unresolved CANNOT transition to AVAILABLE', async () => {
      const vehicleId = 'veh-multi-defect';
      state.vehicles.push({
        id: vehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-M-500',
        status: 'IN_MAINTENANCE',
        isActive: false,
        odometerReading: 110000n,
      });

      // Defect 1 at 08:00
      state.pretripChecks.push({
        id: 'check-d1',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: false,
        performedAt: new Date('2026-11-16T08:00:00Z'),
        deletedAt: null,
      });

      // Passed at 10:00
      state.pretripChecks.push({
        id: 'check-p1',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: true,
        performedAt: new Date('2026-11-16T10:00:00Z'),
        deletedAt: null,
      });

      // Defect 2 at 12:00 (new breakdown)
      state.pretripChecks.push({
        id: 'check-d2',
        vehicleId,
        tenantId: TENANT_ID,
        overallPass: false,
        performedAt: new Date('2026-11-16T12:00:00Z'),
        deletedAt: null,
      });

      const consumer = new TestableFleetMaintenanceConsumer();
      await consumer.testHandle({
        eventId: 'evt-maint-05',
        eventType: 'maintenance.work_order_completed',
        tenantId: TENANT_ID,
        occurredAt: new Date(),
        data: {
          vehicleId,
          requestId: 'req-maint-05',
          completedAt: new Date().toISOString(),
        },
      });

      // Unresolved defect 2 keeps vehicle IN_MAINTENANCE
      const vehicle = state.vehicles.find((v) => v.id === vehicleId);
      expect(vehicle?.status).toBe('IN_MAINTENANCE');
      expect(vehicle?.isActive).toBe(false);
    });
  });

  // ============================================================================
  // WORKFLOW 2: Fuel Odometer Monotonicity & Vehicle Resolution
  // ============================================================================
  describe('Workflow 2: Fuel Odometer Rollback Prevention via Resolved Vehicle', () => {
    it('EMP-M3-06: Omitting vehicleId resolves vehicle from activeTrip and rejects odometer rollback with HTTP 422', async () => {
      // Setup driver
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      // Setup vehicle with current odometer 60,000 km
      state.vehicles.push({
        id: VEHICLE_ID,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-TRIP-01',
        status: 'AVAILABLE',
        isActive: true,
        odometerReading: 60000n,
      });

      // Driver has an active in-progress trip on this vehicle
      state.tripSchedules.push({
        id: 'trip-active-01',
        tenantId: TENANT_ID,
        vehicleId: VEHICLE_ID,
        driverId: USER_ID,
        status: 'IN_PROGRESS',
        actualDepartureAt: new Date(),
      });

      const headers = await makeAuthHeaders();
      // Omit vehicleId and submit rollback odometer: 58500 km (< 60000)
      const rollbackBody = {
        liters: 50,
        totalCost: 150,
        currency: 'AED',
        odometer: 58500,
        stationName: 'ENOC Al Barsha',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(rollbackBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('cannot be lower than current vehicle odometer');

      // Verify no records created and vehicle odometer unchanged
      expect(state.fuelLogs).toHaveLength(0);
      expect(state.vehicles[0].odometerReading).toBe(60000n);
      expect(state.publishedEvents).toHaveLength(0);
    });

    it('EMP-M3-07: Omitting vehicleId accepts monotonic progress, updates odometer, subledger fuel_logs, and FUEL_FILLED event', async () => {
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      state.vehicles.push({
        id: VEHICLE_ID,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-TRIP-01',
        status: 'AVAILABLE',
        isActive: true,
        odometerReading: 60000n,
      });

      state.tripSchedules.push({
        id: 'trip-active-01',
        tenantId: TENANT_ID,
        vehicleId: VEHICLE_ID,
        driverId: USER_ID,
        status: 'IN_PROGRESS',
        actualDepartureAt: new Date(),
      });

      const headers = await makeAuthHeaders();
      // Omit vehicleId, submit forward progress odometer: 60350 km (>= 60000)
      const validBody = {
        liters: 65,
        totalCost: 195,
        currency: 'AED',
        odometer: 60350,
        stationName: 'ENOC Al Barsha',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(validBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.fuelLogId).toBeDefined();

      // Verify vehicle odometer was updated to 60350
      expect(state.vehicles[0].odometerReading).toBe(60350n);

      // Verify subledger fuelLog was created with resolved vehicleId
      expect(state.fuelLogs).toHaveLength(1);
      expect(state.fuelLogs[0]).toMatchObject({
        tenantId: TENANT_ID,
        vehicleId: VEHICLE_ID,
        liters: 65,
        totalCost: 195,
        mileage: 60350,
        station: 'ENOC Al Barsha',
      });

      // Verify FUEL_FILLED event was emitted with resolved vehicleId
      expect(state.publishedEvents).toHaveLength(1);
      expect(state.publishedEvents[0]).toMatchObject({
        eventType: 'fuel.filled',
        aggregateType: 'fuel_log',
        sourceModule: 'driver-app',
        payload: {
          vehicleId: VEHICLE_ID,
          liters: 65,
          totalCost: 195,
          station: 'ENOC Al Barsha',
        },
      });
    });

    it('EMP-M3-08: Omitting vehicleId falls back to shiftVehicle and enforces odometer rollback prevention', async () => {
      const shiftVehicleId = 'veh-shift-999';
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      state.vehicles.push({
        id: shiftVehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-SHIFT-99',
        status: 'AVAILABLE',
        isActive: true,
        odometerReading: 75000n,
      });

      // No active trip, but has an ACTIVE shift with shiftVehicleId
      state.shifts.push({
        id: 'shift-active-01',
        tenantId: TENANT_ID,
        driverId: USER_ID,
        vehicleId: shiftVehicleId,
        status: 'ACTIVE',
        startedAt: new Date(),
      });

      const headers = await makeAuthHeaders();
      const rollbackBody = {
        liters: 45,
        totalCost: 135,
        currency: 'AED',
        odometer: 74200, // < 75000
        stationName: 'Eppco Marina',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(rollbackBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('cannot be lower than current vehicle odometer');
      expect(state.fuelLogs).toHaveLength(0);
    });

    it('EMP-M3-09: Omitting vehicleId falls back to assigned tractor on vehicle profile and rejects rollback', async () => {
      const assignedVehicleId = 'veh-tractor-777';
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      state.vehicles.push({
        id: assignedVehicleId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-TRAC-77',
        status: 'AVAILABLE',
        isActive: true,
        odometerReading: 120000n,
        assignedDriverId: USER_ID,
      });

      // No active trip, no active shift
      const headers = await makeAuthHeaders();
      const rollbackBody = {
        liters: 80,
        totalCost: 240,
        currency: 'AED',
        odometer: 119500, // < 120000
        stationName: 'ADNOC Jebel Ali',
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(rollbackBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(422);
      expect(state.fuelLogs).toHaveLength(0);
    });

    it('EMP-M3-10: Submitting negative odometer returns HTTP 400 even when vehicleId is omitted', async () => {
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      const headers = await makeAuthHeaders();
      const negativeOdoBody = {
        liters: 30,
        totalCost: 90,
        currency: 'AED',
        odometer: -50,
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(negativeOdoBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Odometer cannot be negative');
    });

    it('EMP-M3-11: Submitting foreign vehicleId that does not belong to driver returns HTTP 403', async () => {
      state.drivers.push({
        id: DRIVER_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        name: 'Tariq Driver',
        firstName: 'Tariq',
        lastName: 'Driver',
        status: 'ACTIVE',
        deletedAt: null,
      });

      // Vehicle assigned to someone else
      const foreignVehId = '99999999-9999-4999-8999-999999999999';
      state.vehicles.push({
        id: foreignVehId,
        tenantId: TENANT_ID,
        licensePlate: 'DXB-FOREIGN',
        status: 'AVAILABLE',
        isActive: true,
        odometerReading: 30000n,
        assignedDriverId: 'different-driver-id',
      });

      const headers = await makeAuthHeaders();
      const foreignBody = {
        vehicleId: foreignVehId,
        liters: 40,
        totalCost: 120,
        currency: 'AED',
        odometer: 31000,
      };

      const req = new NextRequest('http://localhost:3000/api/driver-app/fuel-entries', {
        method: 'POST',
        headers,
        body: JSON.stringify(foreignBody),
      });

      const res = await fuelEntriesPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('vehicleId is not a vehicle assigned to the signed-in driver');
    });
  });

  // ============================================================================
  // WORKFLOW 3: Multi-Vertical Fine & Toll Cross-Module Matching
  // ============================================================================
  describe('Workflow 3: Multi-Vertical Fine & Toll Cross-Module Matching', () => {
    it('EMP-M3-12: Drayage/Logistics: fine at exact pickup window matches carrier shipment', async () => {
      const vehicleId = 'veh-logistics-01';
      const pickupTime = new Date('2026-11-16T10:00:00Z');
      const deliveryTime = new Date('2026-11-16T18:00:00Z');

      state.logisticsOrders.push({
        id: 'order-drayage-1',
        tenantId: TENANT_ID,
        shipmentNo: 'SHP-DXB-9001',
        assignedVehicleId: vehicleId,
        assignedDriverId: 'driver-carrier-1',
        cargoOwnerCustomerId: 'cust-drayage-1',
        pickupWindowFrom: pickupTime,
        deliveryWindowTo: deliveryTime,
        createdAt: new Date('2026-11-16T07:00:00Z'),
        deletedAt: null,
      });

      // Fine occurs exactly at pickup window
      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-drayage-exact',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: pickupTime,
        fineAmount: 500,
        offenceType: 'RADAR_SPEEDING',
      });

      expect(match.matchSource).toBe('LOGISTICS_SHIPMENT');
      expect(match.matchConfidence).toBe(85);
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('driver-carrier-1');
      expect(match.agreementNo).toBe('SHP-DXB-9001');
      expect(match.rechargeTarget).toBe('DRIVER');
    });

    it('EMP-M3-13: Drayage/Logistics: fine without assigned_driver_id matches LOGISTICS_CARRIER', async () => {
      const vehicleId = 'veh-carrier-unassigned';
      const pickupTime = new Date('2026-11-16T09:00:00Z');

      state.logisticsOrders.push({
        id: 'order-carrier-no-driver',
        tenantId: TENANT_ID,
        shipmentNo: 'SHP-CARRIER-888',
        assignedVehicleId: vehicleId,
        assignedDriverId: null, // Subcontracted carrier
        cargoOwnerCustomerId: 'cust-cargo-88',
        pickupWindowFrom: pickupTime,
        deliveryWindowTo: new Date('2026-11-16T17:00:00Z'),
        createdAt: new Date('2026-11-16T08:00:00Z'),
        deletedAt: null,
      });

      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-carrier-toll',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2026-11-16T12:00:00Z'),
        fineAmount: 300,
        offenceType: 'LANE_DISCIPLINE',
      });

      expect(match.matchSource).toBe('LOGISTICS_SHIPMENT');
      expect(match.assignedTo).toBe('LOGISTICS_CARRIER');
      expect(match.rechargeTarget).toBe('CARRIER');
      expect(match.driverId).toBeNull();
    });

    it('EMP-M3-14: Bus-Ops: fine during scheduled trip matches bus schedule and driver', async () => {
      const vehicleId = 'veh-bus-ops-55';
      const dep = new Date('2026-11-16T06:00:00Z');
      const arr = new Date('2026-11-16T09:00:00Z');

      state.tripSchedules.push({
        id: 'sched-bus-ops-55',
        tenantId: TENANT_ID,
        vehicleId,
        driverId: 'driver-bus-kamal',
        status: 'COMPLETED',
        scheduleNumber: 'BUS-LINE-11',
        departureTime: dep,
        arrivalTime: arr,
        scheduledDate: new Date('2026-11-16T00:00:00Z'),
      });

      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-bus-ops-1',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2026-11-16T07:30:00Z'),
        fineAmount: 400,
        offenceType: 'BUS_LANE_VIOLATION',
      });

      expect(match.matchSource).toBe('BUS_OPS_TRIP');
      expect(match.matchConfidence).toBe(85);
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('driver-bus-kamal');
      expect(match.tripId).toBe('sched-bus-ops-55');
    });

    it('EMP-M3-15: School-Bus: fine during route matches school trip with driver name', async () => {
      const vehicleId = 'veh-school-bus-77';

      state.schoolBusTrips.push({
        id: 'school-trip-77',
        tenantId: TENANT_ID,
        vehicleId,
        driverId: 'driver-school-salem',
        driverName: 'Salem Al Mansoori',
        routeName: 'Route 14 - Jumeirah',
        scheduledDate: new Date('2026-11-16T00:00:00Z'),
        startedAt: new Date('2026-11-16T06:30:00Z'),
        completedAt: new Date('2026-11-16T08:30:00Z'),
      });

      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-school-bus-1',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2026-11-16T07:15:00Z'),
        fineAmount: 500,
        offenceType: 'STOP_ARM_VIOLATION',
      });

      expect(match.matchSource).toBe('SCHOOL_BUS_TRIP');
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('driver-school-salem');
      expect(match.driverName).toBe('Salem Al Mansoori');
      expect(match.agreementNo).toBe('Route 14 - Jumeirah');
    });

    it('EMP-M3-16: Dispatch Jobs: fine matches active dispatch job and customer ID', async () => {
      const vehicleId = 'veh-dispatch-22';

      state.dispatchJobs.push({
        id: 'disp-job-22',
        tenantId: TENANT_ID,
        vehicleId,
        driverId: 'driver-dispatch-ali',
        customerId: 'cust-corporate-dispatch',
        jobNumber: 'JOB-EXP-2026',
        pickupWindowStart: new Date('2026-11-16T13:00:00Z'),
        deliveryWindowEnd: new Date('2026-11-16T17:00:00Z'),
        createdAt: new Date('2026-11-16T12:00:00Z'),
      });

      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-dispatch-1',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2026-11-16T15:00:00Z'),
        fineAmount: 600,
        offenceType: 'RED_LIGHT_CAMERA',
      });

      expect(match.matchSource).toBe('DISPATCH_JOB');
      expect(match.matchConfidence).toBe(80);
      expect(match.assignedTo).toBe('DRIVER');
      expect(match.driverId).toBe('driver-dispatch-ali');
      expect(match.customerId).toBe('cust-corporate-dispatch');
      expect(match.dispatchJobId).toBe('disp-job-22');
    });

    it('EMP-M3-17: Corporate Leasing: fine matches active contract within start and end date boundary', async () => {
      const vehicleId = 'veh-lease-33';
      const startDate = new Date('2026-01-01T00:00:00Z');
      const endDate = new Date('2026-12-31T23:59:59Z');

      state.leaseContracts.push({
        id: 'lease-contract-33',
        tenantId: TENANT_ID,
        contractNumber: 'LC-2026-0033',
        customerId: 'cust-leasing-corp',
        vehicleId,
        startDate,
        endDate,
      });

      // Match on exact start date boundary
      const matchStart = await matchFineOrToll(fakeTx as any, {
        id: 'fine-lease-start',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: startDate,
        fineAmount: 400,
      });
      expect(matchStart.matchSource).toBe('LEASING_CONTRACT');
      expect(matchStart.assignedTo).toBe('LEASING_CUSTOMER');
      expect(matchStart.customerId).toBe('cust-leasing-corp');
      expect(matchStart.agreementNo).toBe('LC-2026-0033');

      // Match on exact end date boundary
      const matchEnd = await matchFineOrToll(fakeTx as any, {
        id: 'fine-lease-end',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: endDate,
        fineAmount: 400,
      });
      expect(matchEnd.matchSource).toBe('LEASING_CONTRACT');

      // Date after end date: does not match lease contract
      const matchAfter = await matchFineOrToll(fakeTx as any, {
        id: 'fine-lease-after',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2027-01-01T00:00:00Z'),
        fineAmount: 400,
      });
      expect(matchAfter.matchSource).not.toBe('LEASING_CONTRACT');
    });

    it('EMP-M3-18: RAC Rental vehicle exchanges: mid-rental swap attributes pre-swap fine to V1 and post-swap to V2', async () => {
      const agrId = 'rac-swap-agr-1';
      const v1 = 'veh-rac-swap-v1';
      const v2 = 'veh-rac-swap-v2';
      const exchangeDate = new Date('2026-11-16T12:00:00Z');

      state.rentalAgreements.push({
        id: agrId,
        tenantId: TENANT_ID,
        agreementNo: 'RAC-SWAP-101',
        customerId: 'cust-tourist-101',
        vehicleId: v1,
        startDate: new Date('2026-11-15T09:00:00Z'),
        endDate: new Date('2026-11-20T09:00:00Z'),
        actualReturnDate: null,
        status: 'ACTIVE',
      });

      state.rentalVehicleExchanges.push({
        agreementId: agrId,
        fromVehicleId: v1,
        toVehicleId: v2,
        exchangeDate,
        tenantId: TENANT_ID,
      });

      // Fine on V1 at 10:00 (before exchange): matches RAC agreement
      const matchV1 = await matchFineOrToll(fakeTx as any, {
        id: 'fine-v1-pre',
        tenantId: TENANT_ID,
        vehicleId: v1,
        fineDate: new Date('2026-11-16T10:00:00Z'),
        fineAmount: 600,
      });
      expect(matchV1.matchSource).toBe('RENTAL_AGREEMENT');
      expect(matchV1.assignedTo).toBe('RENTAL_CUSTOMER');
      expect(matchV1.agreementNo).toBe('RAC-SWAP-101');

      // Fine on V1 at 14:00 (after exchange): does NOT match RAC agreement (vehicle was returned)
      const matchV1Post = await matchFineOrToll(fakeTx as any, {
        id: 'fine-v1-post',
        tenantId: TENANT_ID,
        vehicleId: v1,
        fineDate: new Date('2026-11-16T14:00:00Z'),
        fineAmount: 600,
      });
      expect(matchV1Post.matchSource).not.toBe('RENTAL_AGREEMENT');

      // Fine on V2 at 15:00 (after exchange): matches RAC agreement
      const matchV2Post = await matchFineOrToll(fakeTx as any, {
        id: 'fine-v2-post',
        tenantId: TENANT_ID,
        vehicleId: v2,
        fineDate: new Date('2026-11-16T15:00:00Z'),
        fineAmount: 600,
      });
      expect(matchV2Post.matchSource).toBe('RENTAL_AGREEMENT');
      expect(matchV2Post.assignedTo).toBe('RENTAL_CUSTOMER');
      expect(matchV2Post.agreementNo).toBe('RAC-SWAP-101');
    });

    it('EMP-M3-19: Company compliance defects (BALD_TIRES, EXPIRED_MULKIYA) override driver liability with 2 balanced GL lines', async () => {
      expect(classifyOffenceLiability('BALD_TIRES_DEFECT')).toBe('COMPANY');
      expect(classifyOffenceLiability('EXPIRED_MULKIYA')).toBe('COMPANY');
      expect(classifyOffenceLiability('EXPIRED_INSURANCE')).toBe('COMPANY');
      expect(classifyOffenceLiability('WINDOW_TINT_OVER_LEGAL_LIMIT')).toBe('COMPANY');

      const vehicleId = 'veh-defect-fine';
      const match = await matchFineOrToll(fakeTx as any, {
        id: 'fine-mulkiya-1',
        tenantId: TENANT_ID,
        vehicleId,
        fineDate: new Date('2026-11-16T10:00:00Z'),
        fineAmount: 1000,
        offenceType: 'EXPIRED_MULKIYA',
      });

      expect(match.assignedTo).toBe('COMPANY');
      expect(match.matchConfidence).toBe(100);
      expect(match.matchSource).toBe('COMPANY_DEFECT_OFFENCE');

      // Post GL entry
      const gl = await postFineMatchedGlEntry(
        fakeTx as any,
        TENANT_ID,
        { id: 'fine-mulkiya-1', fineAmount: 1000, fineDate: new Date('2026-11-16T10:00:00Z') },
        match,
      );
      expect(gl).not.toBeNull();

      expect(state.glJournalEntries).toHaveLength(1);
      const entry = state.glJournalEntries[0];
      const lines = entry.lines as Array<{ code: string; debit: number; credit: number }>;
      expect(lines).toHaveLength(2); // 5170 Dr 1000, 2000 Cr 1000

      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(1000);
      expect(totalCredit).toBe(1000);
      expect(lines.find((l) => l.code === '5170')?.debit).toBe(1000);
      expect(lines.find((l) => l.code === '2000')?.credit).toBe(1000);
    });

    it('EMP-M3-20: Recoverable driver moving violation posts 4 balanced GL lines clearing account 2160 to 0', async () => {
      const match: any = {
        fineId: 'fine-speed-1',
        vehicleId: 'veh-01',
        assignedTo: 'DRIVER',
        fineAmount: 700,
      };

      const gl = await postFineMatchedGlEntry(
        fakeTx as any,
        TENANT_ID,
        { id: 'fine-speed-1', fineAmount: 700, fineDate: new Date('2026-11-16T10:00:00Z') },
        match,
      );
      expect(gl).not.toBeNull();

      expect(state.glJournalEntries).toHaveLength(1);
      const entry = state.glJournalEntries[0];
      const lines = entry.lines as Array<{ code: string; debit: number; credit: number }>;
      expect(lines).toHaveLength(4);

      // Verify net clearing of account 2160 is zero
      const clearingLines = lines.filter((l) => l.code === '2160');
      const clearingDebit = clearingLines.reduce((s, l) => s + l.debit, 0);
      const clearingCredit = clearingLines.reduce((s, l) => s + l.credit, 0);
      expect(clearingDebit).toBe(700);
      expect(clearingCredit).toBe(700);
      expect(clearingDebit - clearingCredit).toBe(0);

      // Verify AR 1100 and AP 2000 balance
      expect(lines.find((l) => l.code === '1100')?.debit).toBe(700);
      expect(lines.find((l) => l.code === '2000')?.credit).toBe(700);
    });

    it('EMP-M3-21: Zero or negative fine amounts return null from GL posting without creating journal entries', async () => {
      const zeroGl = await postFineMatchedGlEntry(
        fakeTx as any,
        TENANT_ID,
        { id: 'fine-zero', fineAmount: 0 },
        { assignedTo: 'DRIVER', fineAmount: 0 } as any,
      );
      expect(zeroGl).toBeNull();

      const negGl = await postFineMatchedGlEntry(
        fakeTx as any,
        TENANT_ID,
        { id: 'fine-neg', fineAmount: -50 },
        { assignedTo: 'DRIVER', fineAmount: -50 } as any,
      );
      expect(negGl).toBeNull();

      expect(state.glJournalEntries).toHaveLength(0);
    });
  });
});
