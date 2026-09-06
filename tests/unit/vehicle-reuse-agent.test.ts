import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VehicleReuseEvaluator,
  evaluateVehicleReuse,
  vehicleReuseEvaluator,
} from '@/lib/agents/vehicle-reuse/evaluator';
import { vehicleReuseAgent, VehicleReuseAgent } from '@/lib/agents/vehicle-reuse/agent';
import { benchmarkRunner } from '@/lib/agents/eval/benchmark-runner';
import { VEHICLE_REUSE_GROUND_TRUTH_DATASETS } from '@/lib/agents/eval/datasets';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn().mockImplementation((prisma, tenantId, fn) => fn(prisma)),
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

describe('Vehicle Reuse Agent & Inter-Trip Chaining Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Deterministic Temporal & Spatial Feasibility Evaluator', () => {
    it('evaluates a feasible trip chaining scenario with accurate deadhead and turnaround times', async () => {
      const evaluation = await evaluateVehicleReuse({
        tripA: {
          id: 'trip-101',
          routeId: 'route-dip-jafza',
          clientName: 'Al Futtaim',
          startLocation: { lat: 24.9857, lng: 55.1764, addressName: 'DIP Staff Village' },
          endLocation: { lat: 24.9950, lng: 55.0850, addressName: 'JAFZA South' },
          startTime: '2026-09-06T07:10:00Z',
          endTime: '2026-09-06T07:40:00Z',
          passengerCount: 20,
          vehicleCategoryRequired: 'COASTER_30',
          zoneId: 'Dubai-South',
        },
        tripB: {
          id: 'trip-102',
          routeId: 'route-jafza-marina',
          clientName: 'Emaar',
          startLocation: { lat: 25.0100, lng: 55.0950, addressName: 'JAFZA Gate 7' },
          endLocation: { lat: 25.0800, lng: 55.1400, addressName: 'Dubai Marina' },
          startTime: '2026-09-06T08:25:00Z',
          endTime: '2026-09-06T09:10:00Z',
          passengerCount: 25,
          vehicleCategoryRequired: 'COASTER_30',
          zoneId: 'Dubai-South',
        },
        vehicle: {
          id: 'veh-bus-14',
          vehicleCode: 'BUS-14',
          category: 'COASTER_30',
          capacity: 30,
          operationalZone: 'Dubai-South',
          fuelType: 'DIESEL',
        },
        driver: {
          id: 'drv-01',
          name: 'Ahmed Tariq',
          dailyHoursRemaining: 7.0,
          continuousHoursRemaining: 3.5,
          licenseCategory: 'HEAVY_BUS',
        },
        minimumSafeBufferMin: 5,
      });

      expect(evaluation.isFeasible).toBe(true);
      expect(evaluation.recommendation).toBe('FEASIBLE');
      expect(evaluation.feasibilityScore).toBeGreaterThanOrEqual(80);
      expect(evaluation.breakdown.totalWindowMin).toBe(45); // 07:40 to 08:25 = 45 min
      expect(evaluation.breakdown.turnaroundMin).toBe(15); // COASTER_30 turnaround
      expect(evaluation.breakdown.bufferMin).toBeGreaterThanOrEqual(5);
      expect(evaluation.breakdown.capacityFeasible).toBe(true);
      expect(evaluation.breakdown.driverFeasible).toBe(true);
      expect(evaluation.financialSavingsAed).toBeGreaterThan(500); // 600 - deadhead fuel
    });

    it('rejects reuse when temporal window is insufficient for deadhead + turnaround', async () => {
      const evaluation = await evaluateVehicleReuse({
        tripA: {
          id: 'trip-201',
          routeId: 'route-auh',
          clientName: 'Client A',
          startLocation: { lat: 24.4539, lng: 54.3773 },
          endLocation: { lat: 24.4539, lng: 54.3773 }, // Abu Dhabi
          startTime: '2026-09-06T07:00:00Z',
          endTime: '2026-09-06T07:45:00Z',
          passengerCount: 30,
        },
        tripB: {
          id: 'trip-202',
          routeId: 'route-dxb',
          clientName: 'Client B',
          startLocation: { lat: 25.2048, lng: 55.2708 }, // Downtown Dubai (~130 km away)
          endLocation: { lat: 25.2532, lng: 55.3657 },
          startTime: '2026-09-06T08:15:00Z', // Only 30 min window
          endTime: '2026-09-06T09:00:00Z',
          passengerCount: 30,
        },
        vehicle: {
          id: 'veh-coach-01',
          vehicleCode: 'COACH-01',
          category: 'COACH_50',
          capacity: 50,
        },
      });

      expect(evaluation.isFeasible).toBe(false);
      expect(evaluation.recommendation).toBe('INFEASIBLE');
      expect(evaluation.breakdown.temporalFeasible).toBe(false);
      expect(evaluation.infeasibilityReasons.some((r) => r.includes('Insufficient time window'))).toBe(true);
      expect(evaluation.financialSavingsAed).toBe(0);
    });

    it('rejects reuse when vehicle capacity is inadequate for Trip B', async () => {
      const evaluation = await evaluateVehicleReuse({
        tripA: {
          id: 'trip-301',
          startLocation: { lat: 25.2000, lng: 55.2700 },
          endLocation: { lat: 25.2100, lng: 55.2800 },
          startTime: '2026-09-06T07:00:00Z',
          endTime: '2026-09-06T07:20:00Z',
          passengerCount: 8,
        },
        tripB: {
          id: 'trip-302',
          startLocation: { lat: 25.2150, lng: 55.2850 },
          endLocation: { lat: 25.2250, lng: 55.2950 },
          startTime: '2026-09-06T08:00:00Z',
          endTime: '2026-09-06T08:30:00Z',
          passengerCount: 26, // 26 passengers required
        },
        vehicle: {
          id: 'veh-van-14',
          vehicleCode: 'VAN-14',
          category: 'MINIVAN_14',
          capacity: 14, // Only 14 seats
        },
      });

      expect(evaluation.isFeasible).toBe(false);
      expect(evaluation.breakdown.capacityFeasible).toBe(false);
      expect(evaluation.infeasibilityReasons.some((r) => r.includes('Capacity deficit'))).toBe(true);
    });

    it('rejects reuse when driver Hours of Service (HOS) limits would be violated', async () => {
      const evaluation = await evaluateVehicleReuse({
        tripA: {
          id: 'trip-401',
          startLocation: { lat: 25.2000, lng: 55.2700 },
          endLocation: { lat: 25.2100, lng: 55.2800 },
          startTime: '2026-09-06T07:00:00Z',
          endTime: '2026-09-06T07:30:00Z',
          passengerCount: 10,
        },
        tripB: {
          id: 'trip-402',
          startLocation: { lat: 25.2150, lng: 55.2850 },
          endLocation: { lat: 25.2250, lng: 55.2950 },
          startTime: '2026-09-06T08:00:00Z',
          endTime: '2026-09-06T10:30:00Z', // 2.5 hour trip
          passengerCount: 10,
        },
        vehicle: {
          id: 'veh-sed-01',
          vehicleCode: 'SED-01',
          category: 'SEDAN',
          capacity: 4,
        },
        driver: {
          id: 'drv-fatigued',
          name: 'Fatigued Driver',
          dailyHoursRemaining: 1.0, // Only 1.0 hour left, but Trip B is 2.5 hours!
          continuousHoursRemaining: 1.0,
        },
      });

      expect(evaluation.isFeasible).toBe(false);
      expect(evaluation.breakdown.driverFeasible).toBe(false);
      expect(evaluation.infeasibilityReasons.some((r) => r.includes('Daily HOS limit exceeded'))).toBe(true);
    });
  });

  describe('Batch Candidate Matching & Multi-Trip Chaining', () => {
    it('matches unassigned trips to active vehicles based on highest ROI feasibility', async () => {
      const activeTrips = [
        {
          trip: {
            id: 'active-1',
            startLocation: { lat: 25.0000, lng: 55.1000 },
            endLocation: { lat: 25.0100, lng: 55.1100 },
            startTime: '2026-09-06T07:00:00Z',
            endTime: '2026-09-06T07:30:00Z',
            passengerCount: 20,
          },
          vehicle: {
            id: 'veh-c30',
            vehicleCode: 'BUS-30',
            category: 'COASTER_30' as const,
            capacity: 30,
          },
        },
      ];

      const unassignedTrips = [
        {
          id: 'unassigned-1',
          startLocation: { lat: 25.0150, lng: 55.1150 },
          endLocation: { lat: 25.1000, lng: 55.2000 },
          startTime: '2026-09-06T08:15:00Z',
          endTime: '2026-09-06T09:00:00Z',
          passengerCount: 25,
        },
      ];

      const opportunities = await vehicleReuseEvaluator.findReuseOpportunities(
        activeTrips,
        unassignedTrips,
      );

      expect(opportunities.length).toBe(1);
      expect(opportunities[0].tripAId).toBe('active-1');
      expect(opportunities[0].tripBId).toBe('unassigned-1');
      expect(opportunities[0].isFeasible).toBe(true);
      expect(opportunities[0].financialSavingsAed).toBeGreaterThan(500);
    });
  });

  describe('VehicleReuseAgent Dispatcher & Event Run', () => {
    it('processes single pair evaluation event and returns deterministic telemetry', async () => {
      const result = await vehicleReuseAgent.run({
        agent_id: 'vehicle-reuse',
        tenant_id: 'tenant-uae-ops',
        event_type: 'trip.completed',
        payload: {
          tripA: VEHICLE_REUSE_GROUND_TRUTH_DATASETS.feasibleStandard.tripA,
          tripB: VEHICLE_REUSE_GROUND_TRUTH_DATASETS.feasibleStandard.tripB,
          vehicle: VEHICLE_REUSE_GROUND_TRUTH_DATASETS.feasibleStandard.vehicle,
          driver: VEHICLE_REUSE_GROUND_TRUTH_DATASETS.feasibleStandard.driver,
        },
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.agentId).toBe('vehicle-reuse');
      expect(result.itemsProcessed).toBe(1);
      expect(result.actionsCreated).toBe(1);
      expect(result.telemetry?.modelProvider).toBe('local_solver');
      expect(result.telemetry?.costAed).toBe(0);
      expect(result.telemetry?.estimatedSavingsAed).toBeGreaterThan(500);
    });
  });

  describe('AI Benchmark Quality Evaluation for Vehicle Reuse', () => {
    it('passes ground-truth benchmark suite with >= 95% decision quality score and 0% FPR', async () => {
      const benchmarkResult = await benchmarkRunner.runVehicleReuseBenchmark();

      expect(benchmarkResult.passed).toBe(true);
      expect(benchmarkResult.agentId).toBe('vehicle-reuse');
      expect(benchmarkResult.metrics.precision).toBe(1.0);
      expect(benchmarkResult.metrics.recall).toBe(1.0);
      expect(benchmarkResult.metrics.falsePositiveRate).toBe(0.0);
      expect(benchmarkResult.metrics.decisionQualityScore).toBeGreaterThanOrEqual(0.95);
      expect(benchmarkResult.financialExposureDetectedAed).toBeGreaterThan(0);
    });
  });
});
