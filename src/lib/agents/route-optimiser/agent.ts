/**
 * Route Optimisation Agent
 * -------------------------
 * Fetches all active school bus routes, joins stop names with the stops
 * table to get lat/lng coordinates, then runs the Nearest Neighbour + 2-opt
 * TSP solver on each route.
 *
 * Results are upserted to route_optimisation_results. If the optimised
 * sequence saves more than AUTO_APPLY_THRESHOLD_PCT, the route's
 * stop_sequence is updated automatically. Otherwise the result is saved
 * as SUGGESTED and an operator must approve it.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { optimiseRoute, GeoStop, estimateDurationMin } from './tsp';

// Savings ≥ this % → auto-apply the optimised sequence
const AUTO_APPLY_THRESHOLD_PCT = 10;

// ── Types for DB rows ──────────────────────────────────────────────────────────
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

// ── Helper: build GeoStop array from a route ──────────────────────────────────
function buildGeoStops(
  stopSeq: StopSequenceItem[],
  coordMap: Map<string, { lat: number; lng: number }>,
): GeoStop[] {
  const stops: GeoStop[] = [];

  for (const item of stopSeq) {
    const coords = coordMap.get(item.stopName.toLowerCase().trim());
    if (!coords) continue; // skip stops with no coordinates
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

// ── Core agent run function ───────────────────────────────────────────────────
async function runRouteOptimiser(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();

  // 1. Fetch all active routes with stop sequences
  const routes = await prisma.$queryRaw<RouteRow[]>`
    SELECT id::text, route_name, route_number, status, stop_sequence
    FROM school_bus_routes
    WHERE status IN ('ACTIVE', 'DRAFT')
    ORDER BY route_number
  `;

  if (routes.length === 0) {
    return {
      agentId:        'route-optimiser',
      tenantId:       event.tenant_id,
      eventType:      event.event_type,
      status:         'COMPLETED',
      durationMs:     Date.now() - t0,
      itemsProcessed: 0,
      actionsCreated: 0,
      output: { summary: 'No active routes found to optimise.', results: [] },
    };
  }

  // 2. Fetch all stops with coordinates
  const stopRows = await prisma.$queryRaw<StopRow[]>`
    SELECT stop_name, lat::float8, lng::float8
    FROM school_bus_stops
    WHERE lat IS NOT NULL AND lng IS NOT NULL
  `;

  // Build a lowercased lookup map
  const coordMap = new Map<string, { lat: number; lng: number }>();
  for (const row of stopRows) {
    if (row.lat !== null && row.lng !== null) {
      coordMap.set(row.stop_name.toLowerCase().trim(), { lat: row.lat, lng: row.lng });
    }
  }

  // 3. Optimise each route
  let totalSaved = 0;
  let autoApplied = 0;
  let suggested = 0;
  let skipped = 0;
  const routeResults: RouteOptResult[] = [];

  for (const route of routes) {
    const seq: StopSequenceItem[] = Array.isArray(route.stop_sequence)
      ? route.stop_sequence
      : [];

    if (seq.length < 3) {
      skipped++;
      continue; // not worth optimising
    }

    const stops = buildGeoStops(seq, coordMap);

    if (stops.length < 3) {
      skipped++;
      continue; // not enough geo-matched stops
    }

    const result = optimiseRoute(stops);

    // Reconstruct the full stop_sequence with optimised order
    // (merge back pickupTime / studentCount from original seq)
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

    // Upsert into route_optimisation_results
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
    );

    // Auto-apply: update the live route's stop_sequence
    if (status === 'AUTO_APPLIED') {
      await prisma.$executeRawUnsafe(`
        UPDATE school_bus_routes
        SET stop_sequence = $1::jsonb, updated_at = NOW()
        WHERE id = $2::uuid
      `, JSON.stringify(optimisedSeq), route.id);
      autoApplied++;
    } else {
      suggested++;
    }

    totalSaved += result.distanceSavedKm;

    routeResults.push({
      routeId:              route.id,
      routeName:            route.route_name,
      routeNumber:          route.route_number,
      originalDistanceKm:   result.originalDistanceKm,
      optimisedDistanceKm:  result.optimisedDistanceKm,
      distanceSavedKm:      result.distanceSavedKm,
      distanceSavedPct:     result.distanceSavedPct,
      estimatedDurationMin: estimatedMinutes,
      status,
    });
  }

  const duration = Date.now() - t0;

  return {
    agentId:        'route-optimiser',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    status:         'COMPLETED',
    durationMs:     duration,
    itemsProcessed: routes.length,
    actionsCreated: autoApplied,
    output: {
      summary: [
        `Optimised ${routeResults.length} routes in ${duration}ms.`,
        `Total distance saved: ${totalSaved.toFixed(1)} km.`,
        `Auto-applied: ${autoApplied} | Awaiting approval: ${suggested} | Skipped (too few stops): ${skipped}`,
      ].join(' '),
      results:      routeResults,
      totalSavedKm: parseFloat(totalSaved.toFixed(3)),
      autoApplied,
      suggested,
      skipped,
    },
  };
}

interface RouteOptResult {
  routeId: string;
  routeName: string;
  routeNumber: string;
  originalDistanceKm: number;
  optimisedDistanceKm: number;
  distanceSavedKm: number;
  distanceSavedPct: number;
  estimatedDurationMin: number;
  status: 'AUTO_APPLIED' | 'SUGGESTED';
}

// ── Agent Definition ──────────────────────────────────────────────────────────
export const ROUTE_OPTIMISER_AGENT: AgentDefinition = {
  id:          'route-optimiser',
  name:        'Route Optimisation Agent',
  description: 'Nearest Neighbour + 2-opt TSP solver that re-sequences school bus stops to minimise total route distance.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'manual.trigger',
    'schedule.nightly',
    'route.created',
    'route.updated',
    'stop.added',
    'stop.removed',
    'schedule.changed',
  ],
  supportsEntityScan: true,
  run: runRouteOptimiser,
};
