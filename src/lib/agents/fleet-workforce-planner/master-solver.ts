/**
 * Global Master Fleet & Workforce Constraint Solver
 * --------------------------------------------------
 * Assigns a vehicle and a driver to every trip of the plan date, three ways,
 * and reports each from what it actually assigned:
 *
 *   A  Lowest cost        packs trips onto as few vehicles and drivers as
 *                         possible; overtime allowed; nothing held back.
 *   B  Balanced           packs vehicles but spreads driver workload, and
 *                         keeps one real spare vehicle and driver on standby
 *                         when that still covers every trip A covers.
 *   C  Maximum resilience no overtime, and up to two spare vehicles and
 *                         drivers held back; trips it cannot cover are
 *                         outsourced at the charter rate.
 *
 * Hard constraints, in every scenario: seating capacity; no vehicle on two
 * trips at once (turnaround and deadhead included); no driver on two trips at
 * once (with a break between); the driver's licence must authorise the trip;
 * daily duty within the policy. Standby resources are real vehicles and
 * drivers the scenario left unused, never placeholders.
 */

import {
  FleetWorkforcePlanningRequest,
  MasterPlanResult,
  PlanScenario,
  MasterAssignmentTriplet,
  MaintenanceSlotAssignment,
  StandbyAllocation,
  PlanFeasibilityState,
  DriverHoursPolicy,
} from '../types';
import { driverHoursPolicyEngine } from './policy-engine';
import { resourceCostEngine } from './cost-engine';
import { repositionSolver, DepotInventoryState } from './reposition-solver';

type Req = FleetWorkforcePlanningRequest;
type Trip = Req['trips'][number];
type Vehicle = Req['vehicles'][number];
type Driver = Req['drivers'][number];
type Point = { lat: number; lng: number };

// TripScheduleItem's location fields are a union; only some members carry a
// name, and coordinates come as lat/lng or latitude/longitude.
type LocationFields = { name?: string; addressName?: string; lat?: number; lng?: number; latitude?: number; longitude?: number };

/** Vehicle turnaround between trips, minutes (cleaning, boarding). */
const TURNAROUND_MIN = 15;
/** Minimum rest between two trips of one driver, minutes. */
const DRIVER_GAP_MIN = 15;
/** Deadhead speed for the straight-line estimate, km/h; and road factor. */
const DEADHEAD_KMH = 40;
const ROAD_FACTOR = 1.3;
const NO_DEPOT = 'UNASSIGNED';

const vehicleKey = (v: Vehicle) => v.vehicleId || v.id || v.vehicleCode;
const driverKey = (d: Driver) => d.driverId || d.id || d.driverName || d.name || 'driver';
const driverLabel = (d: Driver) => d.driverName || d.name || driverKey(d);

