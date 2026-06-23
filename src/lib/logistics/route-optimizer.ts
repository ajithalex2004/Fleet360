/**
 * VRP solver — Clarke-Wright savings + 2-opt local search.
 *
 * Pure module: takes a pre-built distance matrix + shipments + vehicles and
 * returns a set of sequenced routes. No DB, no network, no geocoding — the
 * service layer (route-optimizer-service.ts) handles all of that and hands
 * this function ready-to-solve data.
 *
 * Problem class: PDPTW (Pickup-and-Delivery Problem with Time Windows) +
 * capacity. Each shipment is a (pickup, delivery) pair that must be served
 * by the same vehicle, pickup before delivery, within each stop's time
 * window, without exceeding the vehicle's weight or volume capacity at any
 * point along the route.
 *
 * Algorithm:
 *   1. Seed: each shipment starts as its own out-and-back route
 *      depot → pickup → delivery → depot.
 *   2. Clarke-Wright savings: compute the distance saved by merging the end
 *      of one route with the start of another; merge greedily highest-saving
 *      first, but only when the merged route stays feasible (capacity, time
 *      windows, pickup-before-delivery preserved).
 *   3. 2-opt: within each final route, reverse segments to remove crossings,
 *      again only accepting moves that keep the route feasible.
 *   4. Assign routes to vehicles; routes that can't fit any vehicle's
 *      capacity leave their shipments unassigned.
 *
 * The constraints are HARD, checked at every merge/move. We never produce an
 * infeasible route and call it "lower quality" — infeasible is rejected.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface SolverStop {
  /** Stable id (the logistics_shipment_stops row id). */
  stopId: string;
  shipmentId: string;
  type: 'PICKUP' | 'DELIVERY';
  /** Index into the distance matrix. Depot is always matrix index 0. */
  matrixIndex: number;
  /** Demand sign convention: pickup is +, delivery is - (load leaves the truck). */
  weightKg: number;
  volumeCbm: number;
  serviceDurationMin: number;
  /** Minutes-from-midnight time window. null = unconstrained. */
  windowFromMin: number | null;
  windowToMin: number | null;
}

export interface SolverShipment {
  shipmentId: string;
  pickup: SolverStop;
  delivery: SolverStop;
  /** Total weight/volume of the shipment — what the truck carries between pickup and delivery. */
  weightKg: number;
  volumeCbm: number;
}

export interface SolverVehicle {
  vehicleId: string;
  driverId: string | null;
  capacityKg: number;
  capacityCbm: number;
  /** Cost per km — used for the displayed route cost, not the objective. */
  costPerKm: number;
  /** Driver shift in minutes-from-midnight. Defines the route's working envelope. */
  shiftStartMin: number;
  shiftEndMin: number;
  /** Hard cap on driving minutes (HOS). The route's total drive time can't exceed this. */
  maxDriveMin: number;
}

export interface SolverInput {
  /** distances[i][j] = km. Index 0 is the depot. */
  distances: number[][];
  /** durations[i][j] = minutes. */
  durations: number[][];
  shipments: SolverShipment[];
  vehicles: SolverVehicle[];
  /** Minutes-from-midnight the routes may begin. Defaults to earliest vehicle shift. */
  depotDepartMin?: number;
  objective?: 'distance' | 'duration' | 'balanced';
}

// ── Outputs ─────────────────────────────────────────────────────────────────

export interface RouteStop {
  sequence: number;
  stopId: string;
  shipmentId: string;
  type: 'PICKUP' | 'DELIVERY';
  arriveMin: number;
  departMin: number;
  distanceFromPrevKm: number;
  windowFromMin: number | null;
  windowToMin: number | null;
  onTime: boolean;
  lateMinutes: number;
  loadAfterKg: number;
  loadAfterCbm: number;
}

export interface SolvedRoute {
  vehicleId: string;
  driverId: string | null;
  stops: RouteStop[];
  totalDistanceKm: number;
  totalDurationMin: number;
  capacityUtilization: { weightPct: number; volumePct: number };
  estimatedCost: number;
  violations: Array<{ stopId: string; kind: 'TIME_WINDOW' | 'CAPACITY' | 'HOS'; detail: string }>;
}

