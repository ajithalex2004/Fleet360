/**
 * Route optimizer service layer — the orchestration between the API and the
 * pure solver.
 *
 * Responsibilities:
 *   1. Load the selected vehicles (with capacity + depot + HOS columns) and
 *      shipments (with their pickup/delivery stops) from Postgres, tenant-scoped.
 *   2. Geocode any stop missing lat/lng, writing coords back to the stop row.
 *   3. Assemble the point list (depot first), call computeDistanceMatrix.
 *   4. Translate DB rows → solver input shapes, run optimizeRoutes.
 *   5. Persist the run to logistics_route_plans (status DRAFT).
 *   6. On commit: write logistics_assignments rows + flip shipment status.
 *
 * The solver stays pure; everything impure lives here.
 */

import { prisma } from '@/lib/prisma';
import { ensureRouteOptimizerSchema } from './route-optimizer-schema';
import { geocode } from './geocoder';
import { computeDistanceMatrix, type LatLng } from './distance-matrix';
import {
  optimizeRoutes,
  type SolverInput,
  type SolverShipment,
  type SolverVehicle,
  type SolverStop,
  type RouteOptimizerResult,
} from './route-optimizer';

// ── Public types ────────────────────────────────────────────────────────────

export interface OptimizeRequest {
  tenantId: string;
  vehicleIds: string[];
  shipmentIds: string[];
  createdBy?: string | null;
  config?: {
    distanceProvider?: 'mapbox' | 'haversine';
    objective?: 'distance' | 'duration' | 'balanced';
    detourFactor?: number;
    depotLatitude?: number;
    depotLongitude?: number;
  };
}

export interface OptimizeResponse {
  planId: string;
  status: 'COMPLETED' | 'PARTIAL';
  result: RouteOptimizerResult;
  geocodeFailures: Array<{ stopId: string; address: string | null; reason: string }>;
}

// ── DB row shapes ───────────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  license_plate: string | null;
  payload_capacity_kg: string | number | null;
  payload_capacity_cbm: string | number | null;
  depot_latitude: string | number | null;
  depot_longitude: string | number | null;
  cost_per_km: string | number | null;
}

interface StopRow {
  id: string;
  shipment_order_id: string;
  sequence_no: number;
  stop_type: string;
  address: string | null;
  location_name: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  planned_arrival_at: string | null;
  planned_depart_at: string | null;
  service_duration_minutes: number | null;
}

interface ShipmentRow {
  id: string;
  total_weight_kg: string | number | null;
  total_volume_cbm: string | number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Convert an ISO timestamp to minutes-from-midnight (local UTC clock). */
function toMinutesFromMidnight(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// ── Load + geocode ──────────────────────────────────────────────────────────

interface LoadedData {
  vehicles: VehicleRow[];
  shipments: ShipmentRow[];
  stopsByShipment: Map<string, StopRow[]>;
  geocodeFailures: OptimizeResponse['geocodeFailures'];
}

async function loadAndGeocode(req: OptimizeRequest): Promise<LoadedData> {
  const { tenantId } = req;

  const vehicles = await prisma.$queryRawUnsafe<VehicleRow[]>(
    `SELECT id, license_plate,
            payload_capacity_kg, payload_capacity_cbm,
            depot_latitude, depot_longitude, cost_per_km
       FROM vehicles
      WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    req.vehicleIds,
  );

  const shipments = await prisma.$queryRawUnsafe<ShipmentRow[]>(
    `SELECT id, total_weight_kg, total_volume_cbm
       FROM logistics_shipment_orders
      WHERE id = ANY($1::text[]) AND tenant_id = $2 AND deleted_at IS NULL`,
    req.shipmentIds, tenantId,
  );

  const stops = await prisma.$queryRawUnsafe<StopRow[]>(
    `SELECT id, shipment_order_id, sequence_no, stop_type,
            address, location_name, latitude, longitude,
            planned_arrival_at::text, planned_depart_at::text,
            service_duration_minutes
       FROM logistics_shipment_stops
      WHERE shipment_order_id = ANY($1::text[]) AND tenant_id = $2
      ORDER BY shipment_order_id, sequence_no`,
    req.shipmentIds, tenantId,
  );

  // Geocode any stop missing coordinates.
  const geocodeFailures: OptimizeResponse['geocodeFailures'] = [];
  for (const stop of stops) {
    if (stop.latitude != null && stop.longitude != null) continue;
    const addr = stop.address || stop.location_name;
    if (!addr) {
      geocodeFailures.push({ stopId: stop.id, address: null, reason: 'no address on stop' });
      continue;
    }
    try {
      const g = await geocode(addr, tenantId);
      stop.latitude = g.latitude;
      stop.longitude = g.longitude;
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_shipment_stops
            SET latitude = $1, longitude = $2,
                geocode_confidence = $3, geocoded_at = NOW(), updated_at = NOW()
          WHERE id = $4 AND tenant_id = $5`,
        g.latitude, g.longitude, g.confidence, stop.id, tenantId,
      ).catch(() => { /* write-back failure is non-fatal; coords still used in-memory */ });
    } catch (e) {
      geocodeFailures.push({
        stopId: stop.id,
        address: addr,
        reason: e instanceof Error ? e.message : 'geocode failed',
      });
    }
  }