function pointOf(loc: unknown): Point | null {
  const l = loc as LocationFields | undefined;
  if (!l) return null;
  const lat = typeof l.lat === 'number' ? l.lat : l.latitude;
  const lng = typeof l.lng === 'number' ? l.lng : l.longitude;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function nameOf(loc: unknown, fallback: string): string {
  const l = loc as LocationFields | undefined;
  return l?.addressName || l?.name || fallback;
}

function haversineKm(a: Point, b: Point): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Licences a driver holds, upper-cased (licenseClasses and licenseCategory). */
function licencesOf(d: Driver): Set<string> {
  return new Set([...(d.licenseClasses ?? []), ...(d.licenseCategory ? [d.licenseCategory] : [])].map((c) => c.toUpperCase()));
}

const HEAVY_PASSENGER = ['HEAVY_BUS', 'BUS', 'CATEGORY_6'];

/**
 * Whether the driver may drive the trip. A route's required licence (LIGHT,
 * HEAVY, BUS) wins; otherwise a bus / coach / coaster category needs a bus
 * licence. A driver with no licence on record is only allowed light trips.
 */
function licensedFor(d: Driver, trip: Trip, category: string): boolean {
  const held = licencesOf(d);
  const required = (trip.requiredLicenseType ?? '').toUpperCase();
  if (required === 'BUS') return HEAVY_PASSENGER.some((c) => held.has(c));
  if (required === 'HEAVY') return held.has('HEAVY') || HEAVY_PASSENGER.some((c) => held.has(c));
  if (required === 'LIGHT') return held.size > 0;
  const heavyCategory = /BUS|COACH|COASTER/.test(category);
  return heavyCategory ? HEAVY_PASSENGER.some((c) => held.has(c)) : true;
}

interface TripWindow {
  trip: Trip;
  start: number;
  end: number;
  durationMin: number;
  category: string;
  passengers: number;
  from: Point | null;
  to: Point | null;
}

function windowsOf(trips: Trip[], scheduleDate: string): TripWindow[] {
  return trips
    .map((trip) => {
      const start = new Date(trip.plannedPickupTime || trip.startTime || `${scheduleDate}T07:00:00Z`).getTime();
      const rawEnd = new Date(trip.plannedDropoffTime || trip.endTime || `${scheduleDate}T08:30:00Z`).getTime();
      const end = Math.max(rawEnd, start + 30 * 60000);
      return {
        trip,
        start,
        end,
        durationMin: Math.round((end - start) / 60000),
        category: (trip.vehicleCategoryRequired || trip.requiredVehicleType || 'COASTER_30').toUpperCase(),
        passengers: trip.passengerCount || 0,
        from: pointOf(trip.startLocation ?? trip.origin),
        to: pointOf(trip.endLocation ?? trip.destination),
      };
    })
    .sort((a, b) => a.start - b.start);
}

interface RunOptions {
  allowOvertime: boolean;
  /** Spread driver workload (least-loaded first) instead of packing. */
  balanceDrivers: boolean;
  reservedVehicles: Set<string>;
  reservedDrivers: Set<string>;
}

interface RunResult {
  assignments: MasterAssignmentTriplet[];
  unserved: TripWindow[];
  usedVehicles: Set<string>;
  usedDrivers: Set<string>;
  dutyByDriver: Map<string, number>;
  opCost: number;
  overtimeMin: number;
  overtimeCost: number;
  reuseCount: number;
}

function runAssignment(
  windows: TripWindow[],
  vehicles: Vehicle[],
  drivers: Driver[],
  policy: DriverHoursPolicy,
  req: Req,
  opts: RunOptions,
): RunResult {
  const vehicleTrips = new Map<string, TripWindow[]>();
  const driverTrips = new Map<string, TripWindow[]>();
  const dutyByDriver = new Map<string, number>();
  for (const d of drivers) dutyByDriver.set(driverKey(d), d.dutyMinutesUsed || 0);

  const result: RunResult = {
    assignments: [],
    unserved: [],
    usedVehicles: new Set(),
    usedDrivers: new Set(),
    dutyByDriver,
    opCost: 0,
    overtimeMin: 0,
    overtimeCost: 0,
    reuseCount: 0,
  };
  const dutyCapMin = (opts.allowOvertime ? policy.maxDailyDutyHours : policy.normalDailyHours) * 60;

  for (const w of windows) {
    // Vehicle: fits, free for the trip including the move from its last trip.
    let chosenVehicle: { v: Vehicle; prev: TripWindow | null; deadheadKm: number; deadheadMin: number } | null = null;
    const vehicleCandidates = vehicles
      .filter((v) => !opts.reservedVehicles.has(vehicleKey(v)))
      .filter((v) => (v.capacity || v.seatingCapacity || 0) >= w.passengers)
      .map((v) => {
        const booked = vehicleTrips.get(vehicleKey(v)) ?? [];
        const prev = [...booked].filter((b) => b.end <= w.start).sort((a, b) => b.end - a.end)[0] ?? null;
        const km = prev && prev.to && w.from ? haversineKm(prev.to, w.from) * ROAD_FACTOR : 0;
        const deadheadMin = Math.round((km / DEADHEAD_KMH) * 60);
        const free = booked.every((b) => {
          const gapBefore = b.end <= w.start ? w.start - b.end >= (TURNAROUND_MIN + (b === prev ? deadheadMin : 0)) * 60000 : false;
          const gapAfter = b.start >= w.end ? b.start - w.end >= TURNAROUND_MIN * 60000 : false;
          return gapBefore || gapAfter;
        });
        return { v, prev, deadheadKm: Math.round(km * 10) / 10, deadheadMin, free, used: booked.length > 0 };
      })
      .filter((c) => c.free)
      // Reuse a vehicle already on the road, then the smallest that fits.
      .sort((a, b) => Number(b.used) - Number(a.used) || (a.v.capacity || a.v.seatingCapacity || 0) - (b.v.capacity || b.v.seatingCapacity || 0));
    if (vehicleCandidates[0]) chosenVehicle = vehicleCandidates[0];

    // Driver: licensed, free (with a break), within the duty cap.
    const driverCandidates = drivers
      .filter((d) => !opts.reservedDrivers.has(driverKey(d)))
      .filter((d) => licensedFor(d, w.trip, w.category))
      .filter((d) => {
        const booked = driverTrips.get(driverKey(d)) ?? [];
        return booked.every((b) => b.end + DRIVER_GAP_MIN * 60000 <= w.start || w.end + DRIVER_GAP_MIN * 60000 <= b.start);
      })
      .filter((d) => {
        const used = dutyByDriver.get(driverKey(d)) ?? 0;
        return used + w.durationMin <= dutyCapMin && driverHoursPolicyEngine.validateDutyBlock(policy, used, 0, w.durationMin).isValid;
      })
      .sort((a, b) => {
        const ua = dutyByDriver.get(driverKey(a)) ?? 0;
        const ub = dutyByDriver.get(driverKey(b)) ?? 0;
        // Continuity: the driver already on this vehicle first.
        const onVehicle = (d: Driver) =>
          chosenVehicle?.prev ? result.assignments.some((x) => x.tripId === chosenVehicle!.prev!.trip.id && x.driverId === driverKey(d)) : false;
        const cont = Number(onVehicle(b)) - Number(onVehicle(a));
        if (cont !== 0) return cont;
        return opts.balanceDrivers ? ua - ub : ub - ua;
      });

    const driver = driverCandidates[0];
    if (!chosenVehicle || !driver) {
      result.unserved.push(w);
      continue;
    }

    const { v, prev, deadheadKm, deadheadMin } = chosenVehicle;
    const vKey = vehicleKey(v);
    const dKey = driverKey(driver);
    const isReused = (vehicleTrips.get(vKey)?.length ?? 0) > 0;
    if (isReused) result.reuseCount++;
    vehicleTrips.set(vKey, [...(vehicleTrips.get(vKey) ?? []), w]);
    driverTrips.set(dKey, [...(driverTrips.get(dKey) ?? []), w]);

    const before = dutyByDriver.get(dKey) ?? 0;
    const after = before + w.durationMin + deadheadMin;
    dutyByDriver.set(dKey, after);
    result.usedVehicles.add(vKey);
    result.usedDrivers.add(dKey);

    const cost = resourceCostEngine.resolveCostProfile(w.category, req.costProfile);
    const tripCost = Math.round((cost.fixedDailyCostAed * 0.4 + (w.durationMin / 60) * cost.driverHourlyRateAed + deadheadKm * cost.variableCostPerKm + 20) * 100) / 100;
    const normalMin = policy.normalDailyHours * 60;
    const overtimeMin = Math.max(0, after - Math.max(normalMin, before));
    const overtimeAed = Math.round((overtimeMin / 60) * cost.driverOvertimeHourlyRateAed * 100) / 100;
    result.overtimeMin += overtimeMin;
    result.overtimeCost += overtimeAed;
    result.opCost += tripCost + overtimeAed;

    const priorDriverTrip = (driverTrips.get(dKey) ?? []).filter((b) => b !== w && b.end <= w.start).sort((a, b) => b.end - a.end)[0];
    const split = priorDriverTrip ? w.start - priorDriverTrip.end >= 3 * 3600000 : false;
    const hour = new Date(w.start).getUTCHours();

    result.assignments.push({
      assignmentId: `asgn-${w.trip.id}`,
      tripId: w.trip.id,
      tripNumber: w.trip.tripNumber,
      clientName: w.trip.clientName,
      originName: nameOf(w.trip.startLocation ?? w.trip.origin, 'Start'),
      destinationName: nameOf(w.trip.endLocation ?? w.trip.destination, 'End'),
      pickupTime: new Date(w.start).toISOString(),
      dropoffTime: new Date(w.end).toISOString(),
      passengerCount: w.passengers,
      vehicleId: vKey,
      vehicleCode: v.vehicleCode,
      vehicleCategory: w.category,
      driverId: dKey,
      driverName: driverLabel(driver),
      depotId: v.currentDepotId || NO_DEPOT,
      shiftType: split ? (hour < 8 ? 'SPLIT_SHIFT_MORNING' : 'SPLIT_SHIFT_EVENING') : 'SINGLE_SHIFT',
      isReusedVehicle: isReused,
      deadheadFromPreviousKm: deadheadKm,
      deadheadDurationMin: deadheadMin,
      turnaroundBufferMin: prev ? Math.max(0, Math.round((w.start - prev.end) / 60000) - deadheadMin) : 0,
      operatingCostAed: tripCost,
      overtimeMinutes: overtimeMin,
      overtimeCostAed: overtimeAed,
      totalCostAed: Math.round((tripCost + overtimeAed) * 100) / 100,
    });
  }
  result.opCost = Math.round(result.opCost * 100) / 100;
  result.overtimeCost = Math.round(result.overtimeCost * 100) / 100;
  return result;
}

/** Real spare resources: the largest-capacity vehicles and licensed drivers a run left unused. */
function spares(vehicles: Vehicle[], drivers: Driver[], run: RunResult, maxVehicles: number, maxDrivers: number) {
  const v = vehicles
    .filter((x) => !run.usedVehicles.has(vehicleKey(x)))
    .sort((a, b) => (b.capacity || b.seatingCapacity || 0) - (a.capacity || a.seatingCapacity || 0))
    .slice(0, maxVehicles);
  const d = drivers
    .filter((x) => !run.usedDrivers.has(driverKey(x)))
    .sort((a, b) => Number(HEAVY_PASSENGER.some((c) => licencesOf(b).has(c))) - Number(HEAVY_PASSENGER.some((c) => licencesOf(a).has(c))))
    .slice(0, maxDrivers);
  return { vehicles: v, drivers: d };
}

function standbyAllocations(
  standbyVehicles: Vehicle[],
  standbyDrivers: Driver[],
  depots: Req['depots'],
  windows: TripWindow[],
  reason: string,
): StandbyAllocation[] {
  if (standbyVehicles.length === 0 && standbyDrivers.length === 0) return [];
  const byDepot = new Map<string, { v: Vehicle[]; d: Driver[] }>();
  for (const v of standbyVehicles) {
    const k = v.currentDepotId || NO_DEPOT;
    byDepot.set(k, { v: [...(byDepot.get(k)?.v ?? []), v], d: byDepot.get(k)?.d ?? [] });
  }
  for (const d of standbyDrivers) {
    const k = d.currentDepotId || NO_DEPOT;
    byDepot.set(k, { v: byDepot.get(k)?.v ?? [], d: [...(byDepot.get(k)?.d ?? []), d] });
  }
  // Standby covers the plan's busy window: first pickup to last drop-off.
  const first = windows[0]?.start;
  const last = windows.reduce((m, w) => Math.max(m, w.end), 0);
  return [...byDepot.entries()].map(([depotId, g]) => ({
    depotId,
    depotName: depots.find((x) => x.id === depotId)?.name ?? (depotId === NO_DEPOT ? 'No depot recorded' : depotId),
    standbyBusesCount: g.v.length,
    standbyVehicles: g.v.map((v) => ({ vehicleId: vehicleKey(v), vehicleCode: v.vehicleCode, category: (v.category || v.vehicleType || '').toString() })),
    standbyDriversCount: g.d.length,
    standbyDrivers: g.d.map((d) => ({ driverId: driverKey(d), driverName: driverLabel(d), licenseClass: [...licencesOf(d)].join(', ') || 'none recorded' })),
    dutyWindowStart: first ? new Date(first).toISOString() : '',
    dutyWindowEnd: last ? new Date(last).toISOString() : '',
    riskJustification: reason,
  }));
}

function feasibility(run: RunResult, outsourced: number): PlanFeasibilityState {
  const unserved = run.unserved.length - outsourced;
  if (unserved > 0) return 'PARTIALLY_FEASIBLE';
  if (outsourced > 0) return 'FEASIBLE_WITH_OUTSOURCING';
  if (run.overtimeMin > 0) return 'FEASIBLE_WITH_OVERTIME';
  return 'FEASIBLE';
}

/** 0–100, 100 = equal duty minutes across the drivers a scenario uses. */
function workloadFairness(run: RunResult): number {
  const loads = [...run.usedDrivers].map((d) => run.dutyByDriver.get(d) ?? 0);
  if (loads.length < 2) return 100;
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  if (mean === 0) return 100;
  const sd = Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / loads.length);
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - sd / mean))) * 10) / 10;
}