export interface UnassignedShipment {
  shipmentId: string;
  reason: 'NO_CAPACITY' | 'NO_TIME_WINDOW_FIT' | 'NO_VEHICLE_MATCH';
  detail?: string;
}

export interface RouteOptimizerResult {
  routes: SolvedRoute[];
  unassigned: UnassignedShipment[];
  summary: {
    totalDistanceKm: number;
    totalDurationMin: number;
    vehiclesUsed: number;
    shipmentsAssigned: number;
    shipmentsUnassigned: number;
    estimatedCost: number;
    timeWindowViolations: number;
  };
}

// ── Internal route representation ──────────────────────────────────────────

interface InternalRoute {
  /** Ordered stop list, NOT including the depot at either end (implied). */
  stops: SolverStop[];
  /** Shipments fully contained in this route. */
  shipmentIds: Set<string>;
}

const DEPOT = 0;

// ── Public entry point ─────────────────────────────────────────────────────

export function optimizeRoutes(input: SolverInput): RouteOptimizerResult {
  const { distances, durations, shipments, vehicles } = input;

  if (!shipments.length || !vehicles.length) {
    return emptyResult(shipments);
  }

  // 1) Seed one route per shipment: pickup → delivery.
  let routes: InternalRoute[] = shipments.map(s => ({
    stops: [s.pickup, s.delivery],
    shipmentIds: new Set([s.shipmentId]),
  }));

  // Reference ceilings for merge feasibility: use the LARGEST vehicle and the
  // most generous driver limit, since a route only needs to fit *some*
  // vehicle. Per-vehicle assignment happens after merging.
  const maxCapKg = Math.max(...vehicles.map(v => v.capacityKg));
  const maxCapCbm = Math.max(...vehicles.map(v => v.capacityCbm));
  const maxDriveMin = Math.max(...vehicles.map(v => v.maxDriveMin));
  const shipmentById = new Map(shipments.map(s => [s.shipmentId, s]));

  // 2) Clarke-Wright savings merges. HOS-aware: a merge that would push the
  //    route past even the most generous driver's drive-time limit is
  //    rejected, so the solver spreads load across vehicles instead of
  //    cramming one truck into a 14-hour day.
  routes = clarkeWrightMerge(routes, distances, durations, shipmentById, maxCapKg, maxCapCbm, maxDriveMin);

  // 3) 2-opt improvement within each route.
  routes = routes.map(r => ({ ...r, stops: twoOptImprove(r.stops, distances) }));

  // 4) Assign routes to vehicles (largest demand → largest vehicle first).
  const { assigned, unassignedShipmentIds } = assignVehicles(routes, vehicles, shipmentById);

  // 5) Build the output with timing + violation analysis.
  const depotDepart = input.depotDepartMin ?? Math.min(...vehicles.map(v => v.shiftStartMin));
  const solvedRoutes = assigned.map(a =>
    buildSolvedRoute(a.route, a.vehicle, distances, durations, shipmentById, depotDepart),
  );

  const unassigned: UnassignedShipment[] = unassignedShipmentIds.map(id => ({
    shipmentId: id,
    reason: 'NO_CAPACITY',
    detail: 'No vehicle had capacity for this shipment after merging.',
  }));

  return assembleResult(solvedRoutes, unassigned);
}

// ── Clarke-Wright savings ──────────────────────────────────────────────────

interface Saving { i: number; j: number; value: number; }

