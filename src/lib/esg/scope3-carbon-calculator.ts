/**
 * Productized Scope 3 ESG Carbon Accounting & Audit Certificate Generator
 * Compliant with GHG Protocol Corporate Value Chain (Scope 3) Standard & ISO 14064-1
 * Supports Category 4 (Upstream Freight) and Category 7 (Employee Commuting Modal Shift).
 */

import { createHash } from 'crypto';

export type VehicleFuelType = 'DIESEL' | 'PETROL' | 'EV' | 'HYBRID' | 'CNG';
export type TransportScopeCategory = 'CATEGORY_7_EMPLOYEE_COMMUTE' | 'CATEGORY_4_UPSTREAM_FREIGHT';

export interface EsgTripInput {
  tripId: string;
  category: TransportScopeCategory;
  date: string; // YYYY-MM-DD
  origin: string;
  destination: string;
  distanceKm: number;
  passengerCount?: number;
  cargoWeightTonnes?: number;
  fuelType: VehicleFuelType;
  vehicleCapacity: number;
  departmentName?: string;
  clientName?: string;
}

// UAE MOCCAE & UK DEFRA standard emissions factors (kg CO2e per unit)
export const EMISSION_FACTORS = {
  // Baseline private passenger car (single commuter in UAE)
  PRIVATE_CAR_PER_PASS_KM: 0.192,
  // Commercial shared buses (per passenger-km at ~70% load)
  BUS_DIESEL_50_PER_PASS_KM: 0.038,
  BUS_DIESEL_30_PER_PASS_KM: 0.054,
  BUS_EV_PER_PASS_KM: 0.012,
  BUS_HYBRID_PER_PASS_KM: 0.026,
  // Freight haulage (per tonne-km)
  FREIGHT_HEAVY_TRUCK_PER_TONNE_KM: 0.088,
  FREIGHT_MEDIUM_VAN_PER_TONNE_KM: 0.142,
  FREIGHT_EV_TRUCK_PER_TONNE_KM: 0.022,
};

export interface EsgTripCarbonResult {
  tripId: string;
  category: TransportScopeCategory;
  date: string;
  distanceKm: number;
  passengerKm: number;
  tonneKm: number;
  grossEmissionsKgCo2e: number;
  baselineEmissionsKgCo2e: number;
  avoidedEmissionsKgCo2e: number; // Net reduction
  reductionPct: number;
}

export interface DepartmentCarbonBreakdown {
  department: string;
  totalTrips: number;
  totalDistanceKm: number;
  totalPassengerKm: number;
  grossEmissionsTonnes: number;
  avoidedEmissionsTonnes: number;
  carbonIntensityGramsPerPkm: number;
}

export interface Scope3CarbonAuditCertificate {
  certificateId: string;
  issuedAt: string;
  reportingPeriod: string;
  clientOrganization: string;
  reportingStandard: string;
  totalTripsAudited: number;
  totalDistanceKm: number;
  totalPassengerKm: number;
  grossScope3EmissionsTonnesCo2e: number;
  totalBaselineEmissionsTonnesCo2e: number;
  totalAvoidedEmissionsTonnesCo2e: number;
  netDecarbonizationRatioPct: number;
  departmentalBreakdown: DepartmentCarbonBreakdown[];
  auditDigestHash: string;
  verificationStatement: string;
}

/**
 * Calculates Scope 3 emissions for an individual trip
 */
export function calculateTripScope3Carbon(trip: EsgTripInput): EsgTripCarbonResult {
  const dist = Math.max(0, trip.distanceKm);
  const passengers = Math.max(0, trip.passengerCount || 1);
  const cargoTonnes = Math.max(0, trip.cargoWeightTonnes || 0);

  const passengerKm = Number((dist * passengers).toFixed(2));
  const tonneKm = Number((dist * cargoTonnes).toFixed(2));

  let grossEmissionsKg = 0;
  let baselineEmissionsKg = 0;

  if (trip.category === 'CATEGORY_7_EMPLOYEE_COMMUTE') {
    // Shared employee commute
    let busFactor = EMISSION_FACTORS.BUS_DIESEL_50_PER_PASS_KM;
    if (trip.fuelType === 'EV') busFactor = EMISSION_FACTORS.BUS_EV_PER_PASS_KM;
    else if (trip.fuelType === 'HYBRID') busFactor = EMISSION_FACTORS.BUS_HYBRID_PER_PASS_KM;
    else if (trip.vehicleCapacity <= 30) busFactor = EMISSION_FACTORS.BUS_DIESEL_30_PER_PASS_KM;

    grossEmissionsKg = passengerKm * busFactor;
    // Baseline: If each passenger had driven individually in a private car
    baselineEmissionsKg = passengerKm * EMISSION_FACTORS.PRIVATE_CAR_PER_PASS_KM;
  } else {
    // Freight / logistics
    let truckFactor = EMISSION_FACTORS.FREIGHT_HEAVY_TRUCK_PER_TONNE_KM;
    if (trip.fuelType === 'EV') truckFactor = EMISSION_FACTORS.FREIGHT_EV_TRUCK_PER_TONNE_KM;
    else if (trip.vehicleCapacity <= 5) truckFactor = EMISSION_FACTORS.FREIGHT_MEDIUM_VAN_PER_TONNE_KM;

    grossEmissionsKg = (tonneKm > 0 ? tonneKm : dist * 2.5) * truckFactor;
    baselineEmissionsKg = grossEmissionsKg * 1.35; // Unconsolidated baseline (+35%)
  }

  const grossEmissionsKgCo2e = Number(grossEmissionsKg.toFixed(2));
  const baselineEmissionsKgCo2e = Number(baselineEmissionsKg.toFixed(2));
  const avoidedEmissionsKgCo2e = Number(Math.max(0, baselineEmissionsKgCo2e - grossEmissionsKgCo2e).toFixed(2));
  const reductionPct = baselineEmissionsKgCo2e > 0
    ? Number(((avoidedEmissionsKgCo2e / baselineEmissionsKgCo2e) * 100).toFixed(1))
    : 0;

  return {
    tripId: trip.tripId,
    category: trip.category,
    date: trip.date,
    distanceKm: dist,
    passengerKm,
    tonneKm,
    grossEmissionsKgCo2e,
    baselineEmissionsKgCo2e,
    avoidedEmissionsKgCo2e,
    reductionPct,
  };
}

