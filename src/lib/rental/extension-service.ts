/**
 * Unified RAC Extension & Renewal Service (1 Extension Process)
 *
 * Every extension — whether initiated from `/rental/renewals`, `/rental/agreements`,
 * `/rental/bookings`, or the B2B `/rac-portal` — runs through this single
 * transactional service:
 *   1. Acquires transaction-scoped advisory locks on the agreement + vehicle.
 *   2. Verifies customer eligibility (blacklist, license expiry vs newEndDate, corporate credit limit).
 *   3. Verifies the physical vehicle has no conflicting reservation during `[originalEndDate, newEndDate]`.
 *   4. Calculates daily rate + 5% UAE VAT from the 1 Master Price List (`quoteRentalRateInTx`),
 *      honoring `requestedDailyRate` ONLY when `allowRateOverride === true`.
 *   5. Writes `rental_extensions` (`RRN-YYYYMM-XXXX`), and ONLY when `status === 'APPROVED'`
 *      atomically updates `RentalAgreement`, `RentalBooking`, and `RentalAdditionalCharge`.
 */

import type { TxClient } from '@/lib/rls';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  assertCustomerEligibleForRental,
  escapeIlikePattern,
} from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import { getRacPreAuthProvider } from '@/lib/rac-portal/preauth-provider';
import { incrementRacCardPreAuth } from '@/lib/rac-portal/preauth-store';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';

export interface ExtensionPreAuthIncrementStatus {
  attempted: boolean;
  status: 'INCREMENTED' | 'FAILED' | 'DECLINED' | 'PENDING_POST_COMMIT' | 'SKIPPED';
  preauthId: string | null;
  provider: string | null;
  additionalAmount: number;
  newTotalAmount: number | null;
  message: string;
}

export interface UnifiedExtensionRow {
  id: string;
  renewalNo: string;
  agreementId: string;
  agreementNo: string | null;
  bookingId: string;
  customerId: string;
  customerName: string | null;
  companyName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  vehicleNo: string | null;
  originalEndDate: string;
  newEndDate: string;
  extensionDays: number;
  dailyRate: number;
  renewalAmount: number;
  vatAmount: number;
  totalAmount: number;
  depositTopUp: number;
  status: string;
  reason: string | null;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  preauthIncrement?: ExtensionPreAuthIncrementStatus | null;
  regulatoryReport?: {
    id: string;
    authority: string;
    eventType: string;
    status: string;
    externalRef: string | null;
  } | null;
  // snake_case aliases preserved so any legacy consumer keeps working seamlessly
  renewal_no: string;
  agreement_id: string;
  agreement_no: string | null;
  customer_name: string | null;
  vehicle_name: string | null;
  vehicle_no: string | null;
  original_end_date: string;
  new_end_date: string;
  extension_days: number;
  daily_rate: number;
  renewal_amount: number;
  vat_amount: number;
  total_amount: number;
  deposit_top_up: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export class ExtensionConflictError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'ExtensionConflictError';
    this.statusCode = statusCode;
  }
}

async function nextExtensionNo(tx: TxClient, tenantId: string): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return nextRentalSerial(tx, {
    tenantId,
    series: `RRN-${ym}`,
    prefix: `RRN-${ym}-`,
    table: 'rental_extensions',
    column: 'renewal_no',
    padWidth: 4,
  });
}

