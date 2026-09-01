/**
 * tests/unit/fleet-tco-engine.test.ts
 *
 * Unit tests for Enterprise Fleet Total Cost of Ownership (TCO) Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateVehicleTcoSync,
  type VehicleTcoInput,
} from '@/lib/fleet/tco-engine';

describe('Fleet TCO Calculation Engine (7 Pillars & CPK)', () => {
  const sampleVehicle: VehicleTcoInput = {
    vehicleId: 'veh-001',
    vehicleCode: 'BUS-101',
    licensePlate: 'DXB-54321',
    make: 'Ashok Leyland',
    model: 'Falcon 55-Seater',
    year: 2023,
    vehicleGroup: 'BUS',
    vehicleUsage: 'STAFF',
    acquisitionType: 'PURCHASED',
    purchasePrice: 180000,
    currentOdometerKm: 45000,
    fuelCost: 28000,
    fuelLiters: 9200,
    fuelTransactionsCount: 48,
    maintenanceCost: 14000,
    maintenanceOrdersCount: 6,
    finesCost: 1500,
    finesCount: 3,
    timeWindowMonths: 12,
  };

  it('accurately calculates 7-pillar TCO and Cost Per Kilometer (CPK)', () => {
    // Fleet Average CPK = 2.50 AED/km
    const result = calculateVehicleTcoSync(sampleVehicle, 2.50);

    // 1. Depreciation (180k * 0.85 / 60 * 12 = 30,600 AED)
    expect(result.depreciationCost).toBe(30600);

    // 2. Fuel Cost
    expect(result.fuelCost).toBe(28000);

    // 3. Maintenance Cost
    expect(result.maintenanceCost).toBe(14000);

    // 4. Tires Cost (30,000 km in period * 0.035 = 1,050 AED)
    expect(result.tiresCost).toBeGreaterThan(900);

    // 5. Insurance Cost (3,600 AED/yr)
    expect(result.insuranceCost).toBe(3600);

    // 6. Fines Cost
    expect(result.finesCost).toBe(1500);

    // 7. Labor Cost (1,200 * 12 = 14,400 AED)
    expect(result.laborCost).toBe(14400);

    // Total TCO should be the sum of all 7 pillars
    const expectedSum =
      result.depreciationCost +
      result.fuelCost +
      result.maintenanceCost +
      result.tiresCost +
      result.insuranceCost +
      result.finesCost +
      result.laborCost;

    expect(result.totalTco).toBe(expectedSum);
    expect(result.costPerKm).toBeGreaterThan(2.0);
    expect(result.costPerKm).toBeLessThan(3.5);
  });

  it('classifies a healthy vehicle with low maintenance as KEEP_AND_OPERATE', () => {
    const result = calculateVehicleTcoSync(sampleVehicle, 3.0);

    expect(result.dispositionStatus).toBe('KEEP_AND_OPERATE');
    expect(result.dispositionReason).toContain('Optimal operational cost balance');
  });

  it('flags a money-pit vehicle with excessive maintenance as RECOMMEND_REPLACEMENT', () => {
    const outlierVehicle: VehicleTcoInput = {
      ...sampleVehicle,
      maintenanceCost: 65000, // Very high maintenance cost
      fuelCost: 45000,
    };

    const result = calculateVehicleTcoSync(outlierVehicle, 2.20);

    expect(result.dispositionStatus).toBe('RECOMMEND_REPLACEMENT');
    expect(result.dispositionReason).toContain('Disposal/replacement recommended');
  });

  it('calculates accurate monthly amortization for LEASED acquisition type', () => {
    const leasedVehicle: VehicleTcoInput = {
      ...sampleVehicle,
      acquisitionType: 'LEASED',
      monthlyLeaseCost: 3500,
      timeWindowMonths: 6,
    };

    const result = calculateVehicleTcoSync(leasedVehicle, 2.50);

    // 3,500 AED/mo * 6 months = 21,000 AED
    expect(result.depreciationCost).toBe(21000);
    expect(result.acquisitionType).toBe('LEASED');
  });
});