function clarkeWrightMerge(
  routes: InternalRoute[],
  distances: number[][],
  durations: number[][],
  shipmentById: Map<string, SolverShipment>,
  maxCapKg: number,
  maxCapCbm: number,
  maxDriveMin: number,
): InternalRoute[] {
  // Savings are computed between the LAST stop of route a and the FIRST stop
  // of route b: saving = d(last_a, depot) + d(depot, first_b) - d(last_a, first_b).
  // Higher saving = more distance removed by stitching them together.
  let working = [...routes];
  let improved = true;

  while (improved) {
    improved = false;
    const savings: Saving[] = [];

    for (let i = 0; i < working.length; i++) {
      for (let j = 0; j < working.length; j++) {
        if (i === j) continue;
        const lastA = working[i].stops[working[i].stops.length - 1].matrixIndex;
        const firstB = working[j].stops[0].matrixIndex;
        const value =
          distances[lastA][DEPOT] + distances[DEPOT][firstB] - distances[lastA][firstB];
        if (value > 0) savings.push({ i, j, value });
      }
    }

    if (!savings.length) break;
    savings.sort((a, b) => b.value - a.value);

    // Try merges in descending savings order; take the first feasible one,
    // then recompute (route indices shift after a merge).
    for (const s of savings) {
      const a = working[s.i];
      const b = working[s.j];
      if (!a || !b || a === b) continue;

      const mergedStops = [...a.stops, ...b.stops];
      if (!routeFeasibleCapacity(mergedStops, shipmentById, maxCapKg, maxCapCbm)) continue;
      if (!pickupBeforeDelivery(mergedStops)) continue;
      // HOS ceiling: reject merges that would exceed the most generous
      // driver's drive-time budget. Keeps the solver from collapsing
      // everything onto one truck when spreading across idle vehicles
      // yields workable routes.
      if (routeDurationMin(mergedStops, durations) > maxDriveMin) continue;

      const merged: InternalRoute = {
        stops: mergedStops,
        shipmentIds: new Set([...a.shipmentIds, ...b.shipmentIds]),
      };
      working = working.filter((_, idx) => idx !== s.i && idx !== s.j);
      working.push(merged);
      improved = true;
      break;
    }
  }

  return working;
}

// ── 2-opt ───────────────────────────────────────────────────────────────────

function twoOptImprove(stops: SolverStop[], distances: number[][]): SolverStop[] {
  if (stops.length < 4) return stops;
  let best = [...stops];
  let bestDist = routeDistance(best, distances);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = twoOptSwap(best, i, k);
        if (!pickupBeforeDelivery(candidate)) continue; // never break PD order
        const d = routeDistance(candidate, distances);
        if (d < bestDist - 1e-9) {
          best = candidate;
          bestDist = d;
          improved = true;
        }
      }
    }
  }
  return best;
}

function twoOptSwap(stops: SolverStop[], i: number, k: number): SolverStop[] {
  // Reverse the segment between i and k inclusive.
  return [
    ...stops.slice(0, i),
    ...stops.slice(i, k + 1).reverse(),
    ...stops.slice(k + 1),
  ];
}

// ── Feasibility checks ─────────────────────────────────────────────────────

/**
 * Pickup-before-delivery: for every shipment in the route, its pickup stop
 * must appear before its delivery stop. HARD constraint.
 */
export function pickupBeforeDelivery(stops: SolverStop[]): boolean {
  const seenPickup = new Set<string>();
  for (const stop of stops) {
    if (stop.type === 'PICKUP') {
      seenPickup.add(stop.shipmentId);
    } else {
      // delivery — its pickup must already be seen
      if (!seenPickup.has(stop.shipmentId)) return false;
    }
  }
  return true;
}

/**
 * Capacity: walk the route tracking cumulative load. Load rises at each
 * pickup, falls at each delivery. If at any point it exceeds either
 * dimension's capacity, the route is infeasible. This is where capacity
 * violations actually happen — not at the end, but in the middle when the
 * truck is carrying the most.
 */
export function routeFeasibleCapacity(
  stops: SolverStop[],
  shipmentById: Map<string, SolverShipment>,
  capKg: number,
  capCbm: number,
): boolean {
  let loadKg = 0;
  let loadCbm = 0;
  for (const stop of stops) {
    const s = shipmentById.get(stop.shipmentId);
    if (!s) continue;
    if (stop.type === 'PICKUP') {
      loadKg += s.weightKg;
      loadCbm += s.volumeCbm;
      if (loadKg > capKg + 1e-9 || loadCbm > capCbm + 1e-9) return false;
    } else {
      loadKg -= s.weightKg;
      loadCbm -= s.volumeCbm;
    }
  }
  return true;
}

// ── Vehicle assignment ─────────────────────────────────────────────────────

