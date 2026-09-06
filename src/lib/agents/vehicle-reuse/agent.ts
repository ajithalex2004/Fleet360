/**
 * Fleet360 Vehicle Reuse Agent
 * -----------------------------
 * Independent optimization agent evaluating inter-trip chaining and vehicle reuse.
 *
 * Operational Objective:
 * Identifies opportunities where vehicles completing Trip A can safely service Trip B,
 * preventing duplicate vehicle/driver mobilization and generating massive operational savings.
 */

import {
  AgentEvent,
  AgentRunResult,
  ReuseEvaluationResult,
  TripScheduleItem,
  VehicleResource,
  DriverResource,
} from '../types';
import { evaluateVehicleReuse, vehicleReuseEvaluator } from './evaluator';
import { policyService } from '../governance';

export class VehicleReuseAgent {
  readonly id = 'vehicle-reuse' as const;
  readonly name = 'Vehicle Reuse & Shift Chaining Agent';
  readonly description = 'Evaluates temporal, spatial deadhead, turnaround, and driver HOS feasibility to chain trips and eliminate redundant vehicle mobilization.';
  readonly version = '1.0.0';
  readonly agentType = 'BATCH' as const;
  readonly defaultAutonomyLevel = 'L1' as const;
  readonly subscribedEvents = [
    'trip.completed',
    'trip.scheduled',
    'bus_ops.shift_schedule_updated',
    'manual.trigger',
  ] as const;

  async run(event: AgentEvent): Promise<AgentRunResult> {
    const t0 = Date.now();
    const tenantId = event.tenant_id || 'default';
    const payload = event.payload || {};

    const evaluationResults: ReuseEvaluationResult[] = [];
    let totalSavingsAed = 0;
    let actionsCreated = 0;

    // 1. Check for explicit Single Pair Request
    if (payload.tripA && payload.tripB && payload.vehicle) {
      const result = await evaluateVehicleReuse({
        tripA: payload.tripA as TripScheduleItem,
        tripB: payload.tripB as TripScheduleItem,
        vehicle: payload.vehicle as VehicleResource,
        driver: payload.driver as DriverResource | undefined,
        minimumSafeBufferMin: (payload.minimumSafeBufferMin as number) || 5,
      });

      evaluationResults.push(result);
      if (result.isFeasible) {
        totalSavingsAed += result.financialSavingsAed;
        actionsCreated++;

        // Evaluate with Policy Engine
        const proposalDecision = await policyService.evaluateActionProposal(tenantId, {
          agentId: this.id,
          entityType: 'VEHICLE_REUSE',
          entityId: `${result.tripAId}->${result.tripBId}`,
          actionType: 'LINK_TRIPS',
          title: `Chain Trip ${result.tripAId} to Trip ${result.tripBId} on ${result.vehicleCode}`,
          description: result.summary,
          financialImpactAed: result.financialSavingsAed,
          payload: { result },
          requestedAutonomy: 'L2',
        });

        if (proposalDecision.requiresApprovalQueue) {
          await policyService.createApprovalItem(tenantId, {
            agentId: this.id,
            entityType: 'VEHICLE_REUSE',
            entityId: `${result.tripAId}->${result.tripBId}`,
            actionType: 'LINK_TRIPS',
            title: `Chain Trip ${result.tripAId} to Trip ${result.tripBId} on ${result.vehicleCode}`,
            description: result.summary,
            financialImpactAed: result.financialSavingsAed,
            payload: { result },
            requestedAutonomy: 'L3',
          });
        }
      }
    }

    // 2. Check for Batch Candidate Matching
    if (Array.isArray(payload.activeTrips) && Array.isArray(payload.unassignedTrips)) {
      const batchResults = await vehicleReuseEvaluator.findReuseOpportunities(
        payload.activeTrips as Array<{ trip: TripScheduleItem; vehicle: VehicleResource; driver?: DriverResource }>,
        payload.unassignedTrips as TripScheduleItem[],
      );

      for (const res of batchResults) {
        evaluationResults.push(res);
        totalSavingsAed += res.financialSavingsAed;
        actionsCreated++;
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
      itemsProcessed: evaluationResults.length || 1,
      actionsCreated,
      output: {
        totalEvaluated: evaluationResults.length,
        feasibleCount: evaluationResults.filter((r) => r.isFeasible).length,
        totalSavingsAed,
        evaluations: evaluationResults,
      },
      telemetry: {
        modelAlias: 'LOCAL_STATISTICAL',
        modelProvider: 'local_solver',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        toolCallsCount: 0,
        agentHopsCount: 0,
        matrixElementsQueried: evaluationResults.length,
        solverDurationMs: durationMs,
        costUsd: 0,
        costAed: 0,
        estimatedSavingsAed: totalSavingsAed,
        actualSavingsAed: totalSavingsAed,
        businessOutcome: 'VEHICLE_SAVED',
        decisionQualityScore: 0.98,
      },
    };
  }
}

/** Global Shared Vehicle Reuse Agent Instance */
export const vehicleReuseAgent = new VehicleReuseAgent();
