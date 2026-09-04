/**
 * Route Optimisation & Network Consolidation Agent
 * -------------------------------------------------
 * Evaluates both:
 *   1. Single-Route Stop Sequencing (TSP Nearest-Neighbor + 2-opt)
 *   2. Multi-Route Network Consolidation (N-to-M Routes, Capacity & Shift Windows, Dollarized Savings)
 *
 * Answers strategic network design questions like:
 *   "Can these 5 staff routes be consolidated into 3 buses?"
 * And computes:
 *   - Vehicles Saved: 2 vehicles released
 *   - Distance Saved: 146 km/day
 *   - Operating Financial Savings: AED X / month
 */

import { prisma } from '@/lib/prisma';
import {
  AgentDefinition,
  AgentEvent,
  AgentRunResult,
  ConsolidationRecommendationItem,
  NetworkDesignSummary,
  RouteOptimiserOutput,
} from '../types';
import { optimiseRoute, GeoStop, estimateDurationMin } from './tsp';
import { loadConsolidationFacts } from '@/lib/planning/route-consolidation-facts';
import { analyzeConsolidations } from '@/lib/planning/route-consolidation';
import { resolveScoringPolicy } from '@/lib/planning/route-consolidation-scoring-policy';
import { resolveEligibilityPolicy } from '@/lib/planning/route-consolidation-eligibility-policy';
import { resolveZoneFallbackKm } from '@/lib/planning/zone-compat-policy';

const AUTO_APPLY_THRESHOLD_PCT = 10;

interface RouteRow {
  id: string;
  route_name: string;
  route_number: string;
  status: string;
  stop_sequence: StopSequenceItem[] | null;
}

interface StopSequenceItem {
  stopName: string;
  sequence: number;
  pickupTime?: string;
  studentCount?: number;
}

interface StopRow {
  stop_name: string;
  lat: number | null;
  lng: number | null;
}

function buildGeoStops(
  stopSeq: StopSequenceItem[],
  coordMap: Map<string, { lat: number; lng: number }>,
): GeoStop[] {
  const stops: GeoStop[] = [];
  for (const item of stopSeq) {
    const coords = coordMap.get(item.stopName.toLowerCase().trim());
    if (!coords) continue;
    stops.push({
      id:           item.stopName,
      name:         item.stopName,
      lat:          coords.lat,
      lng:          coords.lng,
      sequence:     item.sequence,
      pickupTime:   item.pickupTime,
      studentCount: item.studentCount,
    });
  }
  return stops;
}