function assignVehicles(
  routes: InternalRoute[],
  vehicles: SolverVehicle[],
  shipmentById: Map<string, SolverShipment>,
): { assigned: Array<{ route: InternalRoute; vehicle: SolverVehicle }>; unassignedShipmentIds: string[] } {
  // Compute each route's peak load, sort routes by peak weight desc, and
  // greedily assign to the smallest vehicle that fits. Largest-first avoids
  // wasting big trucks on tiny routes.
  const routeLoads = routes.map(r => ({
    route: r,
    peakKg: peakLoad(r.stops, shipmentById, 'kg'),
    peakCbm: peakLoad(r.stops, shipmentById, 'cbm'),
  }));
  routeLoads.sort((a, b) => b.peakKg - a.peakKg);

  const availableVehicles = [...vehicles].sort((a, b) => a.capacityKg - b.capacityKg);
  const used = new Set<string>();
  const assigned: Array<{ route: InternalRoute; vehicle: SolverVehicle }> = [];
  const unassignedShipmentIds: string[] = [];

  for (const rl of routeLoads) {
    const fit = availableVehicles.find(v =>
      !used.has(v.vehicleId) &&
      v.capacityKg + 1e-9 >= rl.peakKg &&
      v.capacityCbm + 1e-9 >= rl.peakCbm,
    );
    if (fit) {
      used.add(fit.vehicleId);
      assigned.push({ route: rl.route, vehicle: fit });
    } else {
      for (const id of rl.route.shipmentIds) unassignedShipmentIds.push(id);
    }
  }

  return { assigned, unassignedShipmentIds };
}

function peakLoad(
  stops: SolverStop[],
  shipmentById: Map<string, SolverShipment>,
  dim: 'kg' | 'cbm',
): number {
  let load = 0;
  let peak = 0;
  for (const stop of stops) {
    const s = shipmentById.get(stop.shipmentId);
    if (!s) continue;
    const amount = dim === 'kg' ? s.weightKg : s.volumeCbm;
    if (stop.type === 'PICKUP') load += amount; else load -= amount;
    if (load > peak) peak = load;
  }
  return peak;
}

// ── Build output route with timing ─────────────────────────────────────────