function mapRawExtension(r: Record<string, unknown>): UnifiedExtensionRow {
  const extraDays = Number(r.extra_days ?? 0);
  const baseAmt = Number(r.extra_amount ?? 0);
  const dailyRate =
    r.daily_rate != null
      ? Number(r.daily_rate)
      : extraDays > 0
        ? Number((baseAmt / extraDays).toFixed(2))
        : 0;
  const vatAmt = r.vat_amount != null ? Number(r.vat_amount) : Number((baseAmt * 0.05).toFixed(2));
  const totalAmt =
    r.total_amount != null ? Number(r.total_amount) : Number((baseAmt + vatAmt).toFixed(2));
  const depositTopUp = Number(r.deposit_top_up ?? 0);
  const renewalNo = String(r.renewal_no ?? `RRN-${String(r.id).slice(0, 8).toUpperCase()}`);
  const origStr = r.original_end_date
    ? new Date(String(r.original_end_date)).toISOString()
    : new Date().toISOString();
  const newStr = r.new_end_date
    ? new Date(String(r.new_end_date)).toISOString()
    : new Date().toISOString();
  const createdStr = r.created_at
    ? new Date(String(r.created_at)).toISOString()
    : new Date().toISOString();
  const approvedAtStr = r.approved_at ? new Date(String(r.approved_at)).toISOString() : null;
  const customerName = (r.customer_name as string | null) ?? null;
  const companyName = (r.company_name as string | null) ?? null;
  const vehicleName = (r.vehicle_name as string | null) ?? null;
  const vehicleNo = (r.vehicle_no as string | null) ?? null;
  const agreementNo = (r.agreement_no as string | null) ?? null;
  const approvedBy = (r.approved_by as string | null) ?? null;

  return {
    id: String(r.id),
    renewalNo,
    agreementId: String(r.agreement_id),
    agreementNo,
    bookingId: String(r.booking_id ?? ''),
    customerId: String(r.customer_id ?? ''),
    customerName,
    companyName,
    vehicleId: (r.vehicle_id as string | null) ?? null,
    vehicleName,
    vehicleNo,
    originalEndDate: origStr,
    newEndDate: newStr,
    extensionDays: extraDays,
    dailyRate,
    renewalAmount: baseAmt,
    vatAmount: vatAmt,
    totalAmount: totalAmt,
    depositTopUp,
    status: String(r.status ?? 'PENDING'),
    reason: (r.reason as string | null) ?? null,
    notes: (r.notes as string | null) ?? (r.reason as string | null) ?? null,
    approvedBy,
    approvedAt: approvedAtStr,
    createdAt: createdStr,
    // snake_case compatibility
    renewal_no: renewalNo,
    agreement_id: String(r.agreement_id),
    agreement_no: agreementNo,
    customer_name: companyName ? `${companyName} (${customerName ?? ''})`.trim() : customerName,
    vehicle_name: vehicleName,
    vehicle_no: vehicleNo,
    original_end_date: origStr,
    new_end_date: newStr,
    extension_days: extraDays,
    daily_rate: dailyRate,
    renewal_amount: baseAmt,
    vat_amount: vatAmt,
    total_amount: totalAmt,
    deposit_top_up: depositTopUp,
    approved_by: approvedBy,
    approved_at: approvedAtStr,
    created_at: createdStr,
  };
}

const EXTENSION_JOIN_SELECT = `
  SELECT
    re.id::text AS id,
    re.renewal_no,
    re.agreement_id,
    re.original_end_date,
    re.new_end_date,
    re.extra_days,
    re.extra_amount,
    re.daily_rate,
    re.vat_amount,
    re.total_amount,
    re.deposit_top_up,
    re.reason,
    re.notes,
    re.approved_by,
    re.approved_at,
    re.status,
    re.created_at,
    ra.agreement_no,
    ra.booking_id,
    ra.customer_id,
    ra.vehicle_id,
    ra.status AS agreement_status,
    ra.corporate_account_id,
    rc.full_name AS customer_name,
    rc.company_name,
    CONCAT_WS(' ', v.make, v.model) AS vehicle_name,
    v.registration_no AS vehicle_no
  FROM rental_extensions re
  JOIN rental_agreements ra ON ra.id = re.agreement_id AND ra.tenant_id::text = re.tenant_id::text
  LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.tenant_id::text = ra.tenant_id::text
  LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.tenant_id::text = ra.tenant_id::text
`;