  const stopsByShipment = new Map<string, StopRow[]>();
  for (const s of stops) {
    const arr = stopsByShipment.get(s.shipment_order_id) ?? [];
    arr.push(s);
    stopsByShipment.set(s.shipment_order_id, arr);
  }

  return { vehicles, shipments, stopsByShipment, geocodeFailures };
}

// ── Assemble solver input ──────────────────────────────────────────────────

interface AssembledInput {
  solverInput: SolverInput;
  /** Shipments dropped before solving because they lack geocoded stops. */
  preDropped: string[];
}

function pickDepot(vehicles: VehicleRow[], config: OptimizeRequest['config']): LatLng | null {
  if (config?.depotLatitude != null && config?.depotLongitude != null) {
    return { latitude: config.depotLatitude, longitude: config.depotLongitude };
  }
  // Otherwise use the first vehicle that has a depot configured.
  const withDepot = vehicles.find(v => v.depot_latitude != null && v.depot_longitude != null);
  if (withDepot) {
    return { latitude: num(withDepot.depot_latitude), longitude: num(withDepot.depot_longitude) };
  }
  return null;
}

async function assemble(data: LoadedData, req: OptimizeRequest): Promise<AssembledInput> {
  const depot = pickDepot(data.vehicles, req.config);
  if (!depot) {
    throw new Error('No depot configured. Set depot_latitude/longitude on a vehicle or pass it in config.');
  }

  // Build the point list: index 0 = depot, then each usable stop.
  const points: LatLng[] = [depot];
  const stopMatrixIndex = new Map<string, number>();
  const preDropped: string[] = [];

  const usableShipments: SolverShipment[] = [];
  for (const ship of data.shipments) {
    const stops = (data.stopsByShipment.get(ship.id) ?? [])
      .filter(s => s.latitude != null && s.longitude != null);
    const pickup = stops.find(s => s.stop_type.toUpperCase() === 'PICKUP');
    const delivery = stops.find(s => s.stop_type.toUpperCase() === 'DELIVERY');

    if (!pickup || !delivery) {
      preDropped.push(ship.id);
      continue;
    }

    // Register both stops in the matrix point list.
    for (const s of [pickup, delivery]) {
      if (!stopMatrixIndex.has(s.id)) {
        stopMatrixIndex.set(s.id, points.length);
        points.push({ latitude: num(s.latitude), longitude: num(s.longitude) });
      }
    }

    const weightKg = num(ship.total_weight_kg);
    const volumeCbm = num(ship.total_volume_cbm);

    const buildStop = (s: StopRow, type: 'PICKUP' | 'DELIVERY'): SolverStop => ({
      stopId: s.id,
      shipmentId: ship.id,
      type,
      matrixIndex: stopMatrixIndex.get(s.id)!,
      weightKg, volumeCbm,
      serviceDurationMin: s.service_duration_minutes ?? 15,
      windowFromMin: toMinutesFromMidnight(s.planned_arrival_at),
      windowToMin: toMinutesFromMidnight(s.planned_depart_at),
    });

    usableShipments.push({
      shipmentId: ship.id,
      weightKg, volumeCbm,
      pickup: buildStop(pickup, 'PICKUP'),
      delivery: buildStop(delivery, 'DELIVERY'),
    });
  }

  const { distances, durations } = await computeDistanceMatrix(points, {
    provider: req.config?.distanceProvider,
    detourFactor: req.config?.detourFactor,
  });

  const solverVehicles: SolverVehicle[] = data.vehicles.map(v => ({
    vehicleId: v.id,
    driverId: null, // driver assignment is a later concern; left null for v1
    capacityKg: num(v.payload_capacity_kg, 0),
    capacityCbm: num(v.payload_capacity_cbm, Number.MAX_SAFE_INTEGER),
    costPerKm: num(v.cost_per_km, 0),
    shiftStartMin: 480,  // 08:00 default — driver shift columns wired in later
    shiftEndMin: 1080,   // 18:00 default
    maxDriveMin: 600,    // 10h default
  }));

  return {
    solverInput: {
      distances, durations,
      shipments: usableShipments,
      vehicles: solverVehicles,
      objective: req.config?.objective,
    },
    preDropped,
  };
}

// ── Persist ─────────────────────────────────────────────────────────────────

