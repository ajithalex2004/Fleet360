/**
 * src/lib/fleet/fine-toll-matcher.ts
 *
 * Traffic Fine & Toll (Salik/Darb) Auto-Matcher Engine.
 * Cross-references violation timestamps against active DriverShifts, trip manifests,
 * and telematics telemetry to assign liability and enable 100% payroll cost recovery.
 */

import { Prisma, PrismaClient } from '@prisma/client';

export type FineLiabilityCategory = 'DRIVER' | 'COMPANY' | 'SPLIT' | 'UNASSIGNED';

export type MatchSource =
  | 'EXACT_SHIFT_TIMESTAMP'
  | 'TRIP_MANIFEST'
  | 'DAILY_SHIFT_EXCLUSIVE'
  | 'COMPANY_DEFECT_OFFENCE'
  | 'UNMATCHED';

export interface FineMatchResult {
  fineId: string;
  vehicleId: string;
  driverId: string | null;
  driverName?: string | null;
  fineAmount: number;
  fineDate: Date;
  offenceType?: string | null;
  authority?: string | null;
  assignedTo: 'DRIVER' | 'COMPANY';
  matchConfidence: number; // 0 - 100%
  matchSource: MatchSource;
  shiftId?: string | null;
  tripId?: string | null;
  notes: string;
}

export interface BatchAutoMatchSummary {
  processedCount: number;
  matchedToDriverCount: number;
  assignedToCompanyCount: number;
  unmatchedCount: number;
  totalDriverRecoverableAed: number;
  totalCompanyLiabilityAed: number;
  matches: FineMatchResult[];
}

export interface MatchOptions {
  confidenceThreshold?: number; // Minimum confidence to auto-assign (e.g. 75%)
  dryRun?: boolean;
}

// Offenses that are solely the legal responsibility of the company/vehicle owner
const COMPANY_LIABILITY_OFFENCES = new Set([
  'EXPIRED_REGISTRATION',
  'EXPIRED_MULKIYA',
  'EXPIRED_INSURANCE',
  'WINDOW_TINT_OVER_LEGAL_LIMIT',
  'COMMERCIAL_PERMIT_DEFECT',
  'VEHICLE_TESTING_DEFECT',
  'BALD_TIRES_DEFECT',
  'VEHICLE_EMISSION_DEFECT',
]);

/**
 * Pure function: Classifies offense type liability (Driver action vs Company compliance defect).
 */
export function classifyOffenceLiability(offenceType?: string | null): 'DRIVER' | 'COMPANY' {
  if (!offenceType) return 'DRIVER'; // Default driving violations to driver

  const norm = offenceType.toUpperCase().trim().replace(/[\s-]+/g, '_');
  for (const compOffence of COMPANY_LIABILITY_OFFENCES) {
    if (norm.includes(compOffence)) {
      return 'COMPANY';
    }
  }
  return 'DRIVER';
}

/**
 * Evaluates and matches a single fine against driver shifts and trips.
 */
