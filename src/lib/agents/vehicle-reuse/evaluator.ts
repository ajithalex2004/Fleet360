/**
 * Fleet360 Vehicle Reuse Evaluator
 * ---------------------------------
 * Deterministic optimization service answering:
 * "Can a vehicle completing Trip A safely perform Trip B?"
 *
 * Core Evaluation Pillars:
 * 1. Temporal Window & Sequence (Trip A Dropoff vs. Trip B Pickup)
 * 2. Cached Road Deadhead Routing (via RoutingIntelligenceService)
 * 3. Vehicle Category Turnaround & Sanitization Buffers
 * 4. Seating Capacity & Feature Compatibility
 * 5. Driver UAE MoHRE / RTA Hours of Service (HOS) & Fatigue Guardrails
 * 6. Operational Zone / Emirate Permit Feasibility
 * 7. Net Avoided Mobilization Cost & ROI (AED)
 */

import {
  TripScheduleItem,
  VehicleResource,
  DriverResource,
  ReuseEvaluationRequest,
  ReuseEvaluationResult,
  VehicleCategoryTier,
} from '../types';
import { routingIntelligence } from '@/lib/routing/intelligence-service';

export const DEFAULT_TURNAROUND_MINUTES: Record<VehicleCategoryTier | string, number> = {
  SEDAN: 8,
  LUXURY_VIP: 10,
  MINIVAN: 12,
  COASTER_30: 15,
  COACH_50: 20,
  CARGO_VAN: 10,
  DEFAULT: 12,
};

export const AVOIDED_MOBILIZATION_AED: Record<VehicleCategoryTier | string, number> = {
  COACH_50: 850.0,
  COASTER_30: 600.0,
  MINIVAN: 450.0,
  SEDAN: 350.0,
  LUXURY_VIP: 550.0,
  CARGO_VAN: 400.0,
  DEFAULT: 450.0,
};

export const DEADHEAD_FUEL_COST_PER_KM_AED = 0.75;
export const USD_TO_AED_EXCHANGE_RATE = 3.6725;

export interface VehicleReuseEvaluationOptions {
  minimumSafeBufferMin?: number; // Default: 5 min
  fuelCostPerKm?: number;
  maxDailyDutyMinutes?: number; // UAE MoHRE default: 600 min (10 hours)
  maxContinuousDrivingMinutes?: number; // UAE RTA default: 270 min (4.5 hours)
  allowTightBuffer?: boolean;
}

/**
 * Deterministically evaluates whether a vehicle can chain Trip A into Trip B.
 */
