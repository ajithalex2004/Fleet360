/**
 * src/lib/fleet/tco-engine.ts
 *
 * Enterprise Fleet Total Cost of Ownership (TCO) Engine.
 *
 * 7 Lifecycle Cost Pillars:
 *   1. Capital Depreciation / Lease Amortization
 *   2. Fuel & Energy Spend
 *   3. Maintenance & Workshop Repairs (Scheduled PM vs Corrective)
 *   4. Tires & Axle Wear
 *   5. Insurance, Registration & Mulkiya Compliance
 *   6. Traffic Fines & Road Tolls (Salik)
 *   7. Operational Labor Cost Allocation
 *
 * Analytics & KPIs:
 *   - Cost Per Kilometer (CPK = Total TCO / Distance Traveled)
 *   - Cost Per Operating Hour (CPH)
 *   - Fuel Economy (km/L)
 *   - Fleet Benchmark Delta (%)
 *   - Asset Replacement & Disposal Recommendation Index
 */

import type { Prisma } from '@prisma/client';

export interface VehicleTcoInput {
  vehicleId: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleGroup: string | null;
  vehicleUsage: string | null;
  acquisitionType?: string | null;
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
  monthlyLeaseCost?: number | null;
  currentOdometerKm: number;
  fuelCost: number;
  fuelLiters: number;
  fuelTransactionsCount: number;
  maintenanceCost: number;
  maintenanceOrdersCount: number;
  finesCost: number;
  finesCount: number;
  insuranceAnnualPremium?: number;
  timeWindowMonths: number;
}

export interface VehicleTcoResult {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  vehicleName: string;
  vehicleGroup: string;
  vehicleUsage: string;
  acquisitionType: string;
  currentOdometerKm: number;
  distancePeriodKm: number;
  timeWindowMonths: number;

  // 7 Cost Pillars (AED)
  depreciationCost: number;
  fuelCost: number;
  maintenanceCost: number;
  tiresCost: number;
  insuranceCost: number;
  finesCost: number;
  laborCost: number;
  totalTco: number;

  // Efficiency & KPIs
  costPerKm: number;
  costPerHour: number;
  fuelEfficiencyKmL: number;
  fleetBenchmarkVariancePct: number;

  // Recommendation
  dispositionStatus: 'KEEP_AND_OPERATE' | 'MAINTENANCE_REVIEW' | 'RECOMMEND_REPLACEMENT';
  dispositionReason: string;
}

export interface FleetTcoSummaryResult {
  timeWindowMonths: number;
  totalVehicles: number;
  fleetTotals: {
    totalTco: number;
    depreciationCost: number;
    fuelCost: number;
    maintenanceCost: number;
    tiresCost: number;
    insuranceCost: number;
    finesCost: number;
    laborCost: number;
    totalDistanceKm: number;
    totalFuelLiters: number;
    averageCpk: number;
  };
  costPillarsPct: {
    depreciation: number;
    fuel: number;
    maintenance: number;
    tires: number;
    insurance: number;
    fines: number;
    labor: number;
  };
  replacementRecommendations: VehicleTcoResult[];
  vehicles: VehicleTcoResult[];
}

/**
 * Pure calculation function for single vehicle TCO and CPK.
 */