export function matchFineWithShiftRecords(
  fine: {
    id: string;
    vehicleId: string;
    fineDate: Date | string;
    fineAmount: number;
    offenceType?: string | null;
    authority?: string | null;
  },
  shifts: Array<{
    id: string;
    driverId: string;
    driverName?: string | null;
    vehicleId: string | null;
    shiftDate: Date | string;
    startTime: Date | string;
    endTime: Date | string | null;
  }>,
  trips: Array<{
    id: string;
    driverId: string;
    driverName?: string | null;
    vehicleId: string | null;
    startTime: Date | string;
    endTime: Date | string | null;
  }> = []
): FineMatchResult {
  const fineTime = new Date(fine.fineDate).getTime();
  const liabilityType = classifyOffenceLiability(fine.offenceType);

  // 1. If it's a vehicle equipment/compliance defect, assign directly to company
  if (liabilityType === 'COMPANY') {
    return {
      fineId: fine.id,
      vehicleId: fine.vehicleId,
      driverId: null,
      driverName: null,
      fineAmount: fine.fineAmount,
      fineDate: new Date(fine.fineDate),
      offenceType: fine.offenceType,
      authority: fine.authority,
      assignedTo: 'COMPANY',
      matchConfidence: 100,
      matchSource: 'COMPANY_DEFECT_OFFENCE',
      notes: `Assigned to Company: Offence '${fine.offenceType || 'Vehicle Defect'}' is a vehicle compliance defect.`,
    };
  }

  // 2. Exact Shift Matching: Look for a driver shift active during the fine timestamp
  const matchingShifts = shifts.filter((s) => {
    if (s.vehicleId !== fine.vehicleId) return false;
    const start = new Date(s.startTime).getTime();
    // If shift has no endTime, assume up to 10 hours standard shift window
    const end = s.endTime ? new Date(s.endTime).getTime() : start + 10 * 60 * 60 * 1000;
    return fineTime >= start && fineTime <= end;
  });

  if (matchingShifts.length === 1) {
    const s = matchingShifts[0];
    return {
      fineId: fine.id,
      vehicleId: fine.vehicleId,
      driverId: s.driverId,
      driverName: s.driverName || 'Driver',
      fineAmount: fine.fineAmount,
      fineDate: new Date(fine.fineDate),
      offenceType: fine.offenceType,
      authority: fine.authority,
      assignedTo: 'DRIVER',
      matchConfidence: 95,
      matchSource: 'EXACT_SHIFT_TIMESTAMP',
      shiftId: s.id,
      notes: `Matched to Driver Shift #${s.id.slice(0, 8)} active at ${new Date(fine.fineDate).toLocaleTimeString()}`,
    };
  }

  // 3. Trip Manifest Matching: Look for active route/dispatch trip
  const matchingTrips = trips.filter((t) => {
    if (t.vehicleId !== fine.vehicleId) return false;
    const start = new Date(t.startTime).getTime();
    const end = t.endTime ? new Date(t.endTime).getTime() : start + 4 * 60 * 60 * 1000;
    return fineTime >= start && fineTime <= end;
  });

  if (matchingTrips.length === 1) {
    const t = matchingTrips[0];
    return {
      fineId: fine.id,
      vehicleId: fine.vehicleId,
      driverId: t.driverId,
      driverName: t.driverName || 'Driver',
      fineAmount: fine.fineAmount,
      fineDate: new Date(fine.fineDate),
      offenceType: fine.offenceType,
      authority: fine.authority,
      assignedTo: 'DRIVER',
      matchConfidence: 90,
      matchSource: 'TRIP_MANIFEST',
      tripId: t.id,
      notes: `Matched to Active Trip #${t.id.slice(0, 8)} on manifest`,
    };
  }

  // 4. Daily Exclusive Shift Matching: Check if only 1 driver was assigned to this vehicle that calendar day
  const fineDayStr = new Date(fine.fineDate).toISOString().slice(0, 10);
  const sameDayShifts = shifts.filter((s) => {
    if (s.vehicleId !== fine.vehicleId) return false;
    const sDay = new Date(s.shiftDate || s.startTime).toISOString().slice(0, 10);
    return sDay === fineDayStr;
  });

  const uniqueDrivers = Array.from(new Set(sameDayShifts.map((s) => s.driverId)));
  if (uniqueDrivers.length === 1) {
    const s = sameDayShifts[0];
    return {
      fineId: fine.id,
      vehicleId: fine.vehicleId,
      driverId: s.driverId,
      driverName: s.driverName || 'Driver',
      fineAmount: fine.fineAmount,
      fineDate: new Date(fine.fineDate),
      offenceType: fine.offenceType,
      authority: fine.authority,
      assignedTo: 'DRIVER',
      matchConfidence: 80,
      matchSource: 'DAILY_SHIFT_EXCLUSIVE',
      shiftId: s.id,
      notes: `Matched to Driver on exclusive vehicle duty on ${fineDayStr}`,
    };
  }

  // 5. Unmatched / Ambiguous
  return {
    fineId: fine.id,
    vehicleId: fine.vehicleId,
    driverId: null,
    driverName: null,
    fineAmount: fine.fineAmount,
    fineDate: new Date(fine.fineDate),
    offenceType: fine.offenceType,
    authority: fine.authority,
    assignedTo: 'COMPANY',
    matchConfidence: 0,
    matchSource: 'UNMATCHED',
    notes:
      sameDayShifts.length > 1
        ? `Ambiguous: Multiple drivers (${sameDayShifts.length}) assigned on vehicle during date`
        : 'Unmatched: No driver shift or active trip recorded for this vehicle timestamp',
  };
}

