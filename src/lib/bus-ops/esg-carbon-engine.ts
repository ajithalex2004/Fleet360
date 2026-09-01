/**
 * ESG Carbon Footprint & Scope-3 GHG Attribution Engine
 *
 * Implements corporate greenhouse gas accounting (GHG Protocol Scope-3 Category 7: Employee Commute):
 *   1. Fleet Emissions Calculation (gCO2e per vehicle-km based on fuel & engine class)
 *   2. Departmental Carbon Proration based on employee passenger manifests
 *   3. Carbon Intensity Metric (gCO2e per passenger-kilometer)
 *   4. Avoided Carbon Savings vs Single-Occupancy Private Commuter Baseline (171 gCO2e/p-km)
 */

export const EMISSION_FACTORS_G_PER_KM = {
  DIESEL_COASTER_30: 822, // Euro VI 30-seater bus
  DIESEL_COACH_50: 1150,  // Euro VI 50-seater bus
  VAN_14: 450,            // 14-seater shuttle van
  ELECTRIC_BUS: 120,      // Grid-average life-cycle factor (UAE electrical grid)
  DEFAULT: 822,
};

export const PRIVATE_CAR_BASELINE_G_PER_PKM = 171; // Average single-occupancy petrol car commute

export interface EsgTripInput {
  id: string;
  tripNumber?: string;
  distanceKm: number;
  vehicleType?: string;
  fuelType?: string;
  departureTime: Date | string;
  passengers: Array<{
    staffMemberId: string;
    department: string;
    status: string; // BOARDED, COMPLETED
  }>;
}

export interface DepartmentCarbonRecord {
  department: string;
  totalPassengers: number;
  totalPassengerKm: number;
  allocatedCo2Kg: number;
  carbonIntensityGPerPkm: number;
  baselinePrivateCarCo2Kg: number;
  carbonSavedKg: number;
  savingsPercentage: number;
}

export interface DepartmentalCarbonSummary {
  period: string; // e.g. "2026-08"
  totalTrips: number;
  totalDistanceKm: number;
  totalPassengersTransported: number;
  totalPassengerKm: number;
  totalFleetCo2Kg: number;
  totalBaselineCarCo2Kg: number;
  totalCarbonSavedKg: number;
  overallSavingsPercentage: number;
  fleetCarbonIntensityGPerPkm: number;
  greenCommuteScore: number; // 0 to 100%
  departments: DepartmentCarbonRecord[];
}

/**
 * Computes GHG emissions and carbon savings for a single transit trip
 */
export function computeTripCarbon(
  distanceKm: number,
  vehicleType: string = 'DIESEL_COASTER_30',
  passengerCount: number = 20
) {
  const normalizedDistance = Math.max(0, distanceKm);
  const factor =
    EMISSION_FACTORS_G_PER_KM[
      vehicleType as keyof typeof EMISSION_FACTORS_G_PER_KM
    ] ?? EMISSION_FACTORS_G_PER_KM.DEFAULT;

  const totalCo2Grams = normalizedDistance * factor;
  const totalCo2Kg = Number((totalCo2Grams / 1000).toFixed(2));

  const totalPassengerKm = normalizedDistance * Math.max(1, passengerCount);
  const co2PerPkm = Number((totalCo2Grams / totalPassengerKm).toFixed(1));

  const baselineCarCo2Grams = totalPassengerKm * PRIVATE_CAR_BASELINE_G_PER_PKM;
  const baselineCarCo2Kg = Number((baselineCarCo2Grams / 1000).toFixed(2));
  const avoidedCo2Kg = Number(Math.max(0, baselineCarCo2Kg - totalCo2Kg).toFixed(2));

  return {
    distanceKm: normalizedDistance,
    totalCo2Kg,
    totalPassengerKm,
    co2PerPassengerKm: co2PerPkm,
    baselinePrivateCarCo2Kg: baselineCarCo2Kg,
    avoidedCo2Kg,
  };
}

/**
 * Aggregates trips over a billing/reporting period and allocates Scope-3 GHG emissions by corporate department
 */