export function calculateVehicleTcoSync(
  input: VehicleTcoInput,
  fleetAvgCpk: number = 0,
): VehicleTcoResult {
  const months = Math.max(1, input.timeWindowMonths || 12);
  const vehicleName = [input.make, input.model].filter(Boolean).join(' ') || input.licensePlate || 'Vehicle';
  const vehicleCode = input.vehicleCode || input.licensePlate || 'V-000';
  const licensePlate = input.licensePlate || '—';
  const vehicleGroup = input.vehicleGroup || 'STANDARD';
  const vehicleUsage = input.vehicleUsage || 'OPERATIONAL';
  const acquisitionType = input.acquisitionType || 'PURCHASED';

  // 1. Capital Depreciation / Lease Amortization
  let depreciationCost = 0;
  if (acquisitionType === 'LEASED' || input.monthlyLeaseCost) {
    depreciationCost = (input.monthlyLeaseCost || 2500) * months;
  } else {
    // 5-year straight-line depreciation schedule with 15% salvage value
    const purchasePrice = input.purchasePrice && input.purchasePrice > 0 ? input.purchasePrice : 120000;
    const depreciableBase = purchasePrice * 0.85;
    const monthlyDepreciation = depreciableBase / 60;
    depreciationCost = Math.round(monthlyDepreciation * months);
  }

  // 2. Fuel Cost
  const fuelCost = Math.round(input.fuelCost);

  // 3. Maintenance Cost
  const maintenanceCost = Math.round(input.maintenanceCost);

  // 4. Distance Calculation for the Period
  // Standard commercial vehicle runs ~2,500 km/month
  const estimatedPeriodDistanceKm = Math.max(1000, months * 2500);
  const distancePeriodKm = input.currentOdometerKm > 0
    ? Math.min(input.currentOdometerKm, estimatedPeriodDistanceKm)
    : estimatedPeriodDistanceKm;

  // 5. Tires & Axle Wear (approx. 0.035 AED/km)
  const tiresCost = Math.round(distancePeriodKm * 0.035);

  // 6. Insurance & Registration (Annual comprehensive ~AED 3,600 / yr amortized)
  const annualInsurance = input.insuranceAnnualPremium || 3600;
  const insuranceCost = Math.round((annualInsurance / 12) * months);

  // 7. Traffic Fines
  const finesCost = Math.round(input.finesCost);

  // 8. Operational Labor Cost Allocation (~AED 1,200/mo operating driver allocation)
  const laborCost = Math.round(1200 * months);

  // Total TCO
  const totalTco =
    depreciationCost +
    fuelCost +
    maintenanceCost +
    tiresCost +
    insuranceCost +
    finesCost +
    laborCost;

  // Cost Per Kilometer (CPK)
  const costPerKm = distancePeriodKm > 0 ? Number((totalTco / distancePeriodKm).toFixed(2)) : 0;

  // Cost Per Operating Hour (approx 8 operating hrs/day, 24 days/mo)
  const operatingHours = months * 24 * 8;
  const costPerHour = operatingHours > 0 ? Number((totalTco / operatingHours).toFixed(2)) : 0;

  // Fuel Economy (km / Liter)
  const fuelEfficiencyKmL = input.fuelLiters > 0
    ? Number((distancePeriodKm / input.fuelLiters).toFixed(1))
    : 8.5;

  // Benchmark Variance against Fleet Average CPK
  let fleetBenchmarkVariancePct = 0;
  if (fleetAvgCpk > 0) {
    fleetBenchmarkVariancePct = Number((((costPerKm - fleetAvgCpk) / fleetAvgCpk) * 100).toFixed(1));
  }

  // 9. Disposition & Replacement Advisory
  let dispositionStatus: 'KEEP_AND_OPERATE' | 'MAINTENANCE_REVIEW' | 'RECOMMEND_REPLACEMENT' =
    'KEEP_AND_OPERATE';
  let dispositionReason = 'Optimal operational cost balance.';

  const maintenanceRatio = totalTco > 0 ? maintenanceCost / totalTco : 0;

  if (maintenanceRatio > 0.35 || costPerKm > (fleetAvgCpk > 0 ? fleetAvgCpk * 1.35 : 2.5)) {
    dispositionStatus = 'RECOMMEND_REPLACEMENT';
    dispositionReason = `High cost outlier: Maintenance accounts for ${(maintenanceRatio * 100).toFixed(0)}% of TCO with CPK of ${costPerKm} AED/km. Disposal/replacement recommended.`;
  } else if (maintenanceRatio > 0.22 || costPerKm > (fleetAvgCpk > 0 ? fleetAvgCpk * 1.15 : 1.8)) {
    dispositionStatus = 'MAINTENANCE_REVIEW';
    dispositionReason = `Elevated repair costs (${(maintenanceRatio * 100).toFixed(0)}% of TCO). Recommend preventive diagnostic review.`;
  }

  return {
    vehicleId: input.vehicleId,
    vehicleCode,
    licensePlate,
    vehicleName,
    vehicleGroup,
    vehicleUsage,
    acquisitionType,
    currentOdometerKm: input.currentOdometerKm,
    distancePeriodKm,
    timeWindowMonths: months,
    depreciationCost,
    fuelCost,
    maintenanceCost,
    tiresCost,
    insuranceCost,
    finesCost,
    laborCost,
    totalTco,
    costPerKm,
    costPerHour,
    fuelEfficiencyKmL,
    fleetBenchmarkVariancePct,
    dispositionStatus,
    dispositionReason,
  };
}

/**
 * Calculates the full Fleet TCO Summary and breakdown.
 */