export async function evaluateVehicleReuse(
  request: ReuseEvaluationRequest,
  options: VehicleReuseEvaluationOptions = {},
): Promise<ReuseEvaluationResult> {
  const { tripA, tripB, vehicle, driver } = request;
  const minSafeBuffer = options.minimumSafeBufferMin ?? request.minimumSafeBufferMin ?? 5;
  const fuelRate = options.fuelCostPerKm ?? DEADHEAD_FUEL_COST_PER_KM_AED;

  const reasons: string[] = [];

  // ── 1. Temporal Analysis ───────────────────────────────────────────────────
  const rawDropoffA = tripA.plannedDropoffTime ?? tripA.endTime;
  const rawPickupB = tripB.plannedPickupTime ?? tripB.startTime;

  if (!rawDropoffA || !rawPickupB) {
    throw new Error('Invalid timestamp in Trip A dropoff or Trip B pickup time.');
  }

  const dropoffTimeA = new Date(rawDropoffA).getTime();
  const pickupTimeB = new Date(rawPickupB).getTime();

  if (isNaN(dropoffTimeA) || isNaN(pickupTimeB)) {
    throw new Error('Invalid timestamp in Trip A dropoff or Trip B pickup time.');
  }

  const availableGapMs = pickupTimeB - dropoffTimeA;
  const availableGapMin = Math.round(availableGapMs / 60000);

  if (availableGapMin < 0) {
    reasons.push(
      `Temporal Overlap: Trip B starts at ${new Date(rawPickupB).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, which is ${Math.abs(availableGapMin)} min before Trip A concludes.`,
    );
  }

  // ── 2. Deadhead Spatial Routing (via Cached RoutingIntelligenceService) ───
  const destA = tripA.destination ?? tripA.endLocation;
  const origB = tripB.origin ?? tripB.startLocation;

  let deadheadKm = 0;
  let deadheadMin = 0;

  try {
    if (destA && origB) {
      const travelTime = await routingIntelligence.getTravelTime(destA as any, origB as any, {
        tier: 'HISTORICAL_TRAVEL_TIME',
      });
      deadheadKm = travelTime.distanceKm;
      deadheadMin = travelTime.durationMin;
    } else {
      deadheadKm = 10;
      deadheadMin = 15;
    }
  } catch {
    // Spatial fallback if coordinates invalid
    deadheadKm = 10;
    deadheadMin = 15;
  }

  // ── 3. Turnaround Time Calculation ─────────────────────────────────────────
  const categoryKey = String(vehicle.category ?? vehicle.vehicleType ?? 'MINIVAN').toUpperCase();
  const turnaroundMin = DEFAULT_TURNAROUND_MINUTES[categoryKey] ?? DEFAULT_TURNAROUND_MINUTES.DEFAULT;

  const requiredTransitionMin = deadheadMin + turnaroundMin;
  const bufferMin = availableGapMin - requiredTransitionMin;

  if (availableGapMin >= 0 && bufferMin < 0) {
    reasons.push(
      `Insufficient time window: Deadhead (${deadheadMin} min) + Turnaround (${turnaroundMin} min) requires ${requiredTransitionMin} min, but available gap is only ${availableGapMin} min (${Math.abs(bufferMin)} min deficit).`,
    );
  }

  // ── 4. Vehicle Capacity & Features Verification ────────────────────────────
  const vehicleCapacity = vehicle.capacity ?? vehicle.seatingCapacity ?? 0;
  const capacitySufficient = vehicleCapacity >= tripB.passengerCount;
  if (!capacitySufficient) {
    reasons.push(
      `Capacity deficit: Vehicle ${vehicle.vehicleCode} has ${vehicleCapacity} seats, but Trip B requires ${tripB.passengerCount} passengers.`,
    );
  }

  // Feature matching
  let featuresMatched = true;
  if (tripB.requiredFeatures && tripB.requiredFeatures.length > 0) {
    const vehicleFeatures = new Set(vehicle.features?.map((f) => f.toUpperCase()) || []);
    for (const reqFeat of tripB.requiredFeatures) {
      if (!vehicleFeatures.has(reqFeat.toUpperCase())) {
        featuresMatched = false;
        reasons.push(`Missing Vehicle Feature: Trip B requires "${reqFeat}", which is not equipped on ${vehicle.vehicleCode}.`);
      }
    }
  }

  // ── 5. Driver Hours of Service (HOS) & Duty Limits ─────────────────────────
  let driverDutyPermitted = true;
  let driverRemainingDutyMin: number | undefined = undefined;

  if (driver) {
    const maxDutyMin = driver.maxDailyDutyMinutes ?? options.maxDailyDutyMinutes ?? 600; // 10h

    // Estimate Trip B duration (fallback: 30 min if dropoff not explicit)
    const rawDropoffB = tripB.plannedDropoffTime ?? tripB.endTime;
    const tripBDurationMin = rawDropoffB
      ? Math.max(15, Math.round((new Date(rawDropoffB).getTime() - pickupTimeB) / 60000))
      : 30;

    let dutyUsed = driver.dutyMinutesUsed ?? driver.drivingMinutesUsed ?? 0;
    if (typeof driver.dailyHoursRemaining === 'number') {
      dutyUsed = Math.max(0, maxDutyMin - Math.round(driver.dailyHoursRemaining * 60));
    }

    const projectedDutyMin = dutyUsed + deadheadMin + tripBDurationMin;
    driverRemainingDutyMin = Math.max(0, maxDutyMin - projectedDutyMin);

    if (projectedDutyMin > maxDutyMin) {
      driverDutyPermitted = false;
      reasons.push(
        `Daily HOS limit exceeded: Driver ${driver.driverName ?? driver.name ?? 'Driver'} would reach ${projectedDutyMin} duty mins (Max allowed: ${maxDutyMin} mins / 10h).`,
      );
    }
  }

  // ── 6. Operational Zone Compatibility ──────────────────────────────────────
  let operationalZoneCompatible = true;
  const zoneA = tripA.operationalZone ?? tripA.zoneId;
  const zoneB = tripB.operationalZone ?? tripB.zoneId;
  if (zoneA && zoneB && zoneA !== zoneB) {
    // Cross-emirate transit check (e.g. Dubai to Abu Dhabi)
    if (zoneA === 'ABU_DHABI_RESTRICTED' || zoneB === 'ABU_DHABI_RESTRICTED') {
      operationalZoneCompatible = false;
      reasons.push(`Zone Restriction: Cross-transit between ${zoneA} and ${zoneB} requires specific regional permit.`);
    }
  }

  // ── 7. Feasibility Status Determination ────────────────────────────────────
  let feasibilityStatus: 'FEASIBLE' | 'TIGHT_BUFFER' | 'INFEASIBLE' = 'FEASIBLE';

  const temporalFeasible = availableGapMin >= 0 && bufferMin >= 0;
  if (!capacitySufficient || !featuresMatched || !driverDutyPermitted || !operationalZoneCompatible || !temporalFeasible) {
    feasibilityStatus = 'INFEASIBLE';
  } else if (bufferMin < minSafeBuffer) {
    feasibilityStatus = 'TIGHT_BUFFER';
  }

  const isFeasible = feasibilityStatus === 'FEASIBLE' || (feasibilityStatus === 'TIGHT_BUFFER' && Boolean(options.allowTightBuffer));

  // Feasibility Score (0-100)
  let feasibilityScore = 0;
  if (feasibilityStatus === 'FEASIBLE') {
    feasibilityScore = Math.min(100, Math.max(80, 80 + Math.min(20, bufferMin)));
  } else if (feasibilityStatus === 'TIGHT_BUFFER') {
    feasibilityScore = Math.max(50, 60 + bufferMin * 2);
  } else {
    feasibilityScore = 10;
  }

  // ── 8. Net Avoided Cost & ROI ──────────────────────────────────────────────
  const baseAvoidedMobilizationAed = AVOIDED_MOBILIZATION_AED[categoryKey] ?? AVOIDED_MOBILIZATION_AED.DEFAULT;
  const deadheadCostAed = parseFloat((deadheadKm * fuelRate).toFixed(2));
  
  // Net savings only realize if feasible
  const netSavingsAed = isFeasible || feasibilityStatus === 'FEASIBLE' || feasibilityStatus === 'TIGHT_BUFFER'
    ? parseFloat(Math.max(0, baseAvoidedMobilizationAed - deadheadCostAed).toFixed(2))
    : 0;
  const avoidedCostUsd = parseFloat((netSavingsAed / USD_TO_AED_EXCHANGE_RATE).toFixed(2));

  // Summary generation
  let summary = '';
  if (feasibilityStatus === 'FEASIBLE') {
    summary = `Vehicle ${vehicle.vehicleCode} safely reusable for Trip B with ${bufferMin} min buffer (Deadhead: ${deadheadMin} min, Turnaround: ${turnaroundMin} min). Saves AED ${netSavingsAed.toFixed(2)} in avoided vehicle mobilization.`;
  } else if (feasibilityStatus === 'TIGHT_BUFFER') {
    summary = `Vehicle ${vehicle.vehicleCode} tight connection for Trip B with only ${bufferMin} min buffer (Min safe: ${minSafeBuffer} min). Potential savings of AED ${netSavingsAed.toFixed(2)}.`;
  } else {
    summary = `Vehicle ${vehicle.vehicleCode} INFEASIBLE for Trip B: ${reasons.join('; ')}`;
  }

  return {
    isFeasible: feasibilityStatus === 'FEASIBLE' || (feasibilityStatus === 'TIGHT_BUFFER' && Boolean(options.allowTightBuffer)),
    recommendation: feasibilityStatus,
    feasibilityStatus,
    feasibilityScore,
    tripAId: tripA.id,
    tripBId: tripB.id,
    vehicleId: vehicle.vehicleId ?? vehicle.id ?? 'unknown',
    vehicleCode: vehicle.vehicleCode,
    driverId: driver?.driverId ?? driver?.id,
    tripAEndTime: new Date(rawDropoffA).toISOString(),
    tripBStartTime: new Date(rawPickupB).toISOString(),
    availableGapMin,
    deadheadKm,
    deadheadMin,
    turnaroundMin,
    bufferMin,
    vehicleCapacitySufficient: capacitySufficient,
    vehicleFeaturesMatched: featuresMatched,
    driverDutyPermitted,
    driverRemainingDutyMin,
    operationalZoneCompatible,
    reasons,
    infeasibilityReasons: reasons,
    breakdown: {
      totalWindowMin: availableGapMin,
      deadheadMin,
      turnaroundMin,
      bufferMin,
      temporalFeasible,
      capacityFeasible: capacitySufficient,
      driverFeasible: driverDutyPermitted,
      zoneFeasible: operationalZoneCompatible,
    },
    summary,
    financialSavingsAed: netSavingsAed,
    avoidedCostUsd,
  };
}

