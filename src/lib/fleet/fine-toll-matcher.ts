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
import { postOperationalJournalEntry } from '@/lib/finance/journal-service';

export type FineLiabilityCategory =
  | 'DRIVER'
  | 'RENTAL_CUSTOMER'
  | 'LEASING_CUSTOMER'
  | 'LOGISTICS_CARRIER'
  | 'COMPANY'
  | 'SPLIT'
  | 'UNASSIGNED';

export type MatchSource =
  | 'EXACT_SHIFT_TIMESTAMP'
  | 'TRIP_MANIFEST'
  | 'DAILY_SHIFT_EXCLUSIVE'
  | 'RENTAL_AGREEMENT'
  | 'LEASING_CONTRACT'
  | 'LOGISTICS_SHIPMENT'
  | 'BUS_OPS_TRIP'
  | 'SCHOOL_BUS_TRIP'
  | 'DISPATCH_JOB'
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
  assignedTo: 'DRIVER' | 'COMPANY' | 'RENTAL_CUSTOMER' | 'LEASING_CUSTOMER' | 'LOGISTICS_CARRIER';
  matchConfidence: number; // 0 - 100%
  confidence?: MatchConfidenceBand;
  matchSource: MatchSource;
  shiftId?: string | null;
  tripId?: string | null;
  rentalAgreementId?: string | null;
  leaseContractId?: string | null;
  shipmentId?: string | null;
  dispatchJobId?: string | null;
  agreementNo?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  rechargeTarget?: 'DRIVER' | 'CUSTOMER' | 'CARRIER' | 'COMPANY';
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

// 1. Match Drayage / Logistics (logistics_shipment_orders)
async function findMatchingLogisticsShipment(
  tx: any,
  tenantId: string,
  vehicleId: string,
  eventDate: Date,
): Promise<{ id: string; shipmentNo: string | null; driverId: string | null; customerId: string | null } | null> {
  try {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id::text, shipment_no, assigned_driver_id::text, cargo_owner_customer_id::text
       FROM logistics_shipment_orders
       WHERE tenant_id = $1
         AND assigned_vehicle_id = $2
         AND (
           ($3 >= COALESCE(pickup_window_from, created_at - INTERVAL '2 hours')
            AND $3 <= COALESCE(delivery_window_to, pickup_window_from + INTERVAL '12 hours', created_at + INTERVAL '24 hours'))
           OR DATE(created_at) = DATE($3)
         )
         AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      tenantId,
      vehicleId,
      eventDate,
    );
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        shipmentNo: rows[0].shipment_no,
        driverId: rows[0].assigned_driver_id,
        customerId: rows[0].cargo_owner_customer_id,
      };
    }
  } catch {
    /* table or column not found */
  }
  return null;
}

// 2. Match Bus-Ops trip_schedules
async function findMatchingBusOpsTrip(
  tx: any,
  tenantId: string,
  vehicleId: string,
  eventDate: Date,
): Promise<{ id: string; scheduleNumber: string | null; driverId: string | null } | null> {
  try {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id::text, schedule_number, driver_id::text
       FROM trip_schedules
       WHERE tenant_id = $1
         AND vehicle_id = $2
         AND (
           ($3 >= COALESCE(departure_time, scheduled_time - INTERVAL '1 hour', created_at - INTERVAL '2 hours')
            AND $3 <= COALESCE(arrival_time, departure_time + INTERVAL '4 hours', scheduled_time + INTERVAL '6 hours'))
           OR DATE(scheduled_date) = DATE($3)
         )
         AND deleted_at IS NULL
       ORDER BY scheduled_date DESC
       LIMIT 1`,
      tenantId,
      vehicleId,
      eventDate,
    );
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        scheduleNumber: rows[0].schedule_number,
        driverId: rows[0].driver_id,
      };
    }
  } catch {
    /* table or column not found */
  }
  return null;
}

// 3. Match School-Bus trips (school_bus_trips)
async function findMatchingSchoolBusTrip(
  tx: any,
  tenantId: string,
  vehicleId: string,
  eventDate: Date,
): Promise<{ id: string; tripName: string | null; driverId: string | null; driverName: string | null } | null> {
  try {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id::text, route_name, driver_id::text, driver_name
       FROM school_bus_trips
       WHERE tenant_id = $1
         AND vehicle_id = $2
         AND (
           ($3 >= COALESCE(started_at, scheduled_date - INTERVAL '2 hours')
            AND $3 <= COALESCE(completed_at, started_at + INTERVAL '4 hours', scheduled_date + INTERVAL '12 hours'))
           OR DATE(scheduled_date) = DATE($3)
         )
       ORDER BY scheduled_date DESC
       LIMIT 1`,
      tenantId,
      vehicleId,
      eventDate,
    );
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        tripName: rows[0].route_name,
        driverId: rows[0].driver_id,
        driverName: rows[0].driver_name,
      };
    }
  } catch {
    /* table or column not found */
  }
  return null;
}

