/**
 * src/lib/fleet/fine-toll-matcher.ts
 *
 * Traffic Fine & Toll (Salik/Darb) Auto-Matcher Engine.
 * Cross-references violation timestamps against active DriverShifts, trip manifests,
 * and self-drive RAC RentalAgreements to assign liability across fleet drivers,
 * self-drive rental customers, and company compliance defects.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import type { TxClient } from '@/lib/rls';
import { withSavepoint } from '@/lib/rental/locks';

export type FineLiabilityCategory =
  | 'DRIVER'
  | 'RENTAL_CUSTOMER'
  | 'COMPANY'
  | 'SPLIT'
  | 'UNASSIGNED';

export type MatchSource =
  | 'EXACT_SHIFT_TIMESTAMP'
  | 'TRIP_MANIFEST'
  | 'DAILY_SHIFT_EXCLUSIVE'
  | 'RENTAL_AGREEMENT'
  | 'COMPANY_DEFECT_OFFENCE'
  | 'UNMATCHED';

export type MatchConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface FineMatchResult {
  fineId: string;
  vehicleId: string;
  driverId: string | null;
  driverName?: string | null;
  fineAmount: number;
  fineDate: Date;
  offenceType?: string | null;
  authority?: string | null;
  assignedTo: 'DRIVER' | 'COMPANY' | 'RENTAL_CUSTOMER';
  matchConfidence: number; // 0 - 100%
  confidence?: MatchConfidenceBand;
  matchSource: MatchSource;
  shiftId?: string | null;
  tripId?: string | null;
  rentalAgreementId?: string | null;
  agreementNo?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  notes: string;
}

export interface BatchAutoMatchSummary {
  processedCount: number;
  matchedToDriverCount: number;
  matchedToRentalCustomerCount: number;
  assignedToCompanyCount: number;
  unmatchedCount: number;
  totalDriverRecoverableAed: number;
  totalRentalCustomerRecoverableAed: number;
  totalCompanyLiabilityAed: number;
  matches: FineMatchResult[];
}

export interface MatchOptions {
  confidenceThreshold?: number; // Minimum confidence to auto-assign (e.g. 75%)
  dryRun?: boolean;
}

export interface RentalAgreementCandidate {
  id: string;
  agreementNo?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  vehicleId: string | null;
  startDate: Date | string;
  endDate: Date | string;
  actualReturnDate?: Date | string | null;
  status?: string | null;
}

export interface MatchFineOrTollInput {
  id?: string;
  fineId?: string;
  tenantId: string;
  vehicleId: string;
  fineDate?: Date | string;
  occurredAt?: Date | string;
  fineAmount?: number;
  amount?: number;
  offenceType?: string | null;
  authority?: string | null;
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
 * Pure function: Classifies offense type liability (Driver/Customer action vs Company compliance defect).
 */
export function classifyOffenceLiability(offenceType?: string | null): 'DRIVER' | 'COMPANY' {
  if (!offenceType) return 'DRIVER'; // Default driving violations to driver/operator

  const norm = offenceType.toUpperCase().trim().replace(/[\s-]+/g, '_');
  for (const compOffence of COMPANY_LIABILITY_OFFENCES) {
    if (norm.includes(compOffence)) {
      return 'COMPANY';
    }
  }
  return 'DRIVER';
}