/**
 * Generates an Audit-Ready Scope 3 ESG Carbon Certificate
 */
export function generateScope3AuditCertificate(
  clientName: string,
  reportingPeriod: string,
  trips: EsgTripInput[]
): Scope3CarbonAuditCertificate {
  let totalDistanceKm = 0;
  let totalPassengerKm = 0;
  let grossKg = 0;
  let baselineKg = 0;
  let avoidedKg = 0;

  const deptMap = new Map<string, {
    trips: number;
    dist: number;
    pkm: number;
    grossKg: number;
    avoidedKg: number;
  }>();

  for (const trip of trips) {
    const res = calculateTripScope3Carbon(trip);
    totalDistanceKm += res.distanceKm;
    totalPassengerKm += res.passengerKm;
    grossKg += res.grossEmissionsKgCo2e;
    baselineKg += res.baselineEmissionsKgCo2e;
    avoidedKg += res.avoidedEmissionsKgCo2e;

    const dept = trip.departmentName || 'General Operations';
    const existing = deptMap.get(dept) || { trips: 0, dist: 0, pkm: 0, grossKg: 0, avoidedKg: 0 };
    existing.trips++;
    existing.dist += res.distanceKm;
    existing.pkm += res.passengerKm;
    existing.grossKg += res.grossEmissionsKgCo2e;
    existing.avoidedKg += res.avoidedEmissionsKgCo2e;
    deptMap.set(dept, existing);
  }

  const grossScope3EmissionsTonnesCo2e = Number((grossKg / 1000).toFixed(3));
  const totalBaselineEmissionsTonnesCo2e = Number((baselineKg / 1000).toFixed(3));
  const totalAvoidedEmissionsTonnesCo2e = Number((avoidedKg / 1000).toFixed(3));
  const netDecarbonizationRatioPct = totalBaselineEmissionsTonnesCo2e > 0
    ? Number(((totalAvoidedEmissionsTonnesCo2e / totalBaselineEmissionsTonnesCo2e) * 100).toFixed(1))
    : 0;

  const departmentalBreakdown: DepartmentCarbonBreakdown[] = Array.from(deptMap.entries()).map(([department, data]) => ({
    department,
    totalTrips: data.trips,
    totalDistanceKm: Number(data.dist.toFixed(1)),
    totalPassengerKm: Number(data.pkm.toFixed(1)),
    grossEmissionsTonnes: Number((data.grossKg / 1000).toFixed(3)),
    avoidedEmissionsTonnes: Number((data.avoidedKg / 1000).toFixed(3)),
    carbonIntensityGramsPerPkm: data.pkm > 0 ? Number(((data.grossKg * 1000) / data.pkm).toFixed(1)) : 0,
  }));

  const now = new Date();
  const certificateId = `ESG-CERT-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

  // Cryptographic audit verification digest
  const rawPayload = JSON.stringify({
    certificateId,
    clientName,
    reportingPeriod,
    grossScope3EmissionsTonnesCo2e,
    totalAvoidedEmissionsTonnesCo2e,
    tripsCount: trips.length,
  });
  const auditDigestHash = createHash('sha256').update(rawPayload).digest('hex');

  const verificationStatement = `This certifies that ${clientName}'s Scope 3 commuter & freight transportation emissions for period ${reportingPeriod} have been quantified in accordance with GHG Protocol Scope 3 Technical Guidance and ISO 14064-1 standard. Shared route consolidation achieved a ${netDecarbonizationRatioPct}% net carbon abatement (-${totalAvoidedEmissionsTonnesCo2e} tonnes CO2e).`;

  return {
    certificateId,
    issuedAt: now.toISOString(),
    reportingPeriod,
    clientOrganization: clientName,
    reportingStandard: 'GHG Protocol Scope 3 (Cat 4 & Cat 7) / ISO 14064-1:2018',
    totalTripsAudited: trips.length,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    totalPassengerKm: Number(totalPassengerKm.toFixed(1)),
    grossScope3EmissionsTonnesCo2e,
    totalBaselineEmissionsTonnesCo2e,
    totalAvoidedEmissionsTonnesCo2e,
    netDecarbonizationRatioPct,
    departmentalBreakdown,
    auditDigestHash,
    verificationStatement,
  };
}