export class MasterPlannerSolver {
  async solveMasterPlan(
    request: FleetWorkforcePlanningRequest,
    options: { tenantId?: string; planId?: string } = {},
  ): Promise<MasterPlanResult> {
    const tenantId = options.tenantId || 'default';
    const planId = options.planId || `plan-${Date.now()}`;
    const horizon = request.horizon || 'T_PLUS_1_OPERATIONAL';
    const scheduleDate = request.scheduleDate || new Date().toISOString().split('T')[0];

    const policy = driverHoursPolicyEngine.resolvePolicy(request.policy);
    const vehicles = (request.vehicles || []).filter((v) => !v.isGrounded);
    const drivers = (request.drivers || []).filter((d) => d.rosterStatus !== 'ON_LEAVE' && d.rosterStatus !== 'SICK_LEAVE');
    const depots = request.depots || [];
    const windows = windowsOf(request.trips || [], scheduleDate);

    // Depot balancing over the real depots only.
    const inventory: Record<string, DepotInventoryState> = {};
    for (const d of depots) {
      inventory[d.id] = {
        depotId: d.id,
        depotName: d.name,
        lat: d.lat,
        lng: d.lng,
        vehicleSurplus: { COACH_50: 0, COASTER_30: 0, MINIVAN_14: 0, SEDAN: 0 },
        driverSurplus: 0,
      };
    }
    for (const v of vehicles) {
      const dep = inventory[v.currentDepotId];
      const cat = (v.category || v.vehicleType || 'COASTER_30').toString().toUpperCase();
      if (dep) dep.vehicleSurplus[cat] = (dep.vehicleSurplus[cat] || 0) + 1;
    }
    for (const d of drivers) {
      const dep = inventory[d.currentDepotId];
      if (dep) dep.driverSurplus++;
    }
    for (const w of windows) {
      const dep = w.trip.depotId ? inventory[w.trip.depotId] : undefined;
      if (dep) {
        dep.vehicleSurplus[w.category] = (dep.vehicleSurplus[w.category] || 0) - 1;
        dep.driverSurplus--;
      }
    }
    const repositions = Object.keys(inventory).length > 1 ? await repositionSolver.solveDepotBalancing(Object.values(inventory), request.costProfile) : [];
    const repoCost = repositions.reduce((s, r) => s + r.totalCostAed, 0);
    const repoSavings = repositions.reduce((s, r) => s + r.avoidedOutsourceSavingsAed, 0);

    // Preventive maintenance due: a slot in the midday lull.
    const maintenanceSlots: MaintenanceSlotAssignment[] = vehicles
      .filter((v) => v.maintenanceRulKm !== undefined && v.maintenanceRulKm <= 500)
      .map((v) => ({
        vehicleId: vehicleKey(v),
        vehicleCode: v.vehicleCode,
        serviceType: '10K_KM_PREVENTIVE_SERVICE',
        garageDepot: v.currentDepotId,
        startTime: `${scheduleDate}T11:00:00Z`,
        endTime: `${scheduleDate}T14:30:00Z`,
        peakHourImpact: 'ZERO',
        proposedBy: 'PREDICTIVE_MAINTENANCE_RUL',
      }));

    // A: lowest cost.
    const runA = runAssignment(windows, vehicles, drivers, policy, request, {
      allowOvertime: true,
      balanceDrivers: false,
      reservedVehicles: new Set(),
      reservedDrivers: new Set(),
    });

    // B: balanced — hold one real spare vehicle and driver back, unless that
    // costs coverage, in which case run without it.
    const spareB = spares(vehicles, drivers, runA, 1, 1);
    let runB = runAssignment(windows, vehicles, drivers, policy, request, {
      allowOvertime: true,
      balanceDrivers: true,
      reservedVehicles: new Set(spareB.vehicles.map(vehicleKey)),
      reservedDrivers: new Set(spareB.drivers.map(driverKey)),
    });
    let standbyB = spareB;
    if (runB.unserved.length > runA.unserved.length) {
      runB = runAssignment(windows, vehicles, drivers, policy, request, {
        allowOvertime: true,
        balanceDrivers: true,
        reservedVehicles: new Set(),
        reservedDrivers: new Set(),
      });
      standbyB = spares(vehicles, drivers, runB, 1, 1);
    }

    // C: maximum resilience — no overtime, up to two spares of each held back;
    // what it cannot cover is outsourced.
    const spareC = spares(vehicles, drivers, runA, 2, 2);
    const runC = runAssignment(windows, vehicles, drivers, policy, request, {
      allowOvertime: false,
      balanceDrivers: true,
      reservedVehicles: new Set(spareC.vehicles.map(vehicleKey)),
      reservedDrivers: new Set(spareC.drivers.map(driverKey)),
    });
    const outsourcedC = runC.unserved.length;
    const outsourceCostC = runC.unserved.reduce((s, w) => s + resourceCostEngine.resolveCostProfile(w.category, request.costProfile).exchangeStandardCharterRateAed, 0);

    const fmt = (n: number) => n.toLocaleString('en-AE', { maximumFractionDigits: 0 });
    const scenario = (
      id: PlanScenario['scenarioId'],
      name: string,
      run: RunResult,
      standby: { vehicles: Vehicle[]; drivers: Driver[] },
      outsourced: number,
      outsourcedCost: number,
      reason: string,
      narrative: string,
    ): PlanScenario => {
      const standbyCount = standby.vehicles.length + standby.drivers.length;
      return {
        scenarioId: id,
        name,
        isAiRecommended: false,
        totalCostAed: Math.round((run.opCost + repoCost + outsourcedCost) * 100) / 100,
        activeVehiclesCount: run.usedVehicles.size,
        activeDriversCount: run.usedDrivers.size,
        repositioningMovesCount: repositions.length,
        repositioningCostAed: repoCost,
        overtimeMinutesTotal: run.overtimeMin,
        overtimeCostTotalAed: run.overtimeCost,
        standbyVehiclesCount: standby.vehicles.length,
        standbyDriversCount: standby.drivers.length,
        outsourcedTripsCount: outsourced,
        outsourcedCostAed: Math.round(outsourcedCost * 100) / 100,
        unservedTripsCount: run.unserved.length - outsourced,
        disruptionRiskLevel: standbyCount === 0 ? 'HIGH' : run.overtimeMin === 0 && run.unserved.length - outsourced === 0 && standbyCount >= 2 ? 'NEAR_ZERO' : 'LOW',
        feasibilityState: feasibility(run, outsourced),
        assignments: run.assignments,
        repositions,
        maintenanceSlots,
        standbyAllocations: standbyAllocations(standby.vehicles, standby.drivers, depots, windows, reason),
        explanationNarrative: narrative,
      };
    };

    const covered = (r: RunResult) => windows.length - r.unserved.length;
    const scenarioA = scenario(
      'SCENARIO_A_LOWEST_COST',
      'Scenario A (Lowest Cost)',
      runA,
      { vehicles: [], drivers: [] },
      0,
      0,
      '',
      `Covers ${covered(runA)} of ${windows.length} trips with ${runA.usedVehicles.size} vehicles and ${runA.usedDrivers.size} drivers, ${runA.overtimeMin} min overtime and no standby. AED ${fmt(runA.opCost + repoCost)}.`,
    );
    const scenarioB = scenario(
      'SCENARIO_B_BALANCED',
      'Scenario B (Operationally Balanced)',
      runB,
      standbyB,
      0,
      0,
      'Held back so a breakdown or late return can be covered without reshuffling the plan.',
      `Covers ${covered(runB)} of ${windows.length} trips with ${runB.usedVehicles.size} vehicles and ${runB.usedDrivers.size} drivers, spreading duty evenly (fairness ${workloadFairness(runB)}/100), ${runB.overtimeMin} min overtime, and ${standbyB.vehicles.length} vehicle(s) + ${standbyB.drivers.length} driver(s) on standby. AED ${fmt(runB.opCost + repoCost)}.`,
    );
    const scenarioC = scenario(
      'SCENARIO_C_MAX_RESILIENCE',
      'Scenario C (Maximum Resilience)',
      runC,
      spareC,
      outsourcedC,
      outsourceCostC,
      'Maximum reserve: held back to absorb disruption with no overtime.',
      `No overtime; ${spareC.vehicles.length} vehicle(s) + ${spareC.drivers.length} driver(s) held in reserve; covers ${covered(runC)} of ${windows.length} trips internally${outsourcedC ? ` and outsources ${outsourcedC} (AED ${fmt(outsourceCostC)})` : ''}. AED ${fmt(runC.opCost + repoCost + outsourceCostC)}.`,
    );

    // Recommend the balanced plan unless another covers more trips itself.
    // Outsourcing counts as not covered: choosing to pay a charter is a
    // person's call, so C is recommended only when it covers more in-house.
    const internalGap = (s: PlanScenario) => s.unservedTripsCount + s.outsourcedTripsCount;
    const ranked = [scenarioB, scenarioA, scenarioC].sort((x, y) => internalGap(x) - internalGap(y));
    const recommended = ranked[0];
    recommended.isAiRecommended = true;
    const recommendedRun = recommended === scenarioA ? runA : recommended === scenarioC ? runC : runB;

    // Stability: share of trips that keep the vehicle they already had.
    const preassigned = windows.filter((w) => w.trip.assignedVehicleId);
    const kept = preassigned.filter((w) => recommended.assignments.find((a) => a.tripId === w.trip.id)?.vehicleId === w.trip.assignedVehicleId).length;

    return {
      planId,
      tenantId,
      planHorizon: horizon,
      planStatus: request.lockPreviousPlan ? 'LOCKED' : 'OPTIMIZED',
      scheduleDate,
      feasibilityState: recommended.feasibilityState,
      totalTripsRequested: windows.length,
      tripsCoveredInternally: recommended.assignments.length,
      tripsCoveredByReuse: recommendedRun.reuseCount,
      tripsCoveredByReposition: 0,
      tripsCoveredByExchange: recommended.outsourcedTripsCount,
      tripsUnserved: recommended.unservedTripsCount,
      scenarios: [scenarioA, scenarioB, scenarioC],
      recommendedScenario: recommended,
      totalOperatingCostAed: recommended.totalCostAed,
      totalAvoidedOutsourceSavingsAed: repoSavings,
      driverWorkloadVarianceScore: workloadFairness(recommendedRun),
      scheduleStabilityScore: preassigned.length ? Math.round((100 * kept) / preassigned.length) : 100,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const masterPlannerSolver = new MasterPlannerSolver();