/**
 * Evaluates and matches a single fine against driver shifts, trips, and (optionally)
 * pre-loaded self-drive rental agreements.
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
  }> = [],
  rentalAgreements: RentalAgreementCandidate[] = [],
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
      confidence: 'HIGH',
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
      confidence: 'HIGH',
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
      confidence: 'HIGH',
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
      confidence: 'MEDIUM',
      matchSource: 'DAILY_SHIFT_EXCLUSIVE',
      shiftId: s.id,
      notes: `Matched to Driver on exclusive vehicle duty on ${fineDayStr}`,
    };
  }

  // 5. Self-Drive RAC Rental Agreement Matching (when no driver shift matched)
  if (sameDayShifts.length === 0 && rentalAgreements.length > 0) {
    const matchingAgreements = rentalAgreements.filter((ra) => {
      if (ra.vehicleId !== fine.vehicleId) return false;
      if (ra.status) {
        const st = ra.status.toUpperCase();
        if (!['ACTIVE', 'COMPLETED', 'CLOSED'].includes(st)) return false;
      }
      const start = new Date(ra.startDate).getTime();
      const effectiveEndRaw = ra.actualReturnDate ?? ra.endDate;
      const end = new Date(effectiveEndRaw).getTime();
      return fineTime >= start && fineTime <= end;
    });

    if (matchingAgreements.length > 0) {
      const agr = matchingAgreements[0];
      return {
        fineId: fine.id,
        vehicleId: fine.vehicleId,
        driverId: null,
        driverName: null,
        fineAmount: fine.fineAmount,
        fineDate: new Date(fine.fineDate),
        offenceType: fine.offenceType,
        authority: fine.authority,
        assignedTo: 'RENTAL_CUSTOMER',
        rentalAgreementId: agr.id,
        agreementNo: agr.agreementNo ?? null,
        customerId: agr.customerId ?? null,
        customerName: agr.customerName ?? null,
        confidence: 'HIGH',
        matchConfidence: 95,
        matchSource: 'RENTAL_AGREEMENT',
        notes: `Matched to self-drive Rental Agreement ${agr.agreementNo || agr.id.slice(0, 8)}`,
      };
    }
  }

  // 6. Unmatched / Ambiguous
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
    confidence: 'NONE',
    matchSource: 'UNMATCHED',
    notes:
      sameDayShifts.length > 1
        ? `Ambiguous: Multiple drivers (${sameDayShifts.length}) assigned on vehicle during date`
        : 'Unmatched: No driver shift or active rental agreement recorded for this vehicle timestamp',
  };
}

export interface MatchedRentalAgreementRow {
  id: string;
  agreement_no: string | null;
  customer_id: string | null;
  matched_via_swap?: boolean;
}

export async function findMatchingRentalAgreement(
  tx: Prisma.TransactionClient | PrismaClient | TxClient,
  tenantId: string,
  vehicleId: string,
  fineDate: Date | string,
): Promise<MatchedRentalAgreementRow | null> {
  return findMatchingRentalAgreementInDb(tx, tenantId, vehicleId, fineDate);
}

async function findMatchingRentalAgreementInDb(
  tx: Prisma.TransactionClient | PrismaClient | TxClient,
  tenantId: string,
  vehicleId: string,
  fineDate: Date | string,
): Promise<MatchedRentalAgreementRow | null> {
  const eventIso = new Date(fineDate).toISOString();
  const rawCapable = tx as unknown as {
    $queryRawUnsafe?: <T>(sql: string, ...params: unknown[]) => Promise<T>;
  };

  if (typeof rawCapable.$queryRawUnsafe === 'function') {
    // 1. Multi-segment swap-aware match: handles agreements with 0, 1, or N mid-rental swaps
    //    (`from_vehicle_id` during `[prev_exchange_or_start, exchange_date]` and
    //     `to_vehicle_id` during `[exchange_date, next_exchange_or_return]`).
    const swapAwareRows = await withSavepoint<MatchedRentalAgreementRow[] | null>(
      tx as unknown as TxClient,
      'fine_match_rac_agr_segments',
      () =>
        rawCapable.$queryRawUnsafe!<MatchedRentalAgreementRow[]>(
          `WITH agr_exchanges AS (
             SELECT rve.agreement_id,
                    rve.from_vehicle_id,
                    rve.to_vehicle_id,
                    rve.exchange_date,
                    LAG(rve.exchange_date) OVER (
                      PARTITION BY rve.agreement_id
                      ORDER BY rve.exchange_date ASC, rve.created_at ASC
                    ) AS prev_exchange_date,
                    LEAD(rve.exchange_date) OVER (
                      PARTITION BY rve.agreement_id
                      ORDER BY rve.exchange_date ASC, rve.created_at ASC
                    ) AS next_exchange_date
               FROM rental_vehicle_exchanges rve
              WHERE rve.tenant_id::text = $1
           )
           SELECT ra.id::text AS id,
                  ra.agreement_no,
                  ra.customer_id,
                  EXISTS (
                    SELECT 1 FROM agr_exchanges ae WHERE ae.agreement_id = ra.id
                  ) AS matched_via_swap
             FROM rental_agreements ra
            WHERE ra.tenant_id::text = $1
              AND ra.deleted_at IS NULL
              AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
              AND (
                (
                  NOT EXISTS (SELECT 1 FROM agr_exchanges ae0 WHERE ae0.agreement_id = ra.id)
                  AND ra.vehicle_id = $2
                  AND $3::timestamptz >= ra.start_date
                  AND $3::timestamptz <= COALESCE(ra.actual_return_date, ra.end_date)
                )
                OR EXISTS (
                  SELECT 1
                    FROM agr_exchanges ae1
                   WHERE ae1.agreement_id = ra.id
                     AND ae1.from_vehicle_id = $2
                     AND $3::timestamptz >= COALESCE(ae1.prev_exchange_date, ra.start_date)
                     AND $3::timestamptz <= ae1.exchange_date
                )
                OR EXISTS (
                  SELECT 1
                    FROM agr_exchanges ae2
                   WHERE ae2.agreement_id = ra.id
                     AND ae2.to_vehicle_id = $2
                     AND $3::timestamptz >= ae2.exchange_date
                     AND $3::timestamptz <= COALESCE(
                       ae2.next_exchange_date,
                       ra.actual_return_date,
                       ra.end_date
                     )
                )
              )
            ORDER BY ra.start_date DESC
            LIMIT 1`,
          tenantId,
          vehicleId,
          eventIso,
        ),
      null,
    );

    if (swapAwareRows !== null) {
      return swapAwareRows[0] ?? null;
    }

    // 2. Fallback when `rental_vehicle_exchanges` is unavailable in environment
    const primaryRows = await withSavepoint<MatchedRentalAgreementRow[] | null>(
      tx as unknown as TxClient,
      'fine_match_rac_agr',
      () =>
        rawCapable.$queryRawUnsafe!<MatchedRentalAgreementRow[]>(
          `SELECT ra.id::text AS id,
                  ra.agreement_no,
                  ra.customer_id
             FROM rental_agreements ra
            WHERE ra.tenant_id::text = $1
              AND ra.vehicle_id = $2
              AND ra.deleted_at IS NULL
              AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
              AND $3::timestamptz >= ra.start_date
              AND $3::timestamptz <= COALESCE(ra.actual_return_date, ra.end_date)
            ORDER BY ra.start_date DESC
            LIMIT 1`,
          tenantId,
          vehicleId,
          eventIso,
        ),
      null,
    );

    if (primaryRows !== null) {
      return primaryRows[0] ?? null;
    }

    const fallbackRows = await withSavepoint<MatchedRentalAgreementRow[]>(
      tx as unknown as TxClient,
      'fine_match_rac_agr_legacy',
      () =>
        rawCapable.$queryRawUnsafe!<MatchedRentalAgreementRow[]>(
          `SELECT ra.id::text AS id,
                  ra.agreement_no,
                  ra.customer_id
             FROM rental_agreements ra
            WHERE ra.tenant_id::text = $1
              AND ra.vehicle_id = $2
              AND ra.deleted_at IS NULL
              AND UPPER(COALESCE(ra.status, '')) IN ('ACTIVE', 'COMPLETED', 'CLOSED')
              AND $3::timestamptz >= ra.start_date
              AND $3::timestamptz <= ra.end_date
            ORDER BY ra.start_date DESC
            LIMIT 1`,
          tenantId,
          vehicleId,
          eventIso,
        ),
      [],
    );

    return fallbackRows[0] ?? null;
  }

  // Fallback for mocked Prisma TransactionClients that expose `rentalAgreement.findFirst` without `$queryRawUnsafe`
  const modelCapable = tx as unknown as {
    rentalAgreement?: {
      findFirst?: (args: Record<string, unknown>) => Promise<{
        id: string;
        agreementNo?: string | null;
        customerId?: string | null;
      } | null>;
    };
  };
  if (typeof modelCapable.rentalAgreement?.findFirst === 'function') {
    const eventDt = new Date(fineDate);
    const found = await modelCapable.rentalAgreement.findFirst({
      where: {
        tenantId,
        vehicleId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'COMPLETED', 'CLOSED'] },
        startDate: { lte: eventDt },
        endDate: { gte: eventDt },
      },
      orderBy: { startDate: 'desc' },
    });
    if (found) {
      return {
        id: found.id,
        agreement_no: found.agreementNo ?? null,
        customer_id: found.customerId ?? null,
      };
    }
  }

  return null;
}

/**
 * Matches a single traffic fine or toll timestamp against `DriverShift` first (for
 * chauffeur/bus/logistics shifts), and if no driver shift matched, against self-drive
 * `rental_agreements` (`[start_date, COALESCE(actual_return_date, end_date)]`).
 */
