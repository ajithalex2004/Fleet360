/**
 * tests/unit/bus-ops-cost-allocation.test.ts
 *
 * Unit tests for Departmental Cost Allocation & Recharge Matrix Engine.
 */

import { describe, it, expect } from 'vitest';
import { calculateDepartmentCostAllocationSync } from '@/lib/bus-ops/cost-allocation';

describe('Departmental Cost Allocation & Recharge Matrix Engine', () => {
  const employees = [
    { id: 'emp-1', department: 'Plant Operations' },
    { id: 'emp-2', department: 'Plant Operations' },
    { id: 'emp-3', department: 'Plant Operations' },
    { id: 'emp-4', department: 'Facilities & Security' },
    { id: 'emp-5', department: 'Facilities & Security' },
    { id: 'emp-6', department: 'Corporate HQ' },
  ];

  const trips = [
    {
      id: 'trip-1',
      routeDistanceKm: 25, // 25 km trip
      passengers: [
        { staffMemberId: 'emp-1', department: 'Plant Operations', boarded: true },
        { staffMemberId: 'emp-2', department: 'Plant Operations', boarded: true },
        { staffMemberId: 'emp-4', department: 'Facilities & Security', boarded: true },
      ],
    },
    {
      id: 'trip-2',
      routeDistanceKm: 20, // 20 km trip
      passengers: [
        { staffMemberId: 'emp-3', department: 'Plant Operations', boarded: true },
        { staffMemberId: 'emp-5', department: 'Facilities & Security', boarded: true },
        { staffMemberId: 'emp-6', department: 'Corporate HQ', boarded: false }, // Did not board
      ],
    },
  ];

  it('correctly aggregates boardings, active riders, and Pax-Km by department', () => {
    const summary = calculateDepartmentCostAllocationSync({
      period: '2026-08',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.000Z',
      totalFuelCost: 1200,
      totalMaintenanceCost: 800,
      totalDriverCost: 2000,
      trips,
      employees,
    });

    expect(summary.period).toBe('2026-08');
    expect(summary.totalFleetOperatingCost).toBe(4000); // 1200 + 800 + 2000
    expect(summary.totalBoardings).toBe(5); // 3 on trip-1, 2 on trip-2

    // Trip-1: 3 pax * 25 km = 75 pax-km
    // Trip-2: 2 pax * 20 km = 40 pax-km
    // Total Pax-Km = 115
    expect(summary.totalPaxKm).toBe(115);

    const plantDept = summary.departments.find(d => d.departmentName === 'Plant Operations');
    expect(plantDept).toBeDefined();
    expect(plantDept?.registeredEmployees).toBe(3);
    expect(plantDept?.activeRiders).toBe(3);
    expect(plantDept?.totalBoardings).toBe(3); // emp-1 (trip 1), emp-2 (trip 1), emp-3 (trip 2)
    // Plant Pax-Km: 2 * 25 km + 1 * 20 km = 70 pax-km
    expect(plantDept?.paxKm).toBe(70);
    // Plant share: 70 / 115 = 60.9%
    expect(plantDept?.paxKmSharePercent).toBe(60.9);

    const secDept = summary.departments.find(d => d.departmentName === 'Facilities & Security');
    expect(secDept).toBeDefined();
    expect(secDept?.registeredEmployees).toBe(2);
    expect(secDept?.activeRiders).toBe(2);
    expect(secDept?.totalBoardings).toBe(2); // emp-4 (trip 1), emp-5 (trip 2)
    // Security Pax-Km: 1 * 25 km + 1 * 20 km = 45 pax-km
    expect(secDept?.paxKm).toBe(45);
    // Security share: 45 / 115 = 39.1%
    expect(secDept?.paxKmSharePercent).toBe(39.1);

    const hqDept = summary.departments.find(d => d.departmentName === 'Corporate HQ');
    expect(hqDept).toBeDefined();
    expect(hqDept?.registeredEmployees).toBe(1);
    expect(hqDept?.activeRiders).toBe(0);
    expect(hqDept?.totalBoardings).toBe(0);
    expect(hqDept?.paxKm).toBe(0);
    expect(hqDept?.paxKmSharePercent).toBe(0);
    expect(hqDept?.allocatedOperatingCost).toBe(0);
    expect(hqDept?.totalRechargeAmount).toBe(0);
  });

  it('calculates Recharge Matrix charges based on Base Fee + Scan Rate + Distance Surcharge', () => {
    const summary = calculateDepartmentCostAllocationSync({
      period: '2026-08',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.000Z',
      totalFuelCost: 1000,
      totalMaintenanceCost: 500,
      totalDriverCost: 1500,
      trips,
      employees,
      rateConfig: {
        baseFeePerDept: 500,
        scanFeePerBoarding: 5.0, // AED 5 per scan
        kmFeePerPaxKm: 0.5,      // AED 0.50 per km
      },
    });

    const plantDept = summary.departments.find(d => d.departmentName === 'Plant Operations');
    expect(plantDept?.rechargeBaseFee).toBe(500);
    expect(plantDept?.rechargeScanFee).toBe(15.0); // 3 boardings * AED 5
    expect(plantDept?.rechargeKmFee).toBe(35.0);   // 70 pax-km * AED 0.50
    expect(plantDept?.totalRechargeAmount).toBe(550.0); // 500 + 15 + 35

    const secDept = summary.departments.find(d => d.departmentName === 'Facilities & Security');
    expect(secDept?.rechargeBaseFee).toBe(500);
    expect(secDept?.rechargeScanFee).toBe(10.0); // 2 boardings * AED 5
    expect(secDept?.rechargeKmFee).toBe(22.5);   // 45 pax-km * AED 0.50
    expect(secDept?.totalRechargeAmount).toBe(532.5); // 500 + 10 + 22.5
  });

  it('safely handles empty trips and zero-division cases', () => {
    const summary = calculateDepartmentCostAllocationSync({
      period: '2026-08',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.000Z',
      totalFuelCost: 0,
      totalMaintenanceCost: 0,
      totalDriverCost: 0,
      trips: [],
      employees,
    });

    expect(summary.totalTrips).toBe(0);
    expect(summary.totalBoardings).toBe(0);
    expect(summary.totalPaxKm).toBe(0);
    expect(summary.costPerPaxKm).toBe(0);
    expect(summary.costPerBoarding).toBe(0);
    expect(summary.departments.length).toBe(3);
    for (const d of summary.departments) {
      expect(d.totalRechargeAmount).toBe(0);
      expect(d.allocatedOperatingCost).toBe(0);
    }
  });
});
