/**
 * src/lib/bus-ops/cost-allocation.ts
 *
 * Departmental Cost Allocation & Recharge Matrix Engine
 *
 * Allocates total commuter transportation expenses across internal
 * business departments using:
 *  1. Passenger-Kilometer (Pax-Km) Pro-Rata Model
 *  2. Actual Boarding Scan Activity Model
 *  3. Recharge Matrix (Internal Cross-Charge Invoicing & GL Postings)
 */

import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { createDraftJournalEntry } from '@/lib/finance/journal-service';

export interface DepartmentUsage {
  departmentName: string;
  costCenterCode: string;
  registeredEmployees: number;
  activeRiders: number;
  totalBoardings: number;
  paxKm: number;
  paxKmSharePercent: number;
  allocatedOperatingCost: number;
  rechargeBaseFee: number;
  rechargeScanFee: number;
  rechargeKmFee: number;
  totalRechargeAmount: number;
}

export interface CostAllocationSummary {
  period: string; // YYYY-MM
  startDate: string;
  endDate: string;
  totalTrips: number;
  totalFleetOperatingCost: number;
  totalFuelCost: number;
  totalMaintenanceCost: number;
  totalDriverCost: number;
  totalPaxKm: number;
  totalBoardings: number;
  costPerPaxKm: number;
  costPerBoarding: number;
  departments: DepartmentUsage[];
  calculatedAt: string;
}

export interface RateConfig {
  baseFeePerDept?: number;
  scanFeePerBoarding?: number;
  kmFeePerPaxKm?: number;
}

const DEFAULT_RATES: Required<RateConfig> = {
  baseFeePerDept: 500,     // AED 500 fixed base fee per active department
  scanFeePerBoarding: 4.50, // AED 4.50 per individual trip boarding
  kmFeePerPaxKm: 0.25,     // AED 0.25 per Passenger-Kilometer surcharge
};

/**
 * Pure calculation function for departmental cost allocation and recharge matrix.
 */
