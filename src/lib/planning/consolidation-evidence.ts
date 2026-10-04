/** Historical evidence for a proposed simultaneous route merge. No savings are claimed here. */
export type HistoricalTrip = {
  routeId: string;
  serviceDay: string;
  shift: string | null;
  direction: string | null;
  departureTime: Date;
  capacity: number | null;
  reserved: number;
  boarded: number;
  attendanceRows: number;
  fuelLitres: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
};

export function evaluateConsolidationEvidence(
  trips: HistoricalTrip[],
  routeIds: [string, string],
  mergedCapacity: number | null,
  rates: { fuelPerLitre: number; driverPerHour: number; vehiclePerKm: number },
) {
  const [a, b] = routeIds;
  const byService = new Map<string, { a: HistoricalTrip[]; b: HistoricalTrip[] }>();
  for (const trip of trips) {
    if (trip.routeId !== a && trip.routeId !== b) continue;
    const key = JSON.stringify([trip.serviceDay, trip.shift, trip.direction]);
    const group = byService.get(key) ?? { a: [], b: [] };
    group[trip.routeId === a ? 'a' : 'b'].push(trip);
    byService.set(key, group);
  }

  let pairedServices = 0, overCapacityServices = 0, unknownDemandServices = 0, incompatibleTimingServices = 0;
  let peakReserved = 0, peakBoarded = 0;
  for (const { a: left, b: right } of byService.values()) {
    // More than one trip per route/shift/day is ambiguous: never sum it into a
    // purported one-bus service. Headway and split trips need separate review.
    if (left.length !== 1 || right.length !== 1) continue;
    if (!left[0].shift || !left[0].direction ||
        Math.abs(left[0].departureTime.getTime() - right[0].departureTime.getTime()) > 60 * 60_000) {
      incompatibleTimingServices++;
      continue;
    }
    pairedServices++;
    const reserved = left[0].reserved + right[0].reserved;
    const boarded = left[0].boarded + right[0].boarded;
    peakReserved = Math.max(peakReserved, reserved);
    peakBoarded = Math.max(peakBoarded, boarded);
    if (left[0].attendanceRows === 0 || right[0].attendanceRows === 0) unknownDemandServices++;
    if (mergedCapacity !== null && reserved > mergedCapacity) overCapacityServices++;
  }

  const completeCostTrips = trips.filter(t =>
    t.fuelLitres !== null && Number.isFinite(t.fuelLitres) && t.fuelLitres >= 0 &&
    t.distanceKm !== null && Number.isFinite(t.distanceKm) && t.distanceKm >= 0 &&
    t.durationMinutes !== null && Number.isFinite(t.durationMinutes) && t.durationMinutes >= 0);
  const observedCost = completeCostTrips.reduce((sum, t) =>
    sum + t.fuelLitres! * rates.fuelPerLitre + t.durationMinutes! / 60 * rates.driverPerHour + t.distanceKm! * rates.vehiclePerKm, 0);
  const attendanceTrips = trips.filter(t => t.attendanceRows > 0).length;
  return {
    completedTrips: trips.length,
    pairedServices,
    ambiguousServices: [...byService.values()].filter(g => g.a.length > 1 || g.b.length > 1).length,
    incompatibleTimingServices,
    overCapacityServices,
    unknownDemandServices,
    peakReserved,
    peakBoarded,
    attendanceTrips,
    completeCostTrips: completeCostTrips.length,
    observedCostAED: completeCostTrips.length ? Math.round(observedCost * 100) / 100 : null,
    assessment: !pairedServices || mergedCapacity === null || unknownDemandServices || attendanceTrips !== trips.length
      ? 'INSUFFICIENT_DATA' as const
      : overCapacityServices ? 'CAPACITY_CONFLICT' as const : 'HISTORICALLY_PLAUSIBLE' as const,
    // Observed baseline is not a counterfactual. It cannot prove savings
    // after merging or account for different stop order/vehicle duties.
    realizedSavingsAED: null,
  };
}