export async function runRouteOptimiser(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const tenantId = event.tenant_id || 'default';

  // ── 1. Single Route TSP Optimisation ──────────────────────────────────────────
  const routes = await prisma.$queryRaw<RouteRow[]>`
    SELECT id::text, route_name, route_number, status, stop_sequence
    FROM school_bus_routes
    WHERE status IN ('ACTIVE', 'DRAFT')
    ORDER BY route_number
  `.catch(() => [] as RouteRow[]);

  const stopRows = await prisma.$queryRaw<StopRow[]>`
    SELECT stop_name, lat::float8, lng::float8
    FROM school_bus_stops
    WHERE lat IS NOT NULL AND lng IS NOT NULL
  `.catch(() => [] as StopRow[]);

  const coordMap = new Map<string, { lat: number; lng: number }>();
  for (const row of stopRows) {
    if (row.lat !== null && row.lng !== null) {
      coordMap.set(row.stop_name.toLowerCase().trim(), { lat: row.lat, lng: row.lng });
    }
  }

  let singleRouteSavedKm = 0;
  let singleRouteAutoApplied = 0;
  let singleRouteSuggested = 0;
  const singleRouteResults = [];

  for (const route of routes) {
    const seq: StopSequenceItem[] = Array.isArray(route.stop_sequence)
      ? route.stop_sequence
      : [];

    if (seq.length < 3) continue;
    const stops = buildGeoStops(seq, coordMap);
    if (stops.length < 3) continue;

    const result = optimiseRoute(stops);
    const nameToOriginal = new Map<string, StopSequenceItem>();
    for (const item of seq) nameToOriginal.set(item.stopName, item);

    const optimisedSeq: StopSequenceItem[] = result.optimisedSequence.map((s, i) => ({
      stopName:     s.name,
      sequence:     i + 1,
      pickupTime:   s.pickupTime ?? nameToOriginal.get(s.name)?.pickupTime,
      studentCount: s.studentCount ?? nameToOriginal.get(s.name)?.studentCount,
    }));

    const status = result.distanceSavedPct >= AUTO_APPLY_THRESHOLD_PCT ? 'AUTO_APPLIED' : 'SUGGESTED';
    const estimatedMinutes = estimateDurationMin(result.optimisedDistanceKm, stops.length);

    await prisma.$executeRawUnsafe(`
      INSERT INTO route_optimisation_results (
        route_id, route_name, route_number,
        original_stop_count, matched_stop_count,
        original_distance_km, optimised_distance_km,
        distance_saved_km, distance_saved_pct,
        iterations_2opt, solver_duration_ms,
        estimated_duration_min,
        original_sequence, optimised_sequence,
        status, applied_at, agent_run_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb,
        $15, ${status === 'AUTO_APPLIED' ? 'NOW()' : 'NULL'}, NULL
      )
      ON CONFLICT (route_id) DO UPDATE SET
        original_stop_count    = EXCLUDED.original_stop_count,
        matched_stop_count     = EXCLUDED.matched_stop_count,
        original_distance_km   = EXCLUDED.original_distance_km,
        optimised_distance_km  = EXCLUDED.optimised_distance_km,
        distance_saved_km      = EXCLUDED.distance_saved_km,
        distance_saved_pct     = EXCLUDED.distance_saved_pct,
        iterations_2opt        = EXCLUDED.iterations_2opt,
        solver_duration_ms     = EXCLUDED.solver_duration_ms,
        estimated_duration_min = EXCLUDED.estimated_duration_min,
        original_sequence      = EXCLUDED.original_sequence,
        optimised_sequence     = EXCLUDED.optimised_sequence,
        status                 = EXCLUDED.status,
        applied_at             = CASE WHEN EXCLUDED.status = 'AUTO_APPLIED' THEN NOW() ELSE route_optimisation_results.applied_at END,
        updated_at             = NOW()
    `,
      route.id,
      route.route_name,
      route.route_number,
      seq.length,
      stops.length,
      result.originalDistanceKm,
      result.optimisedDistanceKm,
      result.distanceSavedKm,
      result.distanceSavedPct,
      result.iterations2opt,
      result.durationMs,
      estimatedMinutes,
      JSON.stringify(seq),
      JSON.stringify(optimisedSeq),
      status,
    ).catch(() => {});

    if (status === 'AUTO_APPLIED') {
      await prisma.$executeRawUnsafe(`
        UPDATE school_bus_routes
        SET stop_sequence = $1::jsonb, updated_at = NOW()
        WHERE id = $2::uuid
      `, JSON.stringify(optimisedSeq), route.id).catch(() => {});
      singleRouteAutoApplied++;
    } else {
      singleRouteSuggested++;
    }

    singleRouteSavedKm += result.distanceSavedKm;
    singleRouteResults.push({
      routeId: route.id,
      routeName: route.route_name,
      routeNumber: route.route_number,
      distanceSavedKm: result.distanceSavedKm,
      distanceSavedPct: result.distanceSavedPct,
      status,
    });
  }

  // ── 2. Multi-Route Network Consolidation Analysis (Planning Core Bridge) ──────
  let consolidationRecommendations: ConsolidationRecommendationItem[] = [];
  let consolidatedVehiclesSaved = 0;
  let consolidatedDailyKmSaved = 0;
  let consolidatedMonthlySavingsAed = 0;

  try {
    const facts = await loadConsolidationFacts(prisma as any, { tenantId });
    const scoringPolicy = await resolveScoringPolicy(prisma as any, tenantId);
    const eligibilityPolicy = await resolveEligibilityPolicy(prisma as any, tenantId);
    const zoneFallbacks = await resolveZoneFallbackKm(prisma as any, tenantId);

    const objective = {
      penaltyLambda: 1,
      costPerVehicleDay: 100,
      operatingDaysPerWeek: 5,
      fallbackKm: zoneFallbacks,
      maxDepartureTimeDiffMinutes: eligibilityPolicy.maxDepartureTimeDiffMinutes,
      maxArrivalTimeDiffMinutes: eligibilityPolicy.maxArrivalTimeDiffMinutes,
    };

    if (facts.routes.length >= 2) {
      const analysis = await analyzeConsolidations(
        prisma as any,
        tenantId,
        facts,
        objective,
        scoringPolicy,
      );

      consolidationRecommendations = analysis.recommendations
        .filter((r) => r.feasible && r.operatorScore >= 60)
        .map((r, i) => {
          const weeklyAed = r.estimatedSavings.weeklyAmount ?? 0;
          const monthlyAed = parseFloat((weeklyAed * 4.33).toFixed(2));
          const dailyKm = r.estimatedSavings.distanceSavedKmPerDay ?? 0;

          return {
            id: `rec-${r.routeA.id.slice(0, 8)}-${r.routeB.id.slice(0, 8)}`,
            sourceRouteIds: [r.routeA.id, r.routeB.id],
            sourceRouteNames: [r.routeA.name, r.routeB.name],
            sourceRouteNumbers: [r.routeA.name.slice(0, 5), r.routeB.name.slice(0, 5)],
            candidateType: 'SIMULTANEOUS_MERGE',
            direction: r.timeCompat.direction ?? 'INBOUND',
            shift: r.timeCompat.shift ?? 'MORNING',
            combinedPassengers: r.demand.combined,
            requiredCapacity: r.demand.combined,
            operatorScore: Math.round(r.operatorScore),
            detourMinutes: Math.round(r.components.detourMinutes),
            detourKm: parseFloat(r.components.detourKm.toFixed(1)),
            dailyDistanceSavedKm: parseFloat(dailyKm.toFixed(1)),
            weeklySavingsAed: parseFloat(weeklyAed.toFixed(2)),
            monthlySavingsAed: monthlyAed,
            vehiclesReleased: 1,
            status: 'SUGGESTED',
          };
        });

      // Sum net impacts
      for (const rec of consolidationRecommendations) {
        consolidatedVehiclesSaved += rec.vehiclesReleased;
        consolidatedDailyKmSaved += rec.dailyDistanceSavedKm;
        consolidatedMonthlySavingsAed += rec.monthlySavingsAed;
      }
    }
  } catch (err) {
    console.warn('[route-optimiser] Multi-route consolidation analysis skipped:', err);
  }

  const currentRoutesCount = routes.length;
  const currentVehiclesCount = routes.length;
  const recommendedVehiclesCount = Math.max(currentVehiclesCount - consolidatedVehiclesSaved, 1);
  const recommendedRoutesCount = Math.max(currentRoutesCount - consolidatedVehiclesSaved, 1);

  const totalDailyKmSaved = parseFloat((singleRouteSavedKm + consolidatedDailyKmSaved).toFixed(1));
  const totalMonthlySavingsAed = Math.round(consolidatedMonthlySavingsAed + (singleRouteSavedKm * 22 * 0.45));
  const annualSavingsAed = totalMonthlySavingsAed * 12;

  const networkDesign: NetworkDesignSummary = {
    currentRoutesCount,
    currentVehiclesCount,
    recommendedRoutesCount,
    recommendedVehiclesCount,
    vehiclesSaved: consolidatedVehiclesSaved,
    dailyKmSaved: totalDailyKmSaved,
    monthlyCostSavedAed: totalMonthlySavingsAed,
    annualCostSavedAed: annualSavingsAed,
  };

  const output: RouteOptimiserOutput = {
    summary: `Network Design: ${currentRoutesCount} routes -> ${recommendedRoutesCount} recommended (${consolidatedVehiclesSaved} vehicles saved, ${totalDailyKmSaved} km/day saved, AED ${totalMonthlySavingsAed.toLocaleString()}/mo saving).`,
    networkDesign,
    consolidations: consolidationRecommendations,
    singleRouteResults,
  };

  const durationMs = Date.now() - t0;
  const actionsCreated = singleRouteAutoApplied + singleRouteSuggested + consolidationRecommendations.length;

  return {
    agentId:        'route-optimiser',
    tenantId,
    eventType:      event.event_type,
    entityId:       event.entity_id,
    status:         'COMPLETED',
    durationMs,
    itemsProcessed: routes.length,
    actionsCreated,
    output,
  };
}

export const ROUTE_OPTIMISER_AGENT: AgentDefinition = {
  id:          'route-optimiser',
  name:        'Route Optimisation & Network Consolidation Agent',
  description: 'Enterprise route design and multi-route consolidation engine (N-to-M vehicle reduction, capacity, shift proximity & dollarized savings).',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'route.created',
    'route.updated',
    'route.consolidate_scan',
    'stop.added',
    'stop.removed',
    'schedule.changed',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run: runRouteOptimiser,
};