async function persistPlan(args: {
  tenantId: string;
  createdBy: string | null;
  request: OptimizeRequest;
  result: RouteOptimizerResult;
  provider: string;
}): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO logistics_route_plans (
       tenant_id, created_by, status, algorithm, config, input_snapshot, result,
       total_distance_km, total_duration_min, shipments_in, shipments_assigned,
       vehicles_used, estimated_cost
     ) VALUES ($1,$2,'DRAFT','savings',$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    args.tenantId,
    args.createdBy,
    JSON.stringify({ ...args.request.config, provider: args.provider }),
    JSON.stringify({ vehicleIds: args.request.vehicleIds, shipmentIds: args.request.shipmentIds }),
    JSON.stringify(args.result),
    args.result.summary.totalDistanceKm,
    args.result.summary.totalDurationMin,
    args.request.shipmentIds.length,
    args.result.summary.shipmentsAssigned,
    args.result.summary.vehiclesUsed,
    args.result.summary.estimatedCost,
  );
  return rows[0].id;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function runOptimization(req: OptimizeRequest): Promise<OptimizeResponse> {
  await ensureRouteOptimizerSchema();

  if (!req.vehicleIds.length) throw new Error('At least one vehicle is required');
  if (!req.shipmentIds.length) throw new Error('At least one shipment is required');

  const data = await loadAndGeocode(req);
  const { solverInput, preDropped } = await assemble(data, req);

  const result = optimizeRoutes(solverInput);

  // Fold pre-dropped shipments (missing stops/geocode) into the unassigned list.
  for (const id of preDropped) {
    result.unassigned.push({
      shipmentId: id,
      reason: 'NO_VEHICLE_MATCH',
      detail: 'Shipment is missing a geocoded pickup or delivery stop.',
    });
  }
  result.summary.shipmentsUnassigned = result.unassigned.length;

  const planId = await persistPlan({
    tenantId: req.tenantId,
    createdBy: req.createdBy ?? null,
    request: req,
    result,
    provider: solverInput.distances.length ? 'computed' : 'none',
  });

  const status: OptimizeResponse['status'] =
    result.unassigned.length === 0 ? 'COMPLETED' : 'PARTIAL';

  return { planId, status, result, geocodeFailures: data.geocodeFailures };
}

// ── Commit ──────────────────────────────────────────────────────────────────

export async function commitPlan(tenantId: string, planId: string, actorUserId: string): Promise<{ assignmentsCreated: number }> {
  await ensureRouteOptimizerSchema();

  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; result: RouteOptimizerResult }>>(
    `SELECT status, result FROM logistics_route_plans
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
    planId, tenantId,
  );
  const plan = rows[0];
  if (!plan) throw new Error('Plan not found');
  if (plan.status === 'COMMITTED') return { assignmentsCreated: 0 };  // idempotent
  if (plan.status === 'DISCARDED') throw new Error('Cannot commit a discarded plan');

  const result = plan.result;
  let created = 0;

  for (const route of result.routes) {
    const shipmentIds = [...new Set(route.stops.map(s => s.shipmentId))];
    for (let i = 0; i < shipmentIds.length; i++) {
      const shipmentId = shipmentIds[i];
      await prisma.$executeRawUnsafe(
        `INSERT INTO logistics_assignments (
           tenant_id, shipment_order_id, vehicle_id, driver_id,
           assignment_type, status, route_plan_id, sequence_in_route
         ) VALUES ($1,$2,$3,$4,'CARRIER','ASSIGNED',$5,$6)`,
        tenantId, shipmentId, route.vehicleId, route.driverId, planId, i + 1,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_shipment_orders
            SET status = 'ASSIGNED', updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('DELIVERED','CANCELLED','CLOSED')`,
        shipmentId, tenantId,
      ).catch(() => { /* status flip is best-effort */ });
      created += 1;
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_route_plans
        SET status = 'COMMITTED', committed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    planId, tenantId,
  );

  return { assignmentsCreated: created };
}

export async function discardPlan(tenantId: string, planId: string): Promise<void> {
  await ensureRouteOptimizerSchema();
  await prisma.$executeRawUnsafe(
    `UPDATE logistics_route_plans
        SET status = 'DISCARDED', deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = 'DRAFT'`,
    planId, tenantId,
  );
}

export async function getPlan(tenantId: string, planId: string): Promise<{ id: string; status: string; result: RouteOptimizerResult } | null> {
  await ensureRouteOptimizerSchema();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string; result: RouteOptimizerResult }>>(
    `SELECT id, status, result FROM logistics_route_plans
      WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    planId, tenantId,
  );
  return rows[0] ?? null;
}

export async function listPlans(tenantId: string, opts: { status?: string | null; limit?: number; days?: number } = {}): Promise<Array<Record<string, unknown>>> {
  await ensureRouteOptimizerSchema();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const days = Math.min(Math.max(opts.days ?? 7, 1), 365);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, status, algorithm, created_at::text, created_by,
            total_distance_km::text, total_duration_min,
            shipments_in, shipments_assigned, vehicles_used, estimated_cost::text
       FROM logistics_route_plans
      WHERE tenant_id = $1
        AND created_at >= $2::timestamptz
        AND ($3::text IS NULL OR status = $3)
      ORDER BY created_at DESC
      LIMIT $4`,
    tenantId, from, opts.status ?? null, limit,
  );
}