export async function matchFineOrToll(
  tx: Prisma.TransactionClient | PrismaClient | TxClient,
  input: MatchFineOrTollInput,
): Promise<FineMatchResult> {
  const eventDate = new Date(input.fineDate ?? input.occurredAt ?? new Date());
  const fineId = input.fineId ?? input.id ?? '';
  const fineAmount = Number(input.fineAmount ?? input.amount ?? 0);

  let shifts: Array<{
    id: string;
    driverId: string;
    vehicleId: string | null;
    shiftDate: Date | string;
    startTime: Date | string;
    endTime: Date | string | null;
  }> = [];

  const shiftCapable = tx as unknown as {
    driverShift?: {
      findMany?: (args: Record<string, unknown>) => Promise<typeof shifts>;
    };
  };
  if (typeof shiftCapable.driverShift?.findMany === 'function') {
    shifts = await shiftCapable.driverShift.findMany({
      where: {
        tenantId: input.tenantId,
        vehicleId: input.vehicleId,
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
  }

  const shiftMatch = matchFineWithShiftRecords(
    {
      id: fineId,
      vehicleId: input.vehicleId,
      fineDate: eventDate,
      fineAmount,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
    },
    shifts,
  );

  if (shiftMatch.matchSource !== 'UNMATCHED') {
    return shiftMatch;
  }

  const agr = await findMatchingRentalAgreementInDb(
    tx,
    input.tenantId,
    input.vehicleId,
    eventDate,
  );
  if (agr) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: null,
      driverName: null,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: 'RENTAL_CUSTOMER',
      rentalAgreementId: agr.id,
      agreementNo: agr.agreement_no,
      customerId: agr.customer_id,
      confidence: 'HIGH',
      matchConfidence: 95,
      matchSource: 'RENTAL_AGREEMENT',
      notes: `Matched to self-drive Rental Agreement ${agr.agreement_no || agr.id.slice(0, 8)}`,
    };
  }

  return shiftMatch;
}

/**
 * Sweeps all unassigned/unpaid fines in the tenant and matches them against driver shifts
 * and self-drive RAC rental agreements.
 */
export async function batchAutoMatchTenantFines(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  options: MatchOptions = {},
): Promise<BatchAutoMatchSummary> {
  const threshold = options.confidenceThreshold ?? 75;
  const isDryRun = options.dryRun ?? false;

  // 1. Fetch unassigned or unpaid traffic fines
  const fines = await tx.trafficFine.findMany({
    where: {
      tenantId,
      // TrafficFine has no soft-delete (deletedAt) column in the schema.
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
      matchedToRentalCustomerCount: 0,
      assignedToCompanyCount: 0,
      unmatchedCount: 0,
      totalDriverRecoverableAed: 0,
      totalRentalCustomerRecoverableAed: 0,
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
  let matchedToRentalCustomerCount = 0;
  let assignedToCompanyCount = 0;
  let unmatchedCount = 0;
  let totalDriverRecoverableAed = 0;
  let totalRentalCustomerRecoverableAed = 0;
  let totalCompanyLiabilityAed = 0;

  for (const fine of fines) {
    if (!fine.vehicleId) {
      unmatchedCount++;
      continue;
    }

    let match = matchFineWithShiftRecords(
      {
        id: fine.id,
        vehicleId: fine.vehicleId,
        fineDate: fine.fineDate,
        fineAmount: fine.fineAmount,
        offenceType: fine.offenceType,
        authority: fine.authority,
      },
      shifts,
    );

    // If no DriverShift matched, check active/completed/closed self-drive RAC RentalAgreements
    if (match.matchSource === 'UNMATCHED') {
      const agr = await findMatchingRentalAgreementInDb(
        tx,
        tenantId,
        fine.vehicleId,
        fine.fineDate,
      );
      if (agr) {
        match = {
          fineId: fine.id,
          vehicleId: fine.vehicleId,
          driverId: null,
          driverName: null,
          fineAmount: fine.fineAmount,
          fineDate: new Date(fine.fineDate),
          offenceType: fine.offenceType,
          authority: fine.authority,
          assignedTo: 'RENTAL_CUSTOMER',
          rentalAgreementId: agr.id,
          agreementNo: agr.agreement_no,
          customerId: agr.customer_id,
          confidence: 'HIGH',
          matchConfidence: 95,
          matchSource: 'RENTAL_AGREEMENT',
          notes: `Matched to self-drive Rental Agreement ${agr.agreement_no || agr.id.slice(0, 8)}`,
        };
      }
    }

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
    } else if (
      match.assignedTo === 'RENTAL_CUSTOMER' &&
      match.matchConfidence >= threshold &&
      match.rentalAgreementId
    ) {
      matchedToRentalCustomerCount++;
      totalRentalCustomerRecoverableAed += match.fineAmount;

      if (!isDryRun) {
        let updatedViaRawSql = false;
        const rawExec = tx as unknown as {
          $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<unknown>;
        };
        if (typeof rawExec.$executeRawUnsafe === 'function') {
          updatedViaRawSql = await withSavepoint(
            tx as unknown as TxClient,
            'fine_update_rac_agr',
            async () => {
              await rawExec.$executeRawUnsafe!(
                `UPDATE traffic_fines
                    SET assigned_to = 'RENTAL_CUSTOMER',
                        rental_agreement_id = $1
                  WHERE id = $2
                    AND tenant_id = $3`,
                match.rentalAgreementId,
                fine.id,
                tenantId,
              );
              return true;
            },
            false,
          );
        }
        if (!updatedViaRawSql) {
          await tx.trafficFine.update({
            where: { id: fine.id },
            data: {
              assignedTo: 'RENTAL_CUSTOMER',
            },
          });
        }
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
    matchedToRentalCustomerCount,
    assignedToCompanyCount,
    unmatchedCount,
    totalDriverRecoverableAed,
    totalRentalCustomerRecoverableAed,
    totalCompanyLiabilityAed,
    matches,
  };
}
