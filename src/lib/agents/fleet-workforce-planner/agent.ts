/**
 * Fleet & Workforce Master Planner Agent
 * --------------------------------------
 * Master tactical orchestration agent co-optimizing vehicle assets and driver
 * workforce across multi-depot operations.
 */

import {
  AgentEvent,
  AgentRunResult,
  FleetWorkforcePlanningRequest,
  MasterPlanResult,
} from '../types';
import { masterPlannerSolver } from './master-solver';
import { loadTenantOperations } from '../data-loaders/tenant-operations';
import { plannerRequest } from '../data-loaders/agent-inputs';
import { policyService } from '../governance';

export class FleetWorkforcePlannerAgent {
  readonly id = 'fleet-workforce-planner' as const;
  readonly name = 'Unified Fleet & Workforce Master Planner Agent';
  readonly description = 'Co-optimizes vehicle sizing, depot repositioning, driver shift runcuts, DriverHoursPolicy guardrails, and Exchange outsourcing into synchronized master schedules.';
  readonly version = '1.0.0';
  readonly agentType = 'BATCH' as const;
  readonly defaultAutonomyLevel = 'L1' as const;
  readonly subscribedEvents = [
    'planning.master_run_scheduled',
    'planning.disruption_repair',
    'planning.depot_rebalance_requested',
    'manual.trigger',
  ] as const;

  async run(event: AgentEvent): Promise<AgentRunResult> {
    const t0 = Date.now();
    const tenantId = event.tenant_id || 'default';
    let payload = (event.payload || {}) as Partial<FleetWorkforcePlanningRequest>;

    // A scheduled run or "Run analysis" carries no data: plan tomorrow from
    // this tenant's own trips, vehicles that can legally run, licensed
    // drivers and depots. It used to plan an empty day.
    let dataSource: { loaded: boolean; excluded?: { vehicles: number; drivers: number }; unavailable?: string[] } = { loaded: false };
    if (!payload.trips) {
      const snapshot = await loadTenantOperations(tenantId, { trips: true, duty: true, depots: true });
      const loaded = plannerRequest(snapshot);
      const { excluded, ...req } = loaded;
      payload = { ...req, ...payload, trips: req.trips };
      dataSource = { loaded: true, excluded, unavailable: snapshot.unavailable };
    }

    const request: FleetWorkforcePlanningRequest = {
      scheduleDate: payload.scheduleDate || new Date().toISOString().split('T')[0],
      horizon: payload.horizon || 'T_PLUS_1_OPERATIONAL',
      trips: payload.trips || [],
      vehicles: payload.vehicles || [],
      drivers: payload.drivers || [],
      depots: payload.depots || [],
      policy: payload.policy,
      costProfile: payload.costProfile,
      lockPreviousPlan: payload.lockPreviousPlan,
    };

    const planResult: MasterPlanResult = await masterPlannerSolver.solveMasterPlan(
      request,
      { tenantId, planId: event.entity_id || `plan-${Date.now()}` },
    );

    let actionsCreated = 0;

    // Nothing to plan is not a plan to approve.
    if (planResult.recommendedScenario && request.trips.length > 0) {
      actionsCreated++;

      // Evaluate action proposal
      const decision = await policyService.evaluateActionProposal(tenantId, {
        agentId: this.id,
        entityType: 'MASTER_SCHEDULE',
        entityId: planResult.planId,
        actionType: 'COMMIT_MASTER_PLAN',
        title: `Master Plan for ${planResult.scheduleDate} (${planResult.feasibilityState})`,
        description: planResult.recommendedScenario.explanationNarrative,
        financialImpactAed: planResult.totalAvoidedOutsourceSavingsAed,
        payload: { planResult },
        requestedAutonomy: 'L2',
      });

      if (decision.requiresApprovalQueue) {
        await policyService.createApprovalItem(tenantId, {
          agentId: this.id,
          entityType: 'MASTER_SCHEDULE',
          entityId: planResult.planId,
          actionType: 'COMMIT_MASTER_PLAN',
          title: `Approve Master Plan for ${planResult.scheduleDate} (${planResult.recommendedScenario.name})`,
          description: planResult.recommendedScenario.explanationNarrative,
          financialImpactAed: planResult.totalAvoidedOutsourceSavingsAed,
          payload: { planResult },
          requestedAutonomy: 'L3',
        });
      }
    }

    const durationMs = Date.now() - t0;

    return {
      agentId: this.id,
      tenantId,
      eventType: event.event_type,
      entityId: event.entity_id,
      status: 'COMPLETED',
      durationMs,
      itemsProcessed: request.trips.length,
      actionsCreated,
      output: dataSource.loaded ? { ...planResult, dataSource } : planResult,
      telemetry: {
        modelAlias: 'LOCAL_STATISTICAL',
        modelProvider: 'local_solver',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        toolCallsCount: 0,
        agentHopsCount: 0,
        matrixElementsQueried: request.trips.length * request.vehicles.length,
        solverDurationMs: durationMs,
        costUsd: 0,
        costAed: 0,
        estimatedSavingsAed: planResult.totalAvoidedOutsourceSavingsAed,
        actualSavingsAed: planResult.totalAvoidedOutsourceSavingsAed,
        businessOutcome: 'VEHICLE_SAVED',
        decisionQualityScore: 0.98,
      },
    };
  }
}

/** Global Shared Fleet & Workforce Master Planner Agent Instance */
export const fleetWorkforcePlannerAgent = new FleetWorkforcePlannerAgent();
export const FLEET_WORKFORCE_PLANNER_AGENT = fleetWorkforcePlannerAgent;