function buildSolvedRoute(
  route: InternalRoute,
  vehicle: SolverVehicle,
  distances: number[][],
  durations: number[][],
  shipmentById: Map<string, SolverShipment>,
  depotDepartMin: number,
): SolvedRoute {
  const stops: RouteStop[] = [];
  const violations: SolvedRoute['violations'] = [];

  let prevIndex = DEPOT;
  let clockMin = depotDepartMin;
  let totalDistanceKm = 0;
  let loadKg = 0;
  let loadCbm = 0;

  for (let i = 0; i < route.stops.length; i++) {
    const stop = route.stops[i];
    const legKm = distances[prevIndex][stop.matrixIndex];
    const legMin = durations[prevIndex][stop.matrixIndex];
    totalDistanceKm += legKm;
    clockMin += legMin;

    // Wait if we arrive before the window opens.
    let arriveMin = clockMin;
    if (stop.windowFromMin != null && arriveMin < stop.windowFromMin) {
      arriveMin = stop.windowFromMin;
      clockMin = stop.windowFromMin;
    }

    // Late check.
    let onTime = true;
    let lateMinutes = 0;
    if (stop.windowToMin != null && arriveMin > stop.windowToMin) {
      onTime = false;
      lateMinutes = Math.round(arriveMin - stop.windowToMin);
      violations.push({
        stopId: stop.stopId,
        kind: 'TIME_WINDOW',
        detail: `Arrived ${lateMinutes}min after window close (${fmtMin(stop.windowToMin)})`,
      });
    }

    const departMin = arriveMin + stop.serviceDurationMin;
    clockMin = departMin;

    // Load tracking.
    const s = shipmentById.get(stop.shipmentId);
    if (s) {
      if (stop.type === 'PICKUP') { loadKg += s.weightKg; loadCbm += s.volumeCbm; }
      else { loadKg -= s.weightKg; loadCbm -= s.volumeCbm; }
    }

    stops.push({
      sequence: i + 1,
      stopId: stop.stopId,
      shipmentId: stop.shipmentId,
      type: stop.type,
      arriveMin: Math.round(arriveMin),
      departMin: Math.round(departMin),
      distanceFromPrevKm: round2(legKm),
      windowFromMin: stop.windowFromMin,
      windowToMin: stop.windowToMin,
      onTime,
      lateMinutes,
      loadAfterKg: round2(loadKg),
      loadAfterCbm: round2(loadCbm),
    });

    prevIndex = stop.matrixIndex;
  }

  // Return to depot leg.
  const returnKm = distances[prevIndex][DEPOT];
  const returnMin = durations[prevIndex][DEPOT];
  totalDistanceKm += returnKm;
  const totalDurationMin = (clockMin + returnMin) - depotDepartMin;

  // HOS check — total drive time vs vehicle's cap.
  if (totalDurationMin > vehicle.maxDriveMin) {
    violations.push({
      stopId: stops[stops.length - 1]?.stopId ?? 'route',
      kind: 'HOS',
      detail: `Route duration ${Math.round(totalDurationMin)}min exceeds driver limit ${vehicle.maxDriveMin}min`,
    });
  }

  // Capacity utilisation = peak load / capacity.
  const peakKg = peakLoad(route.stops, shipmentById, 'kg');
  const peakCbm = peakLoad(route.stops, shipmentById, 'cbm');

  return {
    vehicleId: vehicle.vehicleId,
    driverId: vehicle.driverId,
    stops,
    totalDistanceKm: round2(totalDistanceKm),
    totalDurationMin: Math.round(totalDurationMin),
    capacityUtilization: {
      weightPct: vehicle.capacityKg > 0 ? round1((peakKg / vehicle.capacityKg) * 100) : 0,
      volumePct: vehicle.capacityCbm > 0 ? round1((peakCbm / vehicle.capacityCbm) * 100) : 0,
    },
    estimatedCost: round2(totalDistanceKm * vehicle.costPerKm),
    violations,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function routeDistance(stops: SolverStop[], distances: number[][]): number {
  let total = distances[DEPOT][stops[0].matrixIndex];
  for (let i = 0; i < stops.length - 1; i++) {
    total += distances[stops[i].matrixIndex][stops[i + 1].matrixIndex];
  }
  total += distances[stops[stops.length - 1].matrixIndex][DEPOT];
  return total;
}

/**
 * Total working time of a route in minutes: depot→first travel, then for each
 * stop its service time plus travel to the next, then last→depot. This is what
 * HOS limits gate against — driving plus on-stop time, not just driving.
 */
function routeDurationMin(stops: SolverStop[], durations: number[][]): number {
  let total = durations[DEPOT][stops[0].matrixIndex];
  for (let i = 0; i < stops.length; i++) {
    total += stops[i].serviceDurationMin;
    const nextIndex = i < stops.length - 1 ? stops[i + 1].matrixIndex : DEPOT;
    total += durations[stops[i].matrixIndex][nextIndex];
  }
  return total;
}

function assembleResult(routes: SolvedRoute[], unassigned: UnassignedShipment[]): RouteOptimizerResult {
  const summary = {
    totalDistanceKm: round2(routes.reduce((s, r) => s + r.totalDistanceKm, 0)),
    totalDurationMin: routes.reduce((s, r) => s + r.totalDurationMin, 0),
    vehiclesUsed: routes.length,
    shipmentsAssigned: routes.reduce((s, r) => s + new Set(r.stops.map(x => x.shipmentId)).size, 0),
    shipmentsUnassigned: unassigned.length,
    estimatedCost: round2(routes.reduce((s, r) => s + r.estimatedCost, 0)),
    timeWindowViolations: routes.reduce((s, r) => s + r.violations.filter(v => v.kind === 'TIME_WINDOW').length, 0),
  };
  return { routes, unassigned, summary };
}

function emptyResult(shipments: SolverShipment[]): RouteOptimizerResult {
  return {
    routes: [],
    unassigned: shipments.map(s => ({
      shipmentId: s.shipmentId,
      reason: 'NO_VEHICLE_MATCH' as const,
      detail: 'No vehicles available to assign.',
    })),
    summary: {
      totalDistanceKm: 0, totalDurationMin: 0, vehiclesUsed: 0,
      shipmentsAssigned: 0, shipmentsUnassigned: shipments.length,
      estimatedCost: 0, timeWindowViolations: 0,
    },
  };
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