// 4. Match Dispatch jobs (dispatch_jobs)
async function findMatchingDispatchJob(
  tx: any,
  tenantId: string,
  vehicleId: string,
  eventDate: Date,
): Promise<{ id: string; jobNumber: string | null; driverId: string | null; customerId: string | null } | null> {
  try {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id::text, job_number, driver_id::text, customer_id::text
       FROM dispatch_jobs
       WHERE tenant_id = $1
         AND vehicle_id = $2
         AND (
           ($3 >= COALESCE(pickup_window_start, created_at - INTERVAL '2 hours')
            AND $3 <= COALESCE(delivery_window_end, pickup_window_start + INTERVAL '8 hours', created_at + INTERVAL '12 hours'))
           OR DATE(created_at) = DATE($3)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      tenantId,
      vehicleId,
      eventDate,
    );
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        jobNumber: rows[0].job_number,
        driverId: rows[0].driver_id,
        customerId: rows[0].customer_id,
      };
    }
  } catch {
    /* table or column not found */
  }
  return null;
}

// 5. Match Corporate Leasing contract (lease_contracts_v2)
async function findMatchingLeaseContract(
  tx: any,
  tenantId: string,
  vehicleId: string,
  eventDate: Date,
): Promise<{ id: string; contractNo: string | null; customerId: string | null } | null> {
  try {
    const rows = await tx.$queryRawUnsafe(
      `SELECT c.id::text, c.contract_number, c.customer_id::text
       FROM lease_contracts_v2 c
       JOIN lease_vehicle_assignments a ON a.contract_id = c.id
       WHERE c.tenant_id = $1
         AND a.vehicle_id = $2
         AND a.start_date <= $3
         AND (a.end_date >= $3 OR a.end_date IS NULL)
       LIMIT 1`,
      tenantId,
      vehicleId,
      eventDate,
    );
    if (rows && rows.length > 0) {
      return {
        id: rows[0].id,
        contractNo: rows[0].contract_number,
        customerId: rows[0].customer_id,
      };
    }
  } catch {
    try {
      const rows = await tx.$queryRawUnsafe(
        `SELECT id::text, agreement_no, customer_id::text
         FROM lease_agreements
         WHERE tenant_id = $1
           AND vehicle_id = $2
           AND start_date <= $3
           AND (end_date >= $3 OR end_date IS NULL)
         LIMIT 1`,
        tenantId,
        vehicleId,
        eventDate,
      );
      if (rows && rows.length > 0) {
        return {
          id: rows[0].id,
          contractNo: rows[0].agreement_no,
          customerId: rows[0].customer_id,
        };
      }
    } catch {}
  }
  return null;
}

/**
 * Posts General Ledger lines for matched traffic fine:
 * Uses 2160 Fine Recharge Clearing, AR (1100), and AP (2000).
 */