export async function calculateFleetTcoSummary(
  tx: Prisma.TransactionClient,
  tenantId: string,
  options: {
    months?: number;
    vehicleId?: string;
    vehicleGroup?: string;
  } = {},
): Promise<FleetTcoSummaryResult> {
  const months = Math.max(1, Math.min(60, options.months || 12));
  const sinceDate = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000);

  // 1. Fetch Vehicles
  const vehicleWhere: Prisma.VehicleWhereInput = {
    tenantId,
    deletedAt: null,
  };
  if (options.vehicleId) vehicleWhere.id = options.vehicleId;
  if (options.vehicleGroup) vehicleWhere.vehicleGroup = options.vehicleGroup;

  const vehicles = await tx.vehicle.findMany({
    where: vehicleWhere,
    select: {
      id: true,
      vehicleCode: true,
      licensePlate: true,
      make: true,
      model: true,
      year: true,
      vehicleGroup: true,
      vehicleUsage: true,
      acquisitionType: true,
      purchasePrice: true,
      purchaseDate: true,
      odometerReading: true,
      currentMileage: true,
    },
    take: 100,
  });

  if (vehicles.length === 0) {
    return {
      timeWindowMonths: months,
      totalVehicles: 0,
      fleetTotals: {
        totalTco: 0,
        depreciationCost: 0,
        fuelCost: 0,
        maintenanceCost: 0,
        tiresCost: 0,
        insuranceCost: 0,
        finesCost: 0,
        laborCost: 0,
        totalDistanceKm: 0,
        totalFuelLiters: 0,
        averageCpk: 0,
      },
      costPillarsPct: {
        depreciation: 0,
        fuel: 0,
        maintenance: 0,
        tires: 0,
        insurance: 0,
        fines: 0,
        labor: 0,
      },
      replacementRecommendations: [],
      vehicles: [],
    };
  }

  const vehicleIds = vehicles.map((v) => v.id);

  // 2. Fetch Fuel Logs
  const fuelLogs = await tx.fuelLog.findMany({
    where: {
      tenantId,
      vehicleId: { in: vehicleIds },
      fuelDate: { gte: sinceDate },
    },
    select: {
      vehicleId: true,
      totalCost: true,
      liters: true,
    },
  });

  const fuelMap = new Map<string, { totalCost: number; liters: number; count: number }>();
  for (const fl of fuelLogs) {
    const prev = fuelMap.get(fl.vehicleId) || { totalCost: 0, liters: 0, count: 0 };
    prev.totalCost += Number(fl.totalCost || 0);
    prev.liters += Number(fl.liters || 0);
    prev.count += 1;
    fuelMap.set(fl.vehicleId, prev);
  }

  // 3. Fetch Traffic Fines
  const fines = await tx.trafficFine.findMany({
    where: {
      tenantId,
      vehicleId: { in: vehicleIds },
      fineDate: { gte: sinceDate },
    },
    select: {
      vehicleId: true,
      fineAmount: true,
    },
  });

  const finesMap = new Map<string, { totalFines: number; count: number }>();
  for (const f of fines) {
    const prev = finesMap.get(f.vehicleId) || { totalFines: 0, count: 0 };
    prev.totalFines += Number(f.fineAmount || 0);
    prev.count += 1;
    finesMap.set(f.vehicleId, prev);
  }

  // 4. Fetch Maintenance & Work Orders
  const workOrders = await tx.workOrder.findMany({
    where: {
      tenantId,
      MaintenanceRequest: {
        vehicleId: { in: vehicleIds },
      },
      startDate: { gte: sinceDate },
    },
    select: {
      totalLaborHours: true,
      MaintenanceRequest: {
        select: {
          vehicleId: true,
        },
      },
      PartUsage: {
        select: {
          quantity: true,
          unitCost: true,
        },
      },
    },
  });

  const maintMap = new Map<string, { totalCost: number; count: number }>();
  for (const wo of workOrders) {
    const vid = wo.MaintenanceRequest?.vehicleId;
    if (!vid) continue;

    const prev = maintMap.get(vid) || { totalCost: 0, count: 0 };
    const laborCost = (wo.totalLaborHours || 2) * 90; // Standard 90 AED/hr garage labor rate
    const partsCost = (wo.PartUsage || []).reduce(
      (sum, p) => sum + (p.quantity || 1) * Number(p.unitCost || 0),
      0,
    );
    prev.totalCost += laborCost + partsCost;
    prev.count += 1;
    maintMap.set(vid, prev);
  }

  // 5. Compute Initial TCO without fleet benchmark
  const rawResults: VehicleTcoResult[] = vehicles.map((v) => {
    const fuel = fuelMap.get(v.id) || { totalCost: 0, liters: 0, count: 0 };
    const fine = finesMap.get(v.id) || { totalFines: 0, count: 0 };
    const maint = maintMap.get(v.id) || { totalCost: 0, count: 0 };

    const odometer = Number(v.odometerReading || v.currentMileage || 0);
    const purchasePrice = v.purchasePrice ? Number(v.purchasePrice) : 120000;

    return calculateVehicleTcoSync({
      vehicleId: v.id,
      vehicleCode: v.vehicleCode,
      licensePlate: v.licensePlate,
      make: v.make,
      model: v.model,
      year: v.year ? Number(v.year) : null,
      vehicleGroup: v.vehicleGroup,
      vehicleUsage: v.vehicleUsage,
      acquisitionType: v.acquisitionType,
      purchasePrice,
      purchaseDate: v.purchaseDate,
      currentOdometerKm: odometer,
      fuelCost: fuel.totalCost,
      fuelLiters: fuel.liters,
      fuelTransactionsCount: fuel.count,
      maintenanceCost: maint.totalCost,
      maintenanceOrdersCount: maint.count,
      finesCost: fine.totalFines,
      finesCount: fine.count,
      timeWindowMonths: months,
    });
  });

  // 6. Compute Fleet Benchmark Average CPK
  const totalFleetTco = rawResults.reduce((sum, r) => sum + r.totalTco, 0);
  const totalFleetDistance = rawResults.reduce((sum, r) => sum + r.distancePeriodKm, 0);
  const fleetAvgCpk = totalFleetDistance > 0 ? Number((totalFleetTco / totalFleetDistance).toFixed(2)) : 1.25;

  // 7. Re-calculate with benchmark delta and disposition rules
  const finalResults = rawResults.map((r) => {
    let variance = 0;
    if (fleetAvgCpk > 0) {
      variance = Number((((r.costPerKm - fleetAvgCpk) / fleetAvgCpk) * 100).toFixed(1));
    }

    const maintRatio = r.totalTco > 0 ? r.maintenanceCost / r.totalTco : 0;
    let dispositionStatus: 'KEEP_AND_OPERATE' | 'MAINTENANCE_REVIEW' | 'RECOMMEND_REPLACEMENT' =
      'KEEP_AND_OPERATE';
    let dispositionReason = 'Optimal operational cost balance.';

    if (maintRatio > 0.35 || r.costPerKm > fleetAvgCpk * 1.35) {
      dispositionStatus = 'RECOMMEND_REPLACEMENT';
      dispositionReason = `High cost outlier: CPK is ${variance > 0 ? `+${variance}%` : `${variance}%`} vs fleet average with ${(maintRatio * 100).toFixed(0)}% maintenance ratio.`;
    } else if (maintRatio > 0.22 || r.costPerKm > fleetAvgCpk * 1.15) {
      dispositionStatus = 'MAINTENANCE_REVIEW';
      dispositionReason = `Elevated repair costs (${(maintRatio * 100).toFixed(0)}% of TCO). Needs preventive diagnostic.`;
    }

    return {
      ...r,
      fleetBenchmarkVariancePct: variance,
      dispositionStatus,
      dispositionReason,
    };
  });

  // Sort by highest TCO first
  finalResults.sort((a, b) => b.totalTco - a.totalTco);

  // Fleet Totals
  const totalDepreciation = finalResults.reduce((sum, r) => sum + r.depreciationCost, 0);
  const totalFuel = finalResults.reduce((sum, r) => sum + r.fuelCost, 0);
  const totalMaint = finalResults.reduce((sum, r) => sum + r.maintenanceCost, 0);
  const totalTires = finalResults.reduce((sum, r) => sum + r.tiresCost, 0);
  const totalInsurance = finalResults.reduce((sum, r) => sum + r.insuranceCost, 0);
  const totalFines = finalResults.reduce((sum, r) => sum + r.finesCost, 0);
  const totalLabor = finalResults.reduce((sum, r) => sum + r.laborCost, 0);
  const totalFuelLiters = Array.from(fuelMap.values()).reduce((sum, f) => sum + f.liters, 0);

  const safeTotal = Math.max(1, totalFleetTco);

  return {
    timeWindowMonths: months,
    totalVehicles: finalResults.length,
    fleetTotals: {
      totalTco: totalFleetTco,
      depreciationCost: totalDepreciation,
      fuelCost: totalFuel,
      maintenanceCost: totalMaint,
      tiresCost: totalTires,
      insuranceCost: totalInsurance,
      finesCost: totalFines,
      laborCost: totalLabor,
      totalDistanceKm: totalFleetDistance,
      totalFuelLiters,
      averageCpk: fleetAvgCpk,
    },
    costPillarsPct: {
      depreciation: Number(((totalDepreciation / safeTotal) * 100).toFixed(1)),
      fuel: Number(((totalFuel / safeTotal) * 100).toFixed(1)),
      maintenance: Number(((totalMaint / safeTotal) * 100).toFixed(1)),
      tires: Number(((totalTires / safeTotal) * 100).toFixed(1)),
      insurance: Number(((totalInsurance / safeTotal) * 100).toFixed(1)),
      fines: Number(((totalFines / safeTotal) * 100).toFixed(1)),
      labor: Number(((totalLabor / safeTotal) * 100).toFixed(1)),
    },
    replacementRecommendations: finalResults.filter((r) => r.dispositionStatus === 'RECOMMEND_REPLACEMENT'),
    vehicles: finalResults,
  };
}
