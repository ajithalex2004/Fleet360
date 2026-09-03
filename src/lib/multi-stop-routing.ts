export interface WaypointNode {
  id: string;
  sequence: number;
  type: 'PICKUP' | 'DROPOFF';
  address: string;
  lat: number;
  lng: number;
  dockGate?: string;
  pallets: number;
  weightTons: number;
  contactPerson?: string;
  contactPhone?: string;
  appointmentTime?: string;
  status?: 'PENDING' | 'ARRIVED' | 'COMPLETED';
}

export interface RouteLeg {
  fromAddress: string;
  toAddress: string;
  distanceKm: number;
  durationMins: number;
  salikTollsAed: number;
}

export interface RouteOptimizationResult {
  totalDistanceKm: number;
  totalDurationMins: number;
  totalSalikTollsAed: number;
  totalPallets: number;
  totalWeightTons: number;
  optimizedWaypoints: WaypointNode[];
  legs: RouteLeg[];
  co2EmissionsKg: number;
  ltlConsolidation: {
    isEligible: boolean;
    poolId: string;
    discountPercent: number;
    discountAmountAed: number;
    co2SavedKg: number;
    sharedTruckModel: string;
  };
}

export const UAE_KEY_HUBS: Record<string, { lat: number; lng: number }> = {
  jafza: { lat: 24.9967, lng: 55.0863 },
  dubai_mall: { lat: 25.1972, lng: 55.2744 },
  moe: { lat: 25.1181, lng: 55.2006 },
  dso: { lat: 25.1273, lng: 55.3802 },
  dxb_airport: { lat: 25.2532, lng: 55.3657 },
  difc: { lat: 25.2104, lng: 55.2818 },
  abu_dhabi_kizad: { lat: 24.7869, lng: 54.6719 },
  sharjah_saif: { lat: 25.3267, lng: 55.5173 },
};

/**
 * Calculates road-adjusted distance (km) between two coordinates (1.28x factor)
 */
export function calculateDistanceBetweenCoords(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineKm = R * c;

  // Road factor in UAE highway network (~1.28x)
  return Math.max(1, Math.round(straightLineKm * 1.28 * 10) / 10);
}

/**
 * Estimates UAE Salik tolls (AED 4.00 per gate) along a corridor segment
 */
export function calculateSalikTollsForLeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const distance = calculateDistanceBetweenCoords(lat1, lng1, lat2, lng2);
  // Cross-city highway corridors (E11 / E44) have ~1 Salik gate every 15-20km
  const gates = Math.floor(distance / 18);
  return Math.min(gates * 4, 16); // max 4 gates per leg
}

/**
 * Solves Traveling Salesperson (TSP) for intermediate stops using Nearest-Neighbor heuristic
 */
export function optimizeWaypointSequence(
  origin: WaypointNode,
  intermediateWaypoints: WaypointNode[],
  destination: WaypointNode
): WaypointNode[] {
  if (intermediateWaypoints.length <= 1) {
    return [
      { ...origin, sequence: 1 },
      ...intermediateWaypoints.map((w, i) => ({ ...w, sequence: i + 2 })),
      { ...destination, sequence: intermediateWaypoints.length + 2 },
    ];
  }

  const unvisited = [...intermediateWaypoints];
  const ordered: WaypointNode[] = [{ ...origin, sequence: 1 }];
  let current = origin;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateDistanceBetweenCoords(
        current.lat,
        current.lng,
        unvisited[i].lat,
        unvisited[i].lng
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    const nextStop = unvisited.splice(nearestIdx, 1)[0];
    ordered.push({ ...nextStop, sequence: ordered.length + 1 });
    current = nextStop;
  }

  ordered.push({ ...destination, sequence: ordered.length + 1 });
  return ordered;
}

/**
 * Comprehensive Route Optimization with Leg-by-Leg Metrics and LTL Carbon Consolidation
 */
export function computeMultiStopRoute(
  origin: WaypointNode,
  intermediateWaypoints: WaypointNode[],
  destination: WaypointNode,
  baseFareAed: number = 550
): RouteOptimizationResult {
  const optimizedNodes = optimizeWaypointSequence(origin, intermediateWaypoints, destination);

  const legs: RouteLeg[] = [];
  let totalDistanceKm = 0;
  let totalDurationMins = 0;
  let totalSalikTollsAed = 0;
  let totalPallets = 0;
  let totalWeightTons = 0;

  for (let i = 0; i < optimizedNodes.length - 1; i++) {
    const from = optimizedNodes[i];
    const to = optimizedNodes[i + 1];

    const dist = calculateDistanceBetweenCoords(from.lat, from.lng, to.lat, to.lng);
    const tolls = calculateSalikTollsForLeg(from.lat, from.lng, to.lat, to.lng);
    const duration = Math.round((dist / 65) * 60) + 12; // avg 65 km/h + 12 mins dock handling buffer

    legs.push({
      fromAddress: from.address,
      toAddress: to.address,
      distanceKm: dist,
      durationMins: duration,
      salikTollsAed: tolls,
    });

    totalDistanceKm += dist;
    totalDurationMins += duration;
    totalSalikTollsAed += tolls;
  }

  for (const node of optimizedNodes) {
    totalPallets += node.pallets || 0;
    totalWeightTons += node.weightTons || 0;
  }

  // Estimated CO2 emissions: ~0.82 kg CO2 per km for a 7-Ton diesel truck
  const co2EmissionsKg = Math.round(totalDistanceKm * 0.82 * 10) / 10;

  // LTL Load Consolidation Incentive
  // If total pallets <= 6 and weight <= 4.0 tons, it qualifies for shared 7-ton truck consolidation
  const isEligibleLtl = totalPallets <= 8 && totalWeightTons <= 5.0;
  const discountPercent = isEligibleLtl ? (optimizedNodes.length > 2 ? 20 : 15) : 0;
  const discountAmountAed = Math.round(baseFareAed * (discountPercent / 100));
  const co2SavedKg = isEligibleLtl ? Math.round(co2EmissionsKg * 0.35 * 10) / 10 : 0;

  return {
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalDurationMins,
    totalSalikTollsAed,
    totalPallets,
    totalWeightTons: Math.round(totalWeightTons * 10) / 10,
    optimizedWaypoints: optimizedNodes,
    legs,
    co2EmissionsKg,
    ltlConsolidation: {
      isEligible: isEligibleLtl,
      poolId: 'LTL-CORRIDOR-E11-DXB-AUH',
      discountPercent,
      discountAmountAed,
      co2SavedKg,
      sharedTruckModel: '7-Ton Curtain Sider (Shared Consolidation)',
    },
  };
}
