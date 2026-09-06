import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DriverHoursPolicyEngine,
  driverHoursPolicyEngine,
} from '@/lib/agents/fleet-workforce-planner/policy-engine';
import {
  ResourceCostEngine,
  resourceCostEngine,
} from '@/lib/agents/fleet-workforce-planner/cost-engine';
import {
  RepositionSolver,
  repositionSolver,
} from '@/lib/agents/fleet-workforce-planner/reposition-solver';
import {
  MasterPlannerSolver,
  masterPlannerSolver,
} from '@/lib/agents/fleet-workforce-planner/master-solver';
import {
  fleetWorkforcePlannerAgent,
} from '@/lib/agents/fleet-workforce-planner/agent';
import { benchmarkRunner } from '@/lib/agents/eval/benchmark-runner';
import { FLEET_WORKFORCE_PLANNER_GROUND_TRUTH_DATASETS } from '@/lib/agents/eval/datasets';

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

describe('Unified Fleet & Workforce Master Planner Agent Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dynamic DriverHoursPolicy Engine', () => {
    it('resolves standard UAE Federal baseline (8h normal, 10h max duty, 4.5h continuous driving)', () => {
      const policy = driverHoursPolicyEngine.resolvePolicy();
      expect(policy.normalDailyHours).toBe(8.0);
      expect(policy.maxDailyDutyHours).toBe(10.0);
      expect(policy.maxContinuousDrivingMinutes).toBe(270); // 4.5 hours
      expect(policy.mandatoryBreakMinutes).toBe(45);
      expect(policy.interShiftRestHours).toBe(11.0);
      expect(policy.isRamadanSchedule).toBe(false);
    });

    it('resolves Ramadan special policy reduction (6h normal, 8h max duty, 36h weekly)', () => {
      const ramadanPolicy = driverHoursPolicyEngine.resolvePolicy({ isRamadanSchedule: true });
      expect(ramadanPolicy.normalDailyHours).toBe(6.0);
      expect(ramadanPolicy.normalWeeklyHours).toBe(36.0);
      expect(ramadanPolicy.maxDailyDutyHours).toBe(8.0);
      expect(ramadanPolicy.isRamadanSchedule).toBe(true);
    });

    it('validates duty blocks and blocks shifts exceeding daily duty or continuous driving limits', () => {
      const policy = driverHoursPolicyEngine.resolvePolicy();

      // Valid duty block (4h duty + 1.5h trip = 5.5h <= 10h)
      const validCheck = driverHoursPolicyEngine.validateDutyBlock(policy, 240, 60, 90);
      expect(validCheck.isValid).toBe(true);
      expect(validCheck.shiftRemainingMinutes).toBe(360);

      // Exceeded daily duty (9h duty + 1.5h trip = 10.5h > 10h)
      const dutyExceeded = driverHoursPolicyEngine.validateDutyBlock(policy, 540, 60, 90);
      expect(dutyExceeded.isValid).toBe(false);
      expect(dutyExceeded.violationReason).toContain('Daily duty limit exceeded');

      // Exceeded continuous driving (4h continuous + 1h trip = 5h > 4.5h)
      const continuousExceeded = driverHoursPolicyEngine.validateDutyBlock(policy, 240, 240, 60);
      expect(continuousExceeded.isValid).toBe(false);
      expect(continuousExceeded.violationReason).toContain('Continuous driving limit exceeded');
    });
  });

  describe('ResourceCostEngine & Comprehensive Repositioning Model', () => {
    it('computes full repositioning expense including fuel, driver labor, tolls, wear, and return risk', () => {
      const cost = resourceCostEngine.computeRepositionCost('COACH_50', 30, 40, 2);

      expect(cost.fuelCostAed).toBeGreaterThan(20);
      expect(cost.driverCostAed).toBeGreaterThan(20);
      expect(cost.tollCostAed).toBe(8.0); // 2 gates * 4.0 AED
      expect(cost.vehicleWearAed).toBeGreaterThan(0);
      expect(cost.totalRepositionCostAed).toBeLessThan(cost.benchmarkExchangeCostAed);
      expect(cost.netSavingsAed).toBeGreaterThan(500); // 850 charter - repo cost
    });
  });

  describe('RepositionSolver (Co-Optimizing Vehicles & Drivers)', () => {
    it('co-optimizes vehicle and driver repositioning across surplus and deficit depots', async () => {
      const depots = [
        {
          depotId: 'depot-dip',
          depotName: 'DIP Depot',
          lat: 24.9857,
          lng: 55.1764,
          vehicleSurplus: { COACH_50: 3, COASTER_30: 2, MINIVAN_14: 0, SEDAN: 0 },
          driverSurplus: 3,
        },
        {
          depotId: 'depot-jafza',
          depotName: 'JAFZA Depot',
          lat: 24.995,
          lng: 55.085,
          vehicleSurplus: { COACH_50: -2, COASTER_30: 0, MINIVAN_14: 0, SEDAN: 0 },
          driverSurplus: -2,
        },
      ];

      const orders = await repositionSolver.solveDepotBalancing(depots);

      expect(orders.length).toBeGreaterThanOrEqual(1);
      expect(orders[0].sourceDepot).toBe('DIP Depot');
      expect(orders[0].targetDepot).toBe('JAFZA Depot');
      expect(orders[0].vehicleCategory).toBe('COACH_50');
      expect(orders[0].repositionType).toBe('REPO_BOTH'); // Co-moved vehicle and driver!
      expect(orders[0].avoidedOutsourceSavingsAed).toBeGreaterThan(1000);
    });
  });

  describe('Master Constraint Optimization Solver (CP-SAT/MILP Principles)', () => {
    it('co-optimizes master plan, synchronizes 2-way maintenance slots, and generates 3 distinct scenarios', async () => {
      const plan = await masterPlannerSolver.solveMasterPlan(
        FLEET_WORKFORCE_PLANNER_GROUND_TRUTH_DATASETS.standardMultiDepotPlan,
      );

      expect(plan.feasibilityState).toBe('FEASIBLE');
      expect(plan.totalTripsRequested).toBe(4);
      expect(plan.tripsCoveredInternally).toBe(4);
      expect(plan.tripsUnserved).toBe(0);

      // Check 3 Scenarios
      expect(plan.scenarios.length).toBe(3);
      const [scenA, scenB, scenC] = plan.scenarios;
      expect(scenA.scenarioId).toBe('SCENARIO_A_LOWEST_COST');
      expect(scenB.scenarioId).toBe('SCENARIO_B_BALANCED');
      expect(scenC.scenarioId).toBe('SCENARIO_C_MAX_RESILIENCE');

      expect(scenB.isAiRecommended).toBe(true);
      expect(plan.recommendedScenario.scenarioId).toBe('SCENARIO_B_BALANCED');

      // Check 2-Way Maintenance Slot for COACH-50-01
      expect(plan.recommendedScenario.maintenanceSlots.length).toBeGreaterThanOrEqual(1);
      expect(plan.recommendedScenario.maintenanceSlots[0].vehicleCode).toBe('COACH-50-01');
      expect(plan.recommendedScenario.maintenanceSlots[0].proposedBy).toBe('PREDICTIVE_MAINTENANCE_RUL');

      // Check Standby Buffer in Scenario B
      expect(plan.recommendedScenario.standbyAllocations.length).toBeGreaterThanOrEqual(1);
      expect(plan.recommendedScenario.standbyAllocations[0].standbyDriversCount).toBeGreaterThanOrEqual(1);
    });

    it('correctly identifies capacity deficit plans as PARTIALLY_FEASIBLE or FEASIBLE_WITH_OUTSOURCING', async () => {
      const plan = await masterPlannerSolver.solveMasterPlan(
        FLEET_WORKFORCE_PLANNER_GROUND_TRUTH_DATASETS.capacityDeficitPlan,
      );

      expect(plan.feasibilityState).not.toBe('FEASIBLE');
      expect(plan.tripsUnserved).toBeGreaterThan(0);
      expect(plan.scenarios[2].outsourcedTripsCount).toBeGreaterThan(0); // Scenario C outsources uncovered trips
    });
  });

  describe('FleetWorkforcePlannerAgent Dispatch & Governance Run', () => {
    it('executes agent run event, generates MasterPlanResult, and emits policy action proposals', async () => {
      const result = await fleetWorkforcePlannerAgent.run({
        agent_id: 'fleet-workforce-planner',
        tenant_id: 'tenant-uae-ops',
        event_type: 'planning.master_run_scheduled',
        payload: FLEET_WORKFORCE_PLANNER_GROUND_TRUTH_DATASETS.standardMultiDepotPlan,
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.agentId).toBe('fleet-workforce-planner');
      expect(result.actionsCreated).toBeGreaterThan(0);
      expect(result.telemetry?.modelProvider).toBe('local_solver');
      expect(result.telemetry?.decisionQualityScore).toBeGreaterThanOrEqual(0.95);
      expect(result.output).toHaveProperty('scenarios');
      expect(result.output).toHaveProperty('recommendedScenario');
    });
  });

  describe('AI Quality Benchmark & Multi-Dimensional Ground Truth Evaluation', () => {
    it('passes ground-truth benchmark suite with >= 95% decision quality score and 0% FPR', async () => {
      const benchmarkResult = await benchmarkRunner.runFleetWorkforcePlannerBenchmark();

      expect(benchmarkResult.passed).toBe(true);
      expect(benchmarkResult.agentId).toBe('fleet-workforce-planner');
      expect(benchmarkResult.metrics.precision).toBe(1.0);
      expect(benchmarkResult.metrics.recall).toBe(1.0);
      expect(benchmarkResult.metrics.falsePositiveRate).toBe(0.0);
      expect(benchmarkResult.metrics.decisionQualityScore).toBeGreaterThanOrEqual(0.95);
      expect(benchmarkResult.financialExposureDetectedAed).toBeGreaterThan(0);
    });
  });
});