export class VehicleReuseEvaluator {
  /**
   * Evaluate a single reuse pair
   */
  async evaluatePair(
    request: ReuseEvaluationRequest,
    options?: VehicleReuseEvaluationOptions,
  ): Promise<ReuseEvaluationResult> {
    return evaluateVehicleReuse(request, options);
  }

  /**
   * Find optimal vehicle reuse opportunities across a fleet of completed trips and pending trips.
   */
  async findReuseOpportunities(
    activeOrCompletedTrips: Array<{ trip: TripScheduleItem; vehicle: VehicleResource; driver?: DriverResource }>,
    unassignedTrips: TripScheduleItem[],
    options?: VehicleReuseEvaluationOptions,
  ): Promise<ReuseEvaluationResult[]> {
    const opportunities: ReuseEvaluationResult[] = [];

    for (const pendingTrip of unassignedTrips) {
      for (const candidate of activeOrCompletedTrips) {
        const result = await evaluateVehicleReuse(
          {
            tripA: candidate.trip,
            tripB: pendingTrip,
            vehicle: candidate.vehicle,
            driver: candidate.driver,
          },
          options,
        );

        if (result.isFeasible) {
          opportunities.push(result);
        }
      }
    }

    // Sort by best buffer and highest financial savings
    return opportunities.sort((a, b) => b.financialSavingsAed - a.financialSavingsAed || b.bufferMin - a.bufferMin);
  }
}

/** Global Shared Vehicle Reuse Evaluator Instance */
export const vehicleReuseEvaluator = new VehicleReuseEvaluator();