export function calculateDepartmentCostAllocationSync(params: {
  period: string;
  startDate: string;
  endDate: string;
  totalFuelCost: number;
  totalMaintenanceCost: number;
  totalDriverCost: number;
  trips: Array<{
    id: string;
    routeDistanceKm: number;
    passengers: Array<{
      staffMemberId: string | null;
      department: string | null;
      boarded: boolean;
    }>;
  }>;
  employees: Array<{
    id: string;
    department: string | null;
  }>;
  rateConfig?: RateConfig;
}): CostAllocationSummary {
  const rates = { ...DEFAULT_RATES, ...params.rateConfig };
  const totalFleetOperatingCost = params.totalFuelCost + params.totalMaintenanceCost + params.totalDriverCost;

  // 1. Group registered employees by department
  const registeredByDept = new Map<string, number>();
  for (const emp of params.employees) {
    const dept = (emp.department || 'Unassigned').trim();
    registeredByDept.set(dept, (registeredByDept.get(dept) || 0) + 1);
  }

  // 2. Aggregate trip boardings & Pax-Km by department
  const boardingsByDept = new Map<string, number>();
  const activeRidersByDept = new Map<string, Set<string>>();
  const paxKmByDept = new Map<string, number>();
  let totalBoardings = 0;
  let totalPaxKm = 0;

  for (const trip of params.trips) {
    const distKm = Math.max(1, trip.routeDistanceKm || 15); // Fallback 15km default if not measured

    for (const pax of trip.passengers) {
      const dept = (pax.department || 'Unassigned').trim();

      if (pax.boarded) {
        boardingsByDept.set(dept, (boardingsByDept.get(dept) || 0) + 1);
        totalBoardings += 1;

        if (pax.staffMemberId) {
          if (!activeRidersByDept.has(dept)) activeRidersByDept.set(dept, new Set());
          activeRidersByDept.get(dept)!.add(pax.staffMemberId);
        }

        const tripPaxKm = distKm;
        paxKmByDept.set(dept, (paxKmByDept.get(dept) || 0) + tripPaxKm);
        totalPaxKm += tripPaxKm;
      }
    }
  }

  // Ensure all known departments are represented
  const allDeptNames = new Set([
    ...registeredByDept.keys(),
    ...boardingsByDept.keys(),
  ]);

  const departments: DepartmentUsage[] = [];

  for (const dept of Array.from(allDeptNames).sort()) {
    const registeredEmployees = registeredByDept.get(dept) || 0;
    const activeRiders = activeRidersByDept.get(dept)?.size || 0;
    const deptBoardings = boardingsByDept.get(dept) || 0;
    const deptPaxKm = Math.round((paxKmByDept.get(dept) || 0) * 10) / 10;

    const paxKmSharePercent = totalPaxKm > 0
      ? Math.round((deptPaxKm / totalPaxKm) * 1000) / 10
      : 0;

    // Pro-rata operating cost share
    const allocatedOperatingCost = totalPaxKm > 0
      ? Math.round((deptPaxKm / totalPaxKm) * totalFleetOperatingCost * 100) / 100
      : totalBoardings > 0
        ? Math.round((deptBoardings / totalBoardings) * totalFleetOperatingCost * 100) / 100
        : 0;

    // Recharge Matrix Calculation
    const rechargeBaseFee = deptBoardings > 0 ? rates.baseFeePerDept : 0;
    const rechargeScanFee = Math.round(deptBoardings * rates.scanFeePerBoarding * 100) / 100;
    const rechargeKmFee = Math.round(deptPaxKm * rates.kmFeePerPaxKm * 100) / 100;
    const totalRechargeAmount = Math.round((rechargeBaseFee + rechargeScanFee + rechargeKmFee) * 100) / 100;

    // Cost Center Tag Generation
    const cleanCode = dept.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'GEN';
    const costCenterCode = `CC-${cleanCode}`;

    departments.push({
      departmentName: dept,
      costCenterCode,
      registeredEmployees,
      activeRiders,
      totalBoardings: deptBoardings,
      paxKm: deptPaxKm,
      paxKmSharePercent,
      allocatedOperatingCost,
      rechargeBaseFee,
      rechargeScanFee,
      rechargeKmFee,
      totalRechargeAmount,
    });
  }

  const costPerPaxKm = totalPaxKm > 0 ? Math.round((totalFleetOperatingCost / totalPaxKm) * 1000) / 1000 : 0;
  const costPerBoarding = totalBoardings > 0 ? Math.round((totalFleetOperatingCost / totalBoardings) * 100) / 100 : 0;

  return {
    period: params.period,
    startDate: params.startDate,
    endDate: params.endDate,
    totalTrips: params.trips.length,
    totalFleetOperatingCost: Math.round(totalFleetOperatingCost * 100) / 100,
    totalFuelCost: Math.round(params.totalFuelCost * 100) / 100,
    totalMaintenanceCost: Math.round(params.totalMaintenanceCost * 100) / 100,
    totalDriverCost: Math.round(params.totalDriverCost * 100) / 100,
    totalPaxKm: Math.round(totalPaxKm * 10) / 10,
    totalBoardings,
    costPerPaxKm,
    costPerBoarding,
    departments,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluates departmental cost allocation for a tenant over a given monthly period.
 */
export async function getTenantCostAllocation(
  tenantId: string,
  options: {
    year?: number;
    month?: number; // 1 - 12
    rateConfig?: RateConfig;
  } = {},
): Promise<CostAllocationSummary> {
  const now = new Date();
  const year = options.year || now.getFullYear();
  const month = options.month || (now.getMonth() + 1);

  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const periodStr = `${year}-${String(month).padStart(2, '0')}`;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // 1. Fetch registered employees
    const employees = await tx.staffMember.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, department: true },
    });

    const employeeDeptMap = new Map<string, string>();
    for (const e of employees) {
      if (e.department) employeeDeptMap.set(e.id, e.department.trim());
    }

    // 2. Fetch completed trips in the period
    const trips = await tx.tripSchedule.findMany({
      where: {
        tenantId,
        departureTime: { gte: startDate, lte: endDate },
        status: { in: ['COMPLETED', 'DEPARTED', 'IN_TRANSIT'] },
      },
      include: {
        route: { select: { totalDistanceKm: true } },
        passengers: {
          select: {
            id: true,
            staffMemberId: true,
            status: true,
            boardedAt: true,
          },
        },
      },
    });

    // Format trips for pure calculator
    const formattedTrips = trips.map(t => ({
      id: t.id,
      routeDistanceKm: t.route?.totalDistanceKm || 20,
      passengers: t.passengers.map(p => ({
        staffMemberId: p.staffMemberId,
        department: p.staffMemberId ? (employeeDeptMap.get(p.staffMemberId) || 'Unassigned') : 'Unassigned',
        boarded: p.boardedAt != null || p.status === 'BOARDED' || p.status === 'CONFIRMED',
      })),
    }));

    // 3. Fetch fuel costs in the period for bus vehicles
    const fuelLogs = await tx.fuelLog.findMany({
      where: {
        tenantId,
        fuelDate: { gte: startDate, lte: endDate },
      },
      select: { totalCost: true },
    });
    const totalFuelCost = fuelLogs.reduce((sum, f) => sum + Number(f.totalCost || 0), 0);

    // 4. Fetch maintenance costs in the period
    const workOrders = await tx.workOrder.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        status: 'COMPLETED',
      },
      select: { totalCost: true, laborCost: true, partsCost: true },
    });
    const totalMaintenanceCost = workOrders.reduce((sum, w) => sum + Number(w.totalCost || 0), 0);

    // 5. Driver cost estimate (e.g. AED 4,500 monthly salary per active driver assigned)
    const distinctDrivers = new Set(trips.map(t => t.driverId).filter(Boolean));
    const totalDriverCost = distinctDrivers.size * 4500;

    return calculateDepartmentCostAllocationSync({
      period: periodStr,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalFuelCost: totalFuelCost > 0 ? totalFuelCost : trips.length * 45, // Fallback realistic diesel benchmark
      totalMaintenanceCost: totalMaintenanceCost > 0 ? totalMaintenanceCost : trips.length * 25,
      totalDriverCost: totalDriverCost > 0 ? totalDriverCost : trips.length * 35,
      trips: formattedTrips,
      employees,
      rateConfig: options.rateConfig,
    });
  });
}