export async function postFineMatchedGlEntry(
  tx: any,
  tenantId: string,
  fine: { id: string; fineAmount: number; fineDate?: Date | string; offenceType?: string | null; authority?: string | null },
  match: FineMatchResult,
): Promise<{ id: string; number: string; created: boolean } | null> {
  if (!fine.fineAmount || fine.fineAmount <= 0) return null;

  const authority = fine.authority || 'Police Authority';
  const entryDate = (fine.fineDate ? new Date(fine.fineDate) : new Date()).toISOString().slice(0, 10);
  const isRecoverable = match.assignedTo === 'DRIVER' || match.assignedTo === 'RENTAL_CUSTOMER' || match.assignedTo === 'LEASING_CUSTOMER' || match.assignedTo === 'LOGISTICS_CARRIER';

  const lines = isRecoverable
    ? [
        {
          code: '1100',
          name: 'Trade Receivables - Fine Recharge',
          description: `Fine recharge receivable for fine ${fine.id.slice(0, 8)} (${match.assignedTo})`,
          debit: fine.fineAmount,
          credit: 0,
        },
        {
          code: '2160',
          name: 'Traffic Fines & Tolls Clearing',
          description: `Fine recharge clearing for fine ${fine.id.slice(0, 8)}`,
          debit: 0,
          credit: fine.fineAmount,
        },
        {
          code: '2160',
          name: 'Traffic Fines & Tolls Clearing',
          description: `Statutory fine payable clearing for fine ${fine.id.slice(0, 8)}`,
          debit: fine.fineAmount,
          credit: 0,
        },
        {
          code: '2000',
          name: 'Accounts Payable - Fines Authority',
          description: `Payable to ${authority} for fine ${fine.id.slice(0, 8)}`,
          debit: 0,
          credit: fine.fineAmount,
        },
      ]
    : [
        {
          code: '5170',
          name: 'Operating Expenses - Traffic Fines',
          description: `Company fine liability for fine ${fine.id.slice(0, 8)}`,
          debit: fine.fineAmount,
          credit: 0,
        },
        {
          code: '2000',
          name: 'Accounts Payable - Fines Authority',
          description: `Payable to ${authority} for fine ${fine.id.slice(0, 8)}`,
          debit: 0,
          credit: fine.fineAmount,
        },
      ];

  return await postOperationalJournalEntry(tx as any, {
    tenantId,
    entryDate,
    narration: `Traffic Fine ${fine.id.slice(0, 8)}: ${fine.offenceType || 'Violation'} matched to ${match.assignedTo}`,
    reference: `FINE-${fine.id.slice(0, 8).toUpperCase()}`,
    sourceType: 'TRAFFIC_FINE',
    sourceId: fine.id,
    currency: 'AED',
    lines,
  }).catch((err) => {
    console.warn('[fine-toll-matcher] GL posting warning:', err);
    return null;
  });
}