export function generateDepartmentalCarbonMatrix(
  trips: EsgTripInput[],
  period: string = new Date().toISOString().slice(0, 7)
): DepartmentalCarbonSummary {
  let totalDistanceKm = 0;
  let totalPassengersTransported = 0;
  let totalPassengerKm = 0;
  let totalFleetCo2Kg = 0;
  let totalBaselineCarCo2Kg = 0;

  const deptMap = new Map<
    string,
    {
      passengers: number;
      passengerKm: number;
      allocatedCo2Kg: number;
      baselineCarCo2Kg: number;
    }
  >();

  for (const trip of trips) {
    const validPassengers = trip.passengers.filter((p) =>
      ['BOARDED', 'COMPLETED', 'CONFIRMED'].includes(p.status)
    );
    const passCount = validPassengers.length;
    if (passCount === 0) continue;

    const tripMetrics = computeTripCarbon(
      trip.distanceKm,
      trip.vehicleType,
      passCount
    );

    totalDistanceKm += trip.distanceKm;
    totalPassengersTransported += passCount;
    totalPassengerKm += tripMetrics.totalPassengerKm;
    totalFleetCo2Kg += tripMetrics.totalCo2Kg;
    totalBaselineCarCo2Kg += tripMetrics.baselinePrivateCarCo2Kg;

    // Allocate emissions to departments based on headcount proportion on this trip
    const countsByDept = new Map<string, number>();
    for (const p of validPassengers) {
      const dept = (p.department || 'Unassigned').trim();
      countsByDept.set(dept, (countsByDept.get(dept) ?? 0) + 1);
    }

    for (const [dept, count] of countsByDept.entries()) {
      const share = count / passCount;
      const deptPkm = count * trip.distanceKm;
      const deptCo2 = tripMetrics.totalCo2Kg * share;
      const deptBaseline = (deptPkm * PRIVATE_CAR_BASELINE_G_PER_PKM) / 1000;

      const curr = deptMap.get(dept) ?? {
        passengers: 0,
        passengerKm: 0,
        allocatedCo2Kg: 0,
        baselineCarCo2Kg: 0,
      };

      curr.passengers += count;
      curr.passengerKm += deptPkm;
      curr.allocatedCo2Kg += deptCo2;
      curr.baselineCarCo2Kg += deptBaseline;
      deptMap.set(dept, curr);
    }
  }

  const totalCarbonSavedKg = Number(
    Math.max(0, totalBaselineCarCo2Kg - totalFleetCo2Kg).toFixed(2)
  );
  const overallSavingsPercentage =
    totalBaselineCarCo2Kg > 0
      ? Number(((totalCarbonSavedKg / totalBaselineCarCo2Kg) * 100).toFixed(1))
      : 0;

  const fleetCarbonIntensityGPerPkm =
    totalPassengerKm > 0
      ? Number(((totalFleetCo2Kg * 1000) / totalPassengerKm).toFixed(1))
      : 0;

  const departments: DepartmentCarbonRecord[] = Array.from(deptMap.entries())
    .map(([department, stat]) => {
      const carbonSavedKg = Number(
        Math.max(0, stat.baselineCarCo2Kg - stat.allocatedCo2Kg).toFixed(2)
      );
      const savingsPct =
        stat.baselineCarCo2Kg > 0
          ? Number(((carbonSavedKg / stat.baselineCarCo2Kg) * 100).toFixed(1))
          : 0;
      const intensity =
        stat.passengerKm > 0
          ? Number(((stat.allocatedCo2Kg * 1000) / stat.passengerKm).toFixed(1))
          : 0;

      return {
        department,
        totalPassengers: stat.passengers,
        totalPassengerKm: Number(stat.passengerKm.toFixed(1)),
        allocatedCo2Kg: Number(stat.allocatedCo2Kg.toFixed(2)),
        carbonIntensityGPerPkm: intensity,
        baselinePrivateCarCo2Kg: Number(stat.baselineCarCo2Kg.toFixed(2)),
        carbonSavedKg,
        savingsPercentage: savingsPct,
      };
    })
    .sort((a, b) => b.allocatedCo2Kg - a.allocatedCo2Kg);

  // Green Commute Score (100 is pure EV/optimal bus pool, benchmarked against 171g car baseline)
  const greenCommuteScore = Math.min(
    100,
    Math.max(0, Math.round(overallSavingsPercentage))
  );

  return {
    period,
    totalTrips: trips.length,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    totalPassengersTransported,
    totalPassengerKm: Number(totalPassengerKm.toFixed(1)),
    totalFleetCo2Kg: Number(totalFleetCo2Kg.toFixed(2)),
    totalBaselineCarCo2Kg: Number(totalBaselineCarCo2Kg.toFixed(2)),
    totalCarbonSavedKg,
    overallSavingsPercentage,
    fleetCarbonIntensityGPerPkm,
    greenCommuteScore,
    departments,
  };
}