/**
 * Sweeps all unassigned/unpaid fines in the tenant and matches them against driver shifts.
 */
export async function batchAutoMatchTenantFines(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  options: MatchOptions = {}
): Promise<BatchAutoMatchSummary> {
  const threshold = options.confidenceThreshold ?? 75;
  const isDryRun = options.dryRun ?? false;

  // 1. Fetch unassigned or unpaid traffic fines
  const fines = await tx.trafficFine.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: 'UNPAID',
    },
    select: {
      id: true,
      vehicleId: true,
      driverId: true,
      fineDate: true,
      fineAmount: true,
      offenceType: true,
      authority: true,
      assignedTo: true,
    },
  });

  if (!fines.length) {
    return {
      processedCount: 0,
      matchedToDriverCount: 0,
      assignedToCompanyCount: 0,
      unmatchedCount: 0,
      totalDriverRecoverableAed: 0,
      totalCompanyLiabilityAed: 0,
      matches: [],
    };
  }

  // 2. Fetch driver shifts for this tenant
  const shifts = await tx.driverShift.findMany({
    where: {
      tenantId,
      vehicleId: { not: null },
    },
    select: {
      id: true,
      driverId: true,
      vehicleId: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
    },
  });

  const matches: FineMatchResult[] = [];
  let matchedToDriverCount = 0;
  let assignedToCompanyCount = 0;
  let unmatchedCount = 0;
  let totalDriverRecoverableAed = 0;
  let totalCompanyLiabilityAed = 0;

  for (const fine of fines) {
    if (!fine.vehicleId) {
      unmatchedCount++;
      continue;
    }

    const match = matchFineWithShiftRecords(
      {
        id: fine.id,
        vehicleId: fine.vehicleId,
        fineDate: fine.fineDate,
        fineAmount: fine.fineAmount,
        offenceType: fine.offenceType,
        authority: fine.authority,
      },
      shifts
    );

    matches.push(match);

    if (match.assignedTo === 'DRIVER' && match.matchConfidence >= threshold && match.driverId) {
      matchedToDriverCount++;
      totalDriverRecoverableAed += match.fineAmount;

      if (!isDryRun) {
        await tx.trafficFine.update({
          where: { id: fine.id },
          data: {
            driverId: match.driverId,
            assignedTo: 'DRIVER',
          },
        });
      }
    } else if (match.matchSource === 'COMPANY_DEFECT_OFFENCE') {
      assignedToCompanyCount++;
      totalCompanyLiabilityAed += match.fineAmount;

      if (!isDryRun) {
        await tx.trafficFine.update({
          where: { id: fine.id },
          data: {
            assignedTo: 'COMPANY',
          },
        });
      }
    } else {
      unmatchedCount++;
      totalCompanyLiabilityAed += match.fineAmount;
    }
  }

  return {
    processedCount: fines.length,
    matchedToDriverCount,
    assignedToCompanyCount,
    unmatchedCount,
    totalDriverRecoverableAed,
    totalCompanyLiabilityAed,
    matches,
  };
}