/**
 * Creates draft General Ledger Journal Entries in the Finance module for the monthly recharge matrix.
 */
export async function postRechargeJournalBatch(
  tenantId: string,
  summary: CostAllocationSummary,
): Promise<{ journalEntryId?: string; totalDebited: number }> {
  let totalRecharge = 0;
  const lineItems: Array<{
    accountNumber: string;
    costCenterCode: string;
    description: string;
    debitAmount: number;
    creditAmount: number;
  }> = [];

  for (const dept of summary.departments) {
    if (dept.totalRechargeAmount <= 0) continue;
    totalRecharge += dept.totalRechargeAmount;

    // Debit: Department Transport Expense
    lineItems.push({
      accountNumber: '5145', // Bus Operations Expense
      costCenterCode: dept.costCenterCode,
      description: `Staff Transport Recharge ${summary.period} - ${dept.departmentName} (${dept.totalBoardings} trips, ${dept.paxKm} pax-km)`,
      debitAmount: dept.totalRechargeAmount,
      creditAmount: 0,
    });
  }

  if (totalRecharge <= 0) {
    return { totalDebited: 0 };
  }

  // Credit: Fleet Central Recovery
  lineItems.push({
    accountNumber: '4500', // Bus Operations Recovery / Revenue
    costCenterCode: 'PC-BUS',
    description: `Staff Transport Internal Recharge Recovery ${summary.period}`,
    debitAmount: 0,
    creditAmount: totalRecharge,
  });

  const entry = await createDraftJournalEntry(tenantId, {
    entryDate: new Date().toISOString(),
    reference: `RECHARGE-${summary.period}`,
    description: `Monthly Staff Transport Departmental Recharge ${summary.period}`,
    lines: lineItems.map(l => ({
      accountCode: l.accountNumber,
      accountName: l.accountNumber === '5145' ? 'Staff Transport Expense' : 'Bus Ops Cost Recovery',
      costCenter: l.costCenterCode,
      debit: l.debitAmount,
      credit: l.creditAmount,
      description: l.description,
    })),
  });

  return {
    journalEntryId: entry.id,
    totalDebited: totalRecharge,
  };
}