export async function listUnifiedExtensions(
  tx: TxClient,
  args: {
    tenantId: string;
    status?: string | null;
    search?: string | null;
    customerId?: string | null;
    agreementId?: string | null;
    page?: number;
    limit?: number;
  },
) {
  const page = Math.max(1, args.page ?? 1);
  const limit = Math.min(200, Math.max(1, args.limit ?? 50));
  const offset = (page - 1) * limit;

  const clauses: string[] = ['re.tenant_id::text = $1'];
  const params: unknown[] = [args.tenantId];
  let idx = 2;

  if (args.status && args.status !== 'ALL') {
    clauses.push(`re.status = $${idx++}`);
    params.push(args.status);
  }
  if (args.customerId) {
    clauses.push(`ra.customer_id = $${idx++}`);
    params.push(args.customerId);
  }
  if (args.agreementId) {
    clauses.push(`re.agreement_id = $${idx++}`);
    params.push(args.agreementId);
  }
  if (args.search && args.search.trim()) {
    const escaped = escapeIlikePattern(args.search.trim());
    clauses.push(
      `(COALESCE(re.renewal_no, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(ra.agreement_no, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.full_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.company_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(v.registration_no, '') ILIKE $${idx} ESCAPE '\\')`,
    );
    params.push(`%${escaped}%`);
    idx++;
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  const rawRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `${EXTENSION_JOIN_SELECT} ${whereSql} ORDER BY re.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    ...params,
    limit,
    offset,
  );

  const summaryRows = await tx.$queryRawUnsafe<
    Array<{ status: string; count: string; total: string }>
  >(
    `SELECT
       re.status,
       COUNT(*)::text AS count,
       COALESCE(SUM(COALESCE(re.total_amount, re.extra_amount * 1.05)), 0)::text AS total
     FROM rental_extensions re
     JOIN rental_agreements ra ON ra.id = re.agreement_id AND ra.tenant_id::text = re.tenant_id::text
     WHERE re.tenant_id::text = $1
     ${args.customerId ? 'AND ra.customer_id = $2' : ''}
     GROUP BY re.status`,
    ...(args.customerId ? [args.tenantId, args.customerId] : [args.tenantId]),
  );

  const monthRows = await tx.$queryRawUnsafe<Array<{ cnt: string; avg_days: string }>>(
    `SELECT
       COUNT(*)::text AS cnt,
       COALESCE(AVG(re.extra_days), 0)::text AS avg_days
     FROM rental_extensions re
     WHERE re.tenant_id::text = $1
       AND DATE_TRUNC('month', re.created_at) = DATE_TRUNC('month', NOW())`,
    args.tenantId,
  );

  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const s of summaryRows) {
    const stKey = s.status ?? 'PENDING';
    counts[stKey] = parseInt(s.count, 10);
    totals[stKey] = parseFloat(s.total);
  }

  const kpis = {
    pendingCount: counts['PENDING'] ?? 0,
    approvedTotal: totals['APPROVED'] ?? 0,
    thisMonthExtensions: parseInt(monthRows[0]?.cnt ?? '0', 10),
    avgExtensionDays: Number(parseFloat(monthRows[0]?.avg_days ?? '0').toFixed(1)),
  };

  return {
    data: rawRows.map(mapRawExtension),
    counts,
    kpis,
    page,
    limit,
  };
}

async function applyApprovedExtensionToLifecycle(
  tx: TxClient,
  args: {
    tenantId: string;
    agreementId: string;
    bookingId: string | null;
    newEndDate: Date;
    extraDays: number;
    renewalAmount: number;
    vatAmount: number;
    totalAmount: number;
    depositTopUp: number;
    renewalNo: string;
    submittedBy?: string | null;
  },
): Promise<{
  regulatoryReport: UaeRegulatoryReportRecord | null;
  targetPreauthId: string | null;
  targetPreauthProvider: string | null;
  targetPreauthAmount: number;
  targetPreauthCurrency: string;
}> {
  await tx.$executeRawUnsafe(
    `UPDATE rental_agreements
        SET end_date = $1::timestamptz,
            total_amount = COALESCE(total_amount, 0) + $2,
            security_deposit = COALESCE(security_deposit, 0) + $3,
            updated_at = NOW()
      WHERE id = $4 AND tenant_id::text = $5`,
    args.newEndDate.toISOString(),
    args.totalAmount,
    args.depositTopUp,
    args.agreementId,
    args.tenantId,
  );

  if (args.bookingId) {
    await tx.$executeRawUnsafe(
      `UPDATE rental_bookings
          SET dropoff_date = $1::timestamptz,
              total_days = COALESCE(total_days, 1) + $2,
              total_amount = COALESCE(total_amount, 0) + $3,
              updated_at = NOW()
        WHERE id = $4 AND tenant_id::text = $5`,
      args.newEndDate.toISOString(),
      args.extraDays,
      args.totalAmount,
      args.bookingId,
      args.tenantId,
    );
  }

  await tx.rentalAdditionalCharge.create({
    data: {
      tenantId: args.tenantId,
      agreementId: args.agreementId,
      chargeType: 'EXTENSION',
      description: `Rental extension ${args.renewalNo} (+${args.extraDays} day${args.extraDays === 1 ? '' : 's'}) [INCLUDED IN EXTENDED AGREEMENT END DATE]`,
      amount: args.renewalAmount,
      quantity: args.extraDays,
      totalAmount: args.totalAmount,
      billedToCustomer: false,
    },
  });

  // Queue UAE Tarrashud / Dubai Police / Abu Dhabi ITC EXTENSION regulatory manifest inside tx
  const regulatoryReport = await queueUaeRegulatoryReportInTx(tx, {
    tenantId: args.tenantId,
    agreementId: args.agreementId,
    eventType: 'EXTENSION',
    submittedBy: args.submittedBy ?? 'system',
  });

  // Check if an AUTHORIZED card pre-auth hold exists for this agreement/booking when depositTopUp > 0
  let targetPreauthId: string | null = null;
  let targetPreauthProvider: string | null = null;
  let targetPreauthAmount = 0;
  let targetPreauthCurrency = 'AED';

  if (args.depositTopUp > 0 && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
    const preauthRows = await withSavepoint(
      tx,
      'ext_find_preauth',
      () =>
        tx.$queryRawUnsafe<
          Array<{
            id: string;
            provider: string | null;
            amount: string | number;
            currency: string | null;
          }>
        >(
          `SELECT id::text AS id, provider, amount::text AS amount, currency
             FROM rac_card_preauths
            WHERE tenant_id = $1
              AND status = 'AUTHORIZED'
              AND (
                agreement_id = $2
                OR ($3::text IS NOT NULL AND $3 <> '' AND booking_id = $3)
              )
            ORDER BY created_at DESC
            LIMIT 1`,
          args.tenantId,
          args.agreementId,
          args.bookingId ?? null,
        ),
      [],
    );
    const found = preauthRows[0];
    if (found?.id) {
      targetPreauthId = found.id;
      targetPreauthProvider = found.provider ?? null;
      targetPreauthAmount = Number(found.amount ?? 0);
      targetPreauthCurrency = found.currency ?? 'AED';
    }
  }

  return {
    regulatoryReport,
    targetPreauthId,
    targetPreauthProvider,
    targetPreauthAmount,
    targetPreauthCurrency,
  };
}

/**
 * Triggers non-fatal post-commit incremental pre-authorization hold and regulatory
 * manifest dispatch strictly OUTSIDE `withTenantRls` so zero DB locks are held over network I/O.
 */
function scheduleExtensionPostCommitOutsideRls(opts: {
  tenantId: string;
  renewalNo: string;
  depositTopUp: number;
  initiatedByUser?: string | null;
  regulatoryReport: UaeRegulatoryReportRecord | null;
  targetPreauthId: string | null;
  targetPreauthProvider: string | null;
  targetPreauthAmount: number;
  targetPreauthCurrency: string;
}): ExtensionPreAuthIncrementStatus | null {
  if (opts.regulatoryReport && opts.regulatoryReport.status === 'QUEUED') {
    setTimeout(() => {
      void dispatchUaeRegulatoryReportOutsideRls(opts.regulatoryReport!).catch((err) =>
        console.warn('[extension-service] post-commit regulatory dispatch failed:', err),
      );
    }, 0);
  }

  if (!(opts.depositTopUp > 0) || !opts.targetPreauthId) {
    return null;
  }

  const provider = getRacPreAuthProvider(opts.targetPreauthProvider);
  const projectedTotal = Number((opts.targetPreauthAmount + opts.depositTopUp).toFixed(2));

  // Schedule 3-phase incrementRacCardPreAuth to execute post-commit outside the caller's RLS transaction
  setTimeout(() => {
    void incrementRacCardPreAuth({
      tenantId: opts.tenantId,
      preauthId: opts.targetPreauthId!,
      additionalAmount: opts.depositTopUp,
      reason: `RAC Extension ${opts.renewalNo} deposit top-up`,
      initiatedByUser: opts.initiatedByUser ?? null,
    }).catch((err) => {
      console.warn(
        `[extension-service] Non-fatal post-commit incrementRacCardPreAuth failed for ${opts.targetPreauthId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }, 0);

  return {
    attempted: true,
    status: 'PENDING_POST_COMMIT',
    preauthId: opts.targetPreauthId,
    provider: provider.id,
    additionalAmount: opts.depositTopUp,
    newTotalAmount: projectedTotal,
    message: `Incremental card hold (+${opts.targetPreauthCurrency} ${opts.depositTopUp.toFixed(2)}) queued post-commit via ${provider.id}.`,
  };
}

