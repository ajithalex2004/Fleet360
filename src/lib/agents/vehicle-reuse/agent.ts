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
import { loadTenantOperations } from '../data-loaders/tenant-operations';
import { reuseInput, type ReuseInput } from '../data-loaders/agent-inputs';

/** At most this many chains are proposed per run. */
const MAX_PROPOSALS = 25;
/** When loading a tenant's own trips: waiting trips per run, predecessors tried per trip, and the longest gap to chain across. */
const MAX_WAITING_TRIPS = 100;
const CANDIDATES_PER_TRIP = 3;
const MAX_CHAIN_GAP_MS = 3 * 3600000;

/**
 * A set of chains that can all be approved together: each waiting trip at
 * most once, and no vehicle given a trip that collides with another trip it
 * already has (the evaluator only checks the gap after trip A).
 */
export function selectCompatibleChains(
  results: ReuseEvaluationResult[],
  bookings: ReuseInput['bookings'],
  tripTimes: Map<string, { start: number; end: number }>,
): ReuseEvaluationResult[] {
  const chosen: ReuseEvaluationResult[] = [];
  const takenTrips = new Set<string>();
  const extra = new Map<string, Array<{ start: number; end: number }>>();
  for (const r of results) {
    if (!r.isFeasible || takenTrips.has(r.tripBId)) continue;
    const b = tripTimes.get(r.tripBId);
    if (!b) continue;
    const busy = [...(bookings.get(r.vehicleId) ?? []), ...(extra.get(r.vehicleId) ?? [])];
    if (busy.some((x) => x.start < b.end && b.start < x.end)) continue;
    chosen.push(r);
    takenTrips.add(r.tripBId);
    extra.set(r.vehicleId, [...(extra.get(r.vehicleId) ?? []), b]);
    if (chosen.length >= MAX_PROPOSALS) break;
  }
  return chosen;
}

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
    let payload: Record<string, unknown> = event.payload || {};

    // A scheduled run or "Run analysis" carries no trips: look for chains in
    // this tenant's own trips today and tomorrow. It used to evaluate nothing.
    let loaded: ReuseInput | null = null;
    let unavailable: string[] = [];
    if (!(payload.tripA && payload.tripB && payload.vehicle) && !(Array.isArray(payload.activeTrips) && Array.isArray(payload.unassignedTrips))) {
      const snapshot = await loadTenantOperations(tenantId, { trips: true, duty: false, depots: false });
      loaded = reuseInput(snapshot);
      unavailable = snapshot.unavailable;
      payload = { ...payload, activeTrips: loaded.activeTrips, unassignedTrips: loaded.unassignedTrips };
    }

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

        await this.proposeChain(tenantId, result);
      }
    }

    // 2. Check for Batch Candidate Matching
    if (Array.isArray(payload.activeTrips) && Array.isArray(payload.unassignedTrips)) {
      const active = payload.activeTrips as Array<{ trip: TripScheduleItem; vehicle: VehicleResource; driver?: DriverResource }>;
      const waiting = payload.unassignedTrips as TripScheduleItem[];
      let batchResults: ReuseEvaluationResult[];
      if (loaded) {
        // A whole tenant's trips: each travel-time miss is an upstream routing
        // call, so pair each waiting trip only with its few likeliest
        // predecessors instead of every booked trip.
        batchResults = [];
        for (const b of waiting.slice(0, MAX_WAITING_TRIPS)) {
          const bStart = new Date(b.plannedPickupTime ?? 0).getTime();
          const candidates = active
            .map((a) => ({ a, gap: bStart - new Date(a.trip.plannedDropoffTime ?? a.trip.plannedPickupTime ?? 0).getTime() }))
            .filter(({ a, gap }) => gap >= 0 && gap <= MAX_CHAIN_GAP_MS && (a.vehicle.capacity || a.vehicle.seatingCapacity || 0) >= (b.passengerCount || 0))
            .sort((x, y) => x.gap - y.gap)
            .slice(0, CANDIDATES_PER_TRIP)
            .map(({ a }) => a);
          if (candidates.length) batchResults.push(...(await vehicleReuseEvaluator.findReuseOpportunities(candidates, [b])));
        }
        batchResults.sort((x, y) => y.financialSavingsAed - x.financialSavingsAed || y.bufferMin - x.bufferMin);
      } else {
        batchResults = await vehicleReuseEvaluator.findReuseOpportunities(active, waiting);
      }

      // Propose a compatible set; the batch used to be counted but never
      // proposed, so none of it reached the approval queue.
      const tripTimes = new Map<string, { start: number; end: number }>();
      for (const t of payload.unassignedTrips as TripScheduleItem[]) {
        const start = new Date(t.plannedPickupTime ?? t.startTime ?? 0).getTime();
        tripTimes.set(t.id, { start, end: new Date(t.plannedDropoffTime ?? t.endTime ?? start).getTime() });
      }
      const bookings: ReuseInput['bookings'] = loaded?.bookings ?? new Map();
      if (!loaded) {
        for (const { trip, vehicle } of payload.activeTrips as Array<{ trip: TripScheduleItem; vehicle: VehicleResource }>) {
          const key = vehicle.vehicleId || vehicle.id || vehicle.vehicleCode;
          const start = new Date(trip.plannedPickupTime ?? trip.startTime ?? 0).getTime();
          bookings.set(key, [...(bookings.get(key) ?? []), { start, end: new Date(trip.plannedDropoffTime ?? trip.endTime ?? start).getTime(), tripId: trip.id }]);
        }
      }
      for (const res of selectCompatibleChains(batchResults, bookings, tripTimes)) {
        evaluationResults.push(res);
        totalSavingsAed += res.financialSavingsAed;
        actionsCreated++;
        await this.proposeChain(tenantId, res);
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
      itemsProcessed: Array.isArray(payload.unassignedTrips) ? (payload.unassignedTrips as unknown[]).length : evaluationResults.length,
      actionsCreated,
      output: {
        totalEvaluated: evaluationResults.length,
        feasibleCount: evaluationResults.filter((r) => r.isFeasible).length,
        totalSavingsAed,
        evaluations: evaluationResults,
        ...(loaded ? { dataSource: { loaded: true, tripsWithVehicle: loaded.activeTrips.length, tripsWaiting: loaded.unassignedTrips.length, unavailable } } : {}),
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

  /** Submit one chain to the governance policy (approval queue unless L4). */
  private async proposeChain(tenantId: string, result: ReuseEvaluationResult): Promise<void> {
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

/** Global Shared Vehicle Reuse Agent Instance */
export const vehicleReuseAgent = new VehicleReuseAgent();