/**
 * Matches a single traffic fine or toll timestamp across DriverShift, self-drive
 * RAC rental agreements, corporate leasing contracts, drayage/logistics shipments,
 * bus ops trips, school bus trips, and dispatch jobs.
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

  // 1. Rental Agreement match
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
      rechargeTarget: 'CUSTOMER',
      notes: `Matched to self-drive Rental Agreement ${agr.agreement_no || agr.id.slice(0, 8)}`,
    };
  }

  // 2. Corporate Leasing Contract match
  const lease = await findMatchingLeaseContract(tx, input.tenantId, input.vehicleId, eventDate);
  if (lease) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: null,
      driverName: null,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: 'LEASING_CUSTOMER',
      leaseContractId: lease.id,
      agreementNo: lease.contractNo,
      customerId: lease.customerId,
      confidence: 'HIGH',
      matchConfidence: 90,
      matchSource: 'LEASING_CONTRACT',
      rechargeTarget: 'CUSTOMER',
      notes: `Matched to Corporate Lease Contract ${lease.contractNo || lease.id.slice(0, 8)}`,
    };
  }

  // 3. Drayage & Logistics Shipment match
  const shipment = await findMatchingLogisticsShipment(tx, input.tenantId, input.vehicleId, eventDate);
  if (shipment) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: shipment.driverId,
      driverName: null,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: shipment.driverId ? 'DRIVER' : 'LOGISTICS_CARRIER',
      shipmentId: shipment.id,
      agreementNo: shipment.shipmentNo,
      customerId: shipment.customerId,
      confidence: 'HIGH',
      matchConfidence: 85,
      matchSource: 'LOGISTICS_SHIPMENT',
      rechargeTarget: shipment.driverId ? 'DRIVER' : 'CARRIER',
      notes: `Matched to Logistics Shipment ${shipment.shipmentNo || shipment.id.slice(0, 8)}`,
    };
  }

  // 4. Bus-Ops Trip Schedule match
  const busTrip = await findMatchingBusOpsTrip(tx, input.tenantId, input.vehicleId, eventDate);
  if (busTrip) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: busTrip.driverId,
      driverName: null,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: 'DRIVER',
      tripId: busTrip.id,
      agreementNo: busTrip.scheduleNumber,
      confidence: 'HIGH',
      matchConfidence: 85,
      matchSource: 'BUS_OPS_TRIP',
      rechargeTarget: 'DRIVER',
      notes: `Matched to Bus-Ops Trip Schedule ${busTrip.scheduleNumber || busTrip.id.slice(0, 8)}`,
    };
  }

  // 5. School Bus Trip match
  const schoolTrip = await findMatchingSchoolBusTrip(tx, input.tenantId, input.vehicleId, eventDate);
  if (schoolTrip) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: schoolTrip.driverId,
      driverName: schoolTrip.driverName,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: 'DRIVER',
      tripId: schoolTrip.id,
      agreementNo: schoolTrip.tripName,
      confidence: 'HIGH',
      matchConfidence: 85,
      matchSource: 'SCHOOL_BUS_TRIP',
      rechargeTarget: 'DRIVER',
      notes: `Matched to School Bus Trip ${schoolTrip.tripName || schoolTrip.id.slice(0, 8)}`,
    };
  }

  // 6. Dispatch Job match
  const dispatchJob = await findMatchingDispatchJob(tx, input.tenantId, input.vehicleId, eventDate);
  if (dispatchJob) {
    return {
      fineId,
      vehicleId: input.vehicleId,
      driverId: dispatchJob.driverId,
      driverName: null,
      fineAmount,
      fineDate: eventDate,
      offenceType: input.offenceType ?? null,
      authority: input.authority ?? null,
      assignedTo: 'DRIVER',
      dispatchJobId: dispatchJob.id,
      agreementNo: dispatchJob.jobNumber,
      customerId: dispatchJob.customerId,
      confidence: 'HIGH',
      matchConfidence: 80,
      matchSource: 'DISPATCH_JOB',
      rechargeTarget: 'DRIVER',
      notes: `Matched to Dispatch Job ${dispatchJob.jobNumber || dispatchJob.id.slice(0, 8)}`,
    };
  }

  return shiftMatch;
}

/**
 * Sweeps all unassigned/unpaid fines in the tenant and matches them across driver shifts,
 * self-drive RAC rental agreements, corporate leasing, logistics, bus-ops, school-bus, and dispatch.
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

    const match = await matchFineOrToll(tx, {
      id: fine.id,
      fineId: fine.id,
      tenantId,
      vehicleId: fine.vehicleId,
      fineDate: fine.fineDate,
      fineAmount: Number(fine.fineAmount),
      offenceType: fine.offenceType,
      authority: fine.authority,
    });

    matches.push(match);

    if (match.matchConfidence >= threshold) {
      if (!isDryRun) {
        await postFineMatchedGlEntry(tx, tenantId, { ...fine, fineAmount: Number(fine.fineAmount) }, match);
      }
      if (match.assignedTo === 'DRIVER' && match.driverId) {
        matchedToDriverCount++;
        totalDriverRecoverableAed += match.fineAmount;

        if (!isDryRun) {
          await tx.trafficFine.update({
            where: { id: fine.id },
            data: {
              driverId: match.driverId,
              assignedTo: 'DRIVER',
            },
          }).catch(() => {});
        }
      } else if (match.assignedTo === 'RENTAL_CUSTOMER' || match.assignedTo === 'LEASING_CUSTOMER' || match.assignedTo === 'LOGISTICS_CARRIER') {
        matchedToRentalCustomerCount++;
        totalRentalCustomerRecoverableAed += match.fineAmount;

        if (!isDryRun) {
          await tx.trafficFine.update({
            where: { id: fine.id },
            data: {
              assignedTo: match.assignedTo === 'LEASING_CUSTOMER' ? 'RENTAL_CUSTOMER' : match.assignedTo,
            },
          }).catch(() => {});
        }
      } else if (match.assignedTo === 'COMPANY' || match.matchSource === 'COMPANY_DEFECT_OFFENCE') {
        assignedToCompanyCount++;
        totalCompanyLiabilityAed += match.fineAmount;

        if (!isDryRun) {
          await tx.trafficFine.update({
            where: { id: fine.id },
            data: {
              assignedTo: 'COMPANY',
            },
          }).catch(() => {});
        }
      } else {
        unmatchedCount++;
        totalCompanyLiabilityAed += match.fineAmount;
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
