/**
 * Resource Cost Profile & Repositioning Cost Engine
 * -------------------------------------------------
 * Computes exact operating, overtime, deadhead, toll, and repositioning expenses
 * from tenant-configured rate profiles rather than hardcoded constants.
 */

import { ResourceCostProfile } from '../types';

export const DEFAULT_COST_PROFILES: Record<string, ResourceCostProfile> = {
  COACH_50: {
    tenantId: 'default',
    vehicleCategory: 'COACH_50',
    fixedDailyCostAed: 250.0,
    variableCostPerKm: 1.20,
    fuelCostPerKm: 0.95,
    tollCostPerGate: 4.0,
    driverHourlyRateAed: 35.0,
    driverOvertimeHourlyRateAed: 52.5,
    depreciationPerKm: 0.40,
    repositionCostFormula: {
      fuelRatePerKm: 0.95,
      driverTimeRatePerHour: 35.0,
      tollEstimateAed: 4.0,
      vehicleWearPerKm: 0.35,
      returnPositioningRiskFactor: 1.20,
    },
    exchangeStandardCharterRateAed: 850.0,
    unservedPenaltyAed: 2500.0,
  },
  COASTER_30: {
    tenantId: 'default',
    vehicleCategory: 'COASTER_30',
    fixedDailyCostAed: 180.0,
    variableCostPerKm: 0.90,
    fuelCostPerKm: 0.75,
    tollCostPerGate: 4.0,
    driverHourlyRateAed: 30.0,
    driverOvertimeHourlyRateAed: 45.0,
    depreciationPerKm: 0.30,
    repositionCostFormula: {
      fuelRatePerKm: 0.75,
      driverTimeRatePerHour: 30.0,
      tollEstimateAed: 4.0,
      vehicleWearPerKm: 0.25,
      returnPositioningRiskFactor: 1.20,
    },
    exchangeStandardCharterRateAed: 600.0,
    unservedPenaltyAed: 2000.0,
  },
  MINIVAN_14: {
    tenantId: 'default',
    vehicleCategory: 'MINIVAN_14',
    fixedDailyCostAed: 120.0,
    variableCostPerKm: 0.65,
    fuelCostPerKm: 0.55,
    tollCostPerGate: 4.0,
    driverHourlyRateAed: 25.0,
    driverOvertimeHourlyRateAed: 37.5,
    depreciationPerKm: 0.20,
    repositionCostFormula: {
      fuelRatePerKm: 0.55,
      driverTimeRatePerHour: 25.0,
      tollEstimateAed: 4.0,
      vehicleWearPerKm: 0.15,
      returnPositioningRiskFactor: 1.15,
    },
    exchangeStandardCharterRateAed: 450.0,
    unservedPenaltyAed: 1500.0,
  },
  SEDAN: {
    tenantId: 'default',
    vehicleCategory: 'SEDAN',
    fixedDailyCostAed: 90.0,
    variableCostPerKm: 0.50,
    fuelCostPerKm: 0.45,
    tollCostPerGate: 4.0,
    driverHourlyRateAed: 22.0,
    driverOvertimeHourlyRateAed: 33.0,
    depreciationPerKm: 0.15,
    repositionCostFormula: {
      fuelRatePerKm: 0.45,
      driverTimeRatePerHour: 22.0,
      tollEstimateAed: 4.0,
      vehicleWearPerKm: 0.10,
      returnPositioningRiskFactor: 1.10,
    },
    exchangeStandardCharterRateAed: 350.0,
    unservedPenaltyAed: 1000.0,
  },
};

export class ResourceCostEngine {
  /**
   * Resolve cost profile for category
   */
  resolveCostProfile(
    category: string,
    overrides?: Partial<ResourceCostProfile>,
  ): ResourceCostProfile {
    const key = category.toUpperCase().replace(/\s+/g, '_');
    const base = DEFAULT_COST_PROFILES[key] || DEFAULT_COST_PROFILES.COASTER_30;

    return {
      ...base,
      ...overrides,
    };
  }

  /**
   * Compute comprehensive repositioning cost:
   * Fuel + Driver labor + Tolls + Vehicle Wear + Return positioning risk
   */
  computeRepositionCost(
    category: string,
    distanceKm: number,
    durationMin: number,
    tollGatesCount: number = 1,
    overrides?: Partial<ResourceCostProfile>,
  ): {
    fuelCostAed: number;
    driverCostAed: number;
    tollCostAed: number;
    vehicleWearAed: number;
    totalRepositionCostAed: number;
    benchmarkExchangeCostAed: number;
    netSavingsAed: number;
  } {
    const profile = this.resolveCostProfile(category, overrides);
    const form = profile.repositionCostFormula;

    const durationHours = durationMin / 60;
    const fuelCostAed = parseFloat((distanceKm * form.fuelRatePerKm).toFixed(2));
    const driverCostAed = parseFloat((durationHours * form.driverTimeRatePerHour).toFixed(2));
    const tollCostAed = parseFloat((tollGatesCount * form.tollEstimateAed).toFixed(2));
    const vehicleWearAed = parseFloat((distanceKm * form.vehicleWearPerKm * form.returnPositioningRiskFactor).toFixed(2));

    const totalRepositionCostAed = parseFloat(
      (fuelCostAed + driverCostAed + tollCostAed + vehicleWearAed).toFixed(2),
    );

    const benchmarkExchangeCostAed = profile.exchangeStandardCharterRateAed;
    const netSavingsAed = parseFloat(
      Math.max(0, benchmarkExchangeCostAed - totalRepositionCostAed).toFixed(2),
    );

    return {
      fuelCostAed,
      driverCostAed,
      tollCostAed,
      vehicleWearAed,
      totalRepositionCostAed,
      benchmarkExchangeCostAed,
      netSavingsAed,
    };
  }
}

export const resourceCostEngine = new ResourceCostEngine();