/**
 * Optional post-commit helper for route handlers that want to await the incremental
 * pre-auth hold synchronously right after `withTenantRls` commits (non-fatal on card decline).
 */
export async function settleExtensionPreAuthOutsideRls(
  extension: UnifiedExtensionRow,
  opts: { tenantId: string; initiatedByUser?: string | null },
): Promise<UnifiedExtensionRow> {
  const inc = extension.preauthIncrement;
  if (!inc || !inc.preauthId || !(extension.depositTopUp > 0)) {
    return extension;
  }
  try {
    const res = await incrementRacCardPreAuth({
      tenantId: opts.tenantId,
      preauthId: inc.preauthId,
      additionalAmount: extension.depositTopUp,
      reason: `RAC Extension ${extension.renewalNo} deposit top-up`,
      initiatedByUser: opts.initiatedByUser ?? null,
    });
    return {
      ...extension,
      preauthIncrement: {
        attempted: true,
        status: 'INCREMENTED',
        preauthId: res.preauth.id,
        provider: res.preauth.provider,
        additionalAmount: res.increment.additionalAmount,
        newTotalAmount: res.preauth.amount,
        message: res.increment.message,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Incremental pre-authorization declined';
    return {
      ...extension,
      preauthIncrement: {
        attempted: true,
        status: msg.toLowerCase().includes('declin') ? 'DECLINED' : 'FAILED',
        preauthId: inc.preauthId,
        provider: inc.provider,
        additionalAmount: extension.depositTopUp,
        newTotalAmount: inc.newTotalAmount,
        message: msg,
      },
    };
  }
}

type AgreementLookupRow = {
  id: string;
  agreement_no: string | null;
  booking_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  end_date: string | Date;
  daily_rate: string | number | null;
  status: string | null;
  is_corporate: boolean | null;
  corporate_account_id: string | null;
  currency: string | null;
  vehicle_category: string | null;
  booking_category: string | null;
  channel: string | null;
  customer_type: string | null;
};

const AGREEMENT_LOOKUP_SQL = `
  SELECT ra.id, ra.agreement_no, ra.booking_id, ra.customer_id, ra.vehicle_id,
         ra.end_date, ra.daily_rate, ra.status, ra.is_corporate, ra.corporate_account_id,
         ra.currency, v.category AS vehicle_category, rb.vehicle_category AS booking_category,
         rb.channel, rc.customer_type
    FROM rental_agreements ra
    LEFT JOIN rental_bookings rb ON rb.id = ra.booking_id AND rb.tenant_id::text = ra.tenant_id::text
    LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.tenant_id::text = ra.tenant_id::text
    LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.tenant_id::text = ra.tenant_id::text
`;

export async function createUnifiedExtension(
  tx: TxClient,
  args: {
    tenantId: string;
    agreementId?: string | null;
    agreementNo?: string | null;
    bookingId?: string | null;
    newEndDate: Date;
    requestedDailyRate?: number | null;
    allowRateOverride?: boolean;
    allowCreditOverride?: boolean;
    depositTopUp?: number;
    reason?: string | null;
    notes?: string | null;
    autoApprove: boolean;
    approvedBy?: string | null;
  },
): Promise<UnifiedExtensionRow> {
  // Resolve agreement + booking (strictly tenant-scoped)
  const lookupClauses: string[] = ['ra.tenant_id::text = $1'];
  const lookupArgs: unknown[] = [args.tenantId];
  if (args.agreementId) {
    lookupClauses.push('ra.id = $2');
    lookupArgs.push(args.agreementId);
  } else if (args.bookingId) {
    lookupClauses.push('ra.booking_id = $2');
    lookupArgs.push(args.bookingId);
  } else if (args.agreementNo) {
    lookupClauses.push('ra.agreement_no = $2');
    lookupArgs.push(args.agreementNo.trim());
  } else {
    throw new ExtensionConflictError('agreementId, agreementNo, or bookingId is required', 400);
  }

  let agrRows = await tx.$queryRawUnsafe<AgreementLookupRow[]>(
    `${AGREEMENT_LOOKUP_SQL} WHERE ${lookupClauses.join(' AND ')} LIMIT 1`,
    ...lookupArgs,
  );

  // If caller passed bookingId of a CONFIRMED/ACTIVE booking without a RentalAgreement row yet,
  // create a DRAFT agreement under serial lock so PENDING extensions queue properly in rental_extensions
  // without prematurely mutating booking.dropoffDate before manager approval.
  if (agrRows.length === 0 && args.bookingId) {
    const booking = await tx.rentalBooking.findFirst({
      where: { id: args.bookingId, tenantId: args.tenantId, deletedAt: null },
    });
    if (!booking) throw new ExtensionConflictError('Booking not found', 404);
    if (!['CONFIRMED', 'ACTIVE'].includes(booking.status ?? '')) {
      throw new ExtensionConflictError(
        `Cannot extend a booking in status ${booking.status}`,
        409,
      );
    }

    const draftAgrNo = await nextRentalSerial(tx, {
      tenantId: args.tenantId,
      series: 'RA',
      prefix: 'RA-',
      table: 'rental_agreements',
      column: 'agreement_no',
      padWidth: 6,
    });

    const createdAgr = await tx.rentalAgreement.create({
      data: {
        tenantId: args.tenantId,
        agreementNo: draftAgrNo,
        bookingId: booking.id,
        customerId: booking.customerId,
        vehicleId: booking.vehicleId,
        startDate: booking.pickupDate,
        endDate: booking.dropoffDate,
        dailyRate: booking.dailyRate,
        totalAmount: booking.totalAmount,
        currency: booking.currency ?? 'AED',
        status: booking.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      },
    });

    agrRows = await tx.$queryRawUnsafe<AgreementLookupRow[]>(
      `${AGREEMENT_LOOKUP_SQL} WHERE ra.tenant_id::text = $1 AND ra.id = $2 LIMIT 1`,
      args.tenantId,
      createdAgr.id,
    );
  }

  const agr = agrRows[0];
  if (!agr) {
    throw new ExtensionConflictError('Rental agreement not found', 404);
  }
  if (!['DRAFT', 'ACTIVE', 'CONFIRMED'].includes(agr.status ?? '')) {
    throw new ExtensionConflictError(`Cannot extend agreement in status ${agr.status}`, 409);
  }

  const originalEndDate = new Date(agr.end_date);
  if (isNaN(args.newEndDate.getTime()) || args.newEndDate <= originalEndDate) {
    throw new ExtensionConflictError(
      'New end date must be after the agreement current end date',
      400,
    );
  }

  return withRentalLock(
    tx,
    args.tenantId,
    { entityKey: agr.id, vehicleIds: [agr.vehicle_id] },
    async () => {
      if (agr.vehicle_id) {
        const conflict = await checkVehicleRentalConflict(tx, {
          tenantId: args.tenantId,
          vehicleId: agr.vehicle_id,
          startDate: originalEndDate,
          endDate: args.newEndDate,
          excludeBookingId: agr.booking_id ?? undefined,
          excludeAgreementId: agr.id,
          checkGrounding: true,
        });
        if (conflict.hasConflict) {
          throw new ExtensionConflictError(
            conflict.reason ?? 'Vehicle unavailable for extension period',
            409,
          );
        }
      }

      const extraDays = Math.max(
        1,
        Math.ceil((args.newEndDate.getTime() - originalEndDate.getTime()) / 86400000),
      );

      // Compute rate from the 1 Unified Master Price List
      const category = agr.vehicle_category ?? agr.booking_category ?? 'ECONOMY';
      const quote = await quoteRentalRateInTx(tx, args.tenantId, {
        vehicleCategory: category,
        pickupDate: originalEndDate,
        dropoffDate: args.newEndDate,
        customerType: agr.customer_type ?? (agr.is_corporate ? 'CORPORATE' : 'INDIVIDUAL'),
        corporateAccountId: agr.corporate_account_id ?? undefined,
        channel: agr.channel ?? (agr.is_corporate ? 'CORPORATE' : 'DIRECT'),
        currency: agr.currency ?? 'AED',
      });

      const isManualRateOverride =
        args.allowRateOverride === true &&
        args.requestedDailyRate != null &&
        Number.isFinite(args.requestedDailyRate) &&
        args.requestedDailyRate >= 0;

      let dailyRate: number;
      let renewalAmount: number;
      let vatAmount: number;
      let totalAmount: number;

      if (isManualRateOverride) {
        dailyRate = Number(args.requestedDailyRate);
        renewalAmount = Number((extraDays * dailyRate).toFixed(2));
        vatAmount = Number((renewalAmount * 0.05).toFixed(2));
        totalAmount = Number((renewalAmount + vatAmount).toFixed(2));
      } else if (quote.appliedRuleId != null && quote.dailyRate > 0) {
        dailyRate = quote.dailyRate;
        renewalAmount = quote.subtotal;
        vatAmount = quote.taxAmount;
        totalAmount = quote.totalAmount;
      } else {
        dailyRate = Number(agr.daily_rate ?? 0);
        renewalAmount = Number((extraDays * dailyRate).toFixed(2));
        vatAmount = Number((renewalAmount * 0.05).toFixed(2));
        totalAmount = Number((renewalAmount + vatAmount).toFixed(2));
      }

      const depositTopUp = Math.max(0, Number(args.depositTopUp ?? 0));

      // Verify customer eligibility (blacklist, license expiry vs newEndDate, corporate credit limit)
      await assertCustomerEligibleForRental(tx, {
        tenantId: args.tenantId,
        customerId: agr.customer_id,
        corporateAccountId: agr.corporate_account_id,
        dropoffDate: args.newEndDate,
        additionalExposureAed: totalAmount,
        allowCreditOverride: args.allowCreditOverride,
      });

      const status = args.autoApprove ? 'APPROVED' : 'PENDING';
      const renewalNo = await nextExtensionNo(tx, args.tenantId);
      const extId = crypto.randomUUID();

      await tx.$executeRawUnsafe(
        `INSERT INTO rental_extensions
           (id, tenant_id, agreement_id, renewal_no, original_end_date, new_end_date,
            extra_days, extra_amount, daily_rate, vat_amount, total_amount, deposit_top_up,
            reason, notes, status, approved_by, approved_at, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
            $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17::timestamptz, NOW(), NOW())`,
        extId,
        args.tenantId,
        agr.id,
        renewalNo,
        originalEndDate.toISOString(),
        args.newEndDate.toISOString(),
        extraDays,
        renewalAmount,
        dailyRate,
        vatAmount,
        totalAmount,
        depositTopUp,
        args.reason ?? args.notes ?? null,
        args.notes ?? args.reason ?? null,
        status,
        status === 'APPROVED' ? (args.approvedBy ?? 'SYSTEM') : null,
        status === 'APPROVED' ? new Date().toISOString() : null,
      );

      let lifecycleMeta: Awaited<ReturnType<typeof applyApprovedExtensionToLifecycle>> | null = null;
      if (status === 'APPROVED') {
        lifecycleMeta = await applyApprovedExtensionToLifecycle(tx, {
          tenantId: args.tenantId,
          agreementId: agr.id,
          bookingId: agr.booking_id,
          newEndDate: args.newEndDate,
          extraDays,
          renewalAmount,
          vatAmount,
          totalAmount,
          depositTopUp,
          renewalNo,
          submittedBy: args.approvedBy ?? 'SYSTEM',
        });
      }

      const [created] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `${EXTENSION_JOIN_SELECT} WHERE re.id::text = $1 AND re.tenant_id::text = $2 LIMIT 1`,
        extId,
        args.tenantId,
      );
      const mappedCreated = mapRawExtension(created);

      if (lifecycleMeta) {
        const preauthIncrement = scheduleExtensionPostCommitOutsideRls({
          tenantId: args.tenantId,
          renewalNo,
          depositTopUp,
          initiatedByUser: args.approvedBy ?? null,
          ...lifecycleMeta,
        });
        return {
          ...mappedCreated,
          preauthIncrement,
          regulatoryReport: lifecycleMeta.regulatoryReport
            ? {
                id: lifecycleMeta.regulatoryReport.id,
                authority: lifecycleMeta.regulatoryReport.authority,
                eventType: lifecycleMeta.regulatoryReport.eventType,
                status: lifecycleMeta.regulatoryReport.status,
                externalRef: lifecycleMeta.regulatoryReport.externalRef,
              }
            : null,
        };
      }

      return mappedCreated;
    },
  );
}

export async function decideUnifiedExtension(
  tx: TxClient,
  args: {
    tenantId: string;
    extensionId: string;
    status: 'APPROVED' | 'REJECTED' | 'COMPLETED';
    approvedBy: string;
    notes?: string | null;
    allowCreditOverride?: boolean;
  },
): Promise<UnifiedExtensionRow> {
  const existingRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `${EXTENSION_JOIN_SELECT} WHERE re.id::text = $1 AND re.tenant_id::text = $2 LIMIT 1`,
    args.extensionId,
    args.tenantId,
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new ExtensionConflictError('Extension request not found', 404);
  }

  const prevStatus = String(existing.status ?? 'PENDING').toUpperCase();

  // Enforce strict state-machine transitions on extension decisions
  if (args.status === 'APPROVED' || args.status === 'REJECTED') {
    if (prevStatus !== 'PENDING') {
      throw new ExtensionConflictError(
        `Cannot transition extension from ${prevStatus} to ${args.status}`,
        409,
      );
    }
  } else if (args.status === 'COMPLETED') {
    if (prevStatus !== 'APPROVED') {
      throw new ExtensionConflictError(
        `Only APPROVED extensions can be marked COMPLETED (current status: ${prevStatus})`,
        409,
      );
    }
  }

  let approveMeta: Awaited<ReturnType<typeof applyApprovedExtensionToLifecycle>> | null = null;
  let approveRenewalNo = '';
  let approveDepositTopUp = 0;

  if (args.status === 'APPROVED') {
    const agrStatus = String(existing.agreement_status ?? '').toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'CONFIRMED'].includes(agrStatus)) {
      throw new ExtensionConflictError(
        `Cannot approve extension for a ${agrStatus} rental agreement`,
        409,
      );
    }

    const vehicleId = (existing.vehicle_id as string | null) ?? null;
    const agreementId = String(existing.agreement_id);
    const bookingId = existing.booking_id ? String(existing.booking_id) : null;
    const customerId = String(existing.customer_id);
    const corporateAccountId = (existing.corporate_account_id as string | null) ?? null;
    const origEnd = new Date(String(existing.original_end_date));
    const newEnd = new Date(String(existing.new_end_date));
    const mapped = mapRawExtension(existing);
    approveRenewalNo = mapped.renewalNo;
    approveDepositTopUp = mapped.depositTopUp;

    await assertCustomerEligibleForRental(tx, {
      tenantId: args.tenantId,
      customerId,
      corporateAccountId,
      dropoffDate: newEnd,
      additionalExposureAed: mapped.totalAmount,
      allowCreditOverride: args.allowCreditOverride,
    });

    await withRentalLock(
      tx,
      args.tenantId,
      { entityKey: agreementId, vehicleIds: [vehicleId] },
      async () => {
        if (vehicleId) {
          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId: args.tenantId,
            vehicleId,
            startDate: origEnd,
            endDate: newEnd,
            excludeBookingId: bookingId ?? undefined,
            excludeAgreementId: agreementId,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            throw new ExtensionConflictError(
              conflict.reason ?? 'Vehicle unavailable for extension period',
              409,
            );
          }
        }

        approveMeta = await applyApprovedExtensionToLifecycle(tx, {
          tenantId: args.tenantId,
          agreementId,
          bookingId,
          newEndDate: newEnd,
          extraDays: mapped.extensionDays,
          renewalAmount: mapped.renewalAmount,
          vatAmount: mapped.vatAmount,
          totalAmount: mapped.totalAmount,
          depositTopUp: mapped.depositTopUp,
          renewalNo: mapped.renewalNo,
          submittedBy: args.approvedBy,
        });
      },
    );
  }

  await tx.$executeRawUnsafe(
    `UPDATE rental_extensions
        SET status = $1,
            approved_by = $2,
            approved_at = CASE WHEN $1 IN ('APPROVED', 'REJECTED') THEN NOW() ELSE approved_at END,
            notes = COALESCE($3, notes),
            updated_at = NOW()
      WHERE id::text = $4 AND tenant_id::text = $5`,
    args.status,
    args.approvedBy,
    args.notes ?? null,
    args.extensionId,
    args.tenantId,
  );

  const [updated] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `${EXTENSION_JOIN_SELECT} WHERE re.id::text = $1 AND re.tenant_id::text = $2 LIMIT 1`,
    args.extensionId,
    args.tenantId,
  );
  const mappedUpdated = mapRawExtension(updated);

  if (approveMeta) {
    const meta = approveMeta as Awaited<ReturnType<typeof applyApprovedExtensionToLifecycle>>;
    const preauthIncrement = scheduleExtensionPostCommitOutsideRls({
      tenantId: args.tenantId,
      renewalNo: approveRenewalNo,
      depositTopUp: approveDepositTopUp,
      initiatedByUser: args.approvedBy,
      ...meta,
    });
    return {
      ...mappedUpdated,
      preauthIncrement,
      regulatoryReport: meta.regulatoryReport
        ? {
            id: meta.regulatoryReport.id,
            authority: meta.regulatoryReport.authority,
            eventType: meta.regulatoryReport.eventType,
            status: meta.regulatoryReport.status,
            externalRef: meta.regulatoryReport.externalRef,
          }
        : null,
    };
  }

  return mappedUpdated;
}
