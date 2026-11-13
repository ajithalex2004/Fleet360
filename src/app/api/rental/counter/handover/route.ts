export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/rental/counter/handover (1 Unified Pick-Up Desk)
 *
 * External I/O (signature image upload) runs BEFORE `withTenantRls`.
 * Atomically inside `withTenantRls` + `withRentalLock`:
 *   1. Enforces workflow approval (`requireApproved`), customer eligibility, and tenant FK ownership
 *   2. Verifies physical vehicle is not GROUNDED/MAINTENANCE/OUT_OF_SERVICE and has no overlapping
 *      booking, agreement, lease, work order, branch transfer, or grounding block (`checkGrounding: true`)
 *   3. Acquires serial lock (`nextRentalSerial`) and issues per-tenant `RA-XXXXXX`
 *   4. Upserts `RentalAgreement` (`ACTIVE`) and syncs canonical `0..100%` fuel + odometer km across
 *      BOTH `mileage_out`/`fuel_out` AND `pickup_odometer`/`pickup_fuel_level`
 *   5. Persists pick-up `vehicle_inspections` (`type = 'checkin'`) with validated photos,
 *      damage markers, checklist items, and signature URL
 *   6. Links any `AUTHORIZED` `rac_card_preauths` on `booking.id` to `agreement.id` (off-balance-sheet hold),
 *      OR if a cash/card deposit was actually collected, records `finance_security_deposits` + GL (`CR 2150`)
 *   7. Marks `rental_bookings` `ACTIVE` and assigned `vehicles` `RENTED`
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { detectFileKind } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { recordRacSecurityDepositCollected } from '@/lib/finance/rac-gl-posting';
import {
  pctToEighths,
  resolveInputFuelPct,
} from '@/lib/rental/fuel-odometer';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertAdditionalDriversEligible,
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
  persistAdditionalDriversInTx,
  validateSafeDocumentOrSignatureUrl,
  type ValidatedAdditionalDriver,
} from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';
import { requireApproved } from '@/lib/workflow/approvals';
import type { TxClient } from '@/lib/rls';

/** A handover signature is a small drawing; anything larger is refused. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export const runtime = 'nodejs';

const damageMarkerSchema = z
  .object({
    zone: z.string().optional(),
    zoneId: z.string().optional(),
    type: z.string().optional(),
    severity: z.string().default('MINOR'),
    x: z.number().optional(),
    y: z.number().optional(),
    note: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const ancillaryItemSchema = z
  .object({
    ancillaryId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    code: z.string().optional(),
    name: z.string().optional(),
    quantity: z.coerce.number().int().min(1).max(20).optional(),
    dailyRate: z.coerce.number().min(0).optional(),
    perRental: z.boolean().optional(),
  })
  .passthrough();

const bodySchema = z
  .object({
    bookingId: z.string().min(1).optional(),
    walkIn: z.boolean().optional(),
    customerId: z.string().min(1).optional(),
    corporateAccountId: z.string().min(1).optional(),
    vehicleId: z.string().min(1).optional(),
    vehicleCategory: z.string().optional(),
    pickupDate: z.string().optional(),
    startDate: z.string().optional(),
    dropoffDate: z.string().optional(),
    endDate: z.string().optional(),
    pickupLocation: z.string().optional(),
    dropoffLocation: z.string().optional(),
    dailyRate: z.coerce.number().min(0).optional(),
    totalAmount: z.coerce.number().min(0).optional(),
    currency: z.string().optional(),
    channel: z.string().optional(),
    ancillaryIds: z.array(z.string().min(1)).optional(),
    ancillaries: z.array(ancillaryItemSchema).optional(),
    additionalDrivers: z.array(z.record(z.string(), z.unknown())).optional(),
    mileageOut: z.coerce.number().int().min(0).optional(),
    pickupOdometer: z.coerce.number().int().min(0).optional(),
    fuelOut: z.union([z.coerce.number().min(0).max(100), z.string()]).optional(),
    fuelOutPct: z.coerce.number().min(0).max(100).optional(),
    pickupFuelLevel: z.coerce.number().min(0).max(100).optional(),
    fuelOutEighths: z.coerce.number().min(0).max(8).optional(),
    fuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    pickupFuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    checklist: z
      .union([z.record(z.string(), z.boolean()), z.array(z.unknown())])
      .optional()
      .default({}),
    damageMarkers: z.array(damageMarkerSchema).default([]),
    photoUrls: z.array(z.string()).default([]),
    signatureDataUrl: z.string().optional(),
    openBranchId: z.string().optional(),
    notes: z.string().optional(),
    securityDeposit: z.coerce.number().min(0).optional(),
    depositStatus: z.string().optional(),
    depositMethod: z.string().optional(),
  })
  .passthrough();

interface NormalizedAncillaryItem {
  ancillaryId: string | null;
  code: string;
  name: string;
  quantity: number;
  dailyRate: number;
  perRental: boolean;
  chargeQty: number;
  preVatTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseIsoOrDate(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function resolveAncillariesInTx(
  tx: TxClient,
  tenantId: string,
  rawAncillaries: Array<z.infer<typeof ancillaryItemSchema>> | undefined,
  rawAncillaryIds: string[] | undefined,
  rentalDays: number,
): Promise<NormalizedAncillaryItem[]> {
  const items: Array<z.infer<typeof ancillaryItemSchema>> = [...(rawAncillaries ?? [])];
  if (Array.isArray(rawAncillaryIds)) {
    for (const aid of rawAncillaryIds) {
      if (aid && !items.some((x) => (x.ancillaryId ?? x.id) === aid)) {
        items.push({ ancillaryId: aid, quantity: 1 });
      }
    }
  }
  if (items.length === 0) return [];

  const lookupIds = Array.from(
    new Set(
      items
        .map((x) => (x.ancillaryId ?? x.id ?? '').trim())
        .filter((v) => v.length > 0),
    ),
  );
  if (lookupIds.length > 0) {
    await assertRentalForeignKeysInTenant(tx, tenantId, { ancillaryIds: lookupIds });
  }

  const catalogById = new Map<
    string,
    { id: string; code: string; name: string; dailyRate: number; perRental: boolean }
  >();
  if (lookupIds.length > 0) {
    if (typeof tx.rentalAncillary?.findMany === 'function') {
      const catRows = await tx.rentalAncillary.findMany({
        where: { tenantId, deletedAt: null, id: { in: lookupIds } },
      });
      for (const c of catRows) {
        const rec = c as unknown as Record<string, unknown>;
        const rt = String(rec.rateType ?? '').toUpperCase();
        catalogById.set(c.id, {
          id: c.id,
          code: c.code,
          name: String(rec.name ?? rec.titleEn ?? c.code),
          dailyRate: Number(rec.dailyRate ?? rec.rateAmount ?? 0),
          perRental: Boolean(rec.perRental ?? (rt === 'PER_RENTAL' || rt === 'FLAT')),
        });
      }
    } else if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
      const catRows = await withSavepoint<
        Array<{
          id: string;
          code: string;
          name: string;
          daily_rate: string | number;
          per_rental: boolean;
        }>
      >(
        tx,
        'handover_ancillary_catalog',
        () =>
          tx.$queryRawUnsafe(
            `SELECT id::text AS id, code, name, daily_rate, per_rental
               FROM rental_ancillaries
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND id::text = ANY($2::text[])`,
            tenantId,
            lookupIds,
          ),
        [],
      );
      for (const c of catRows) {
        catalogById.set(c.id, {
          id: c.id,
          code: c.code,
          name: c.name,
          dailyRate: Number(c.daily_rate ?? 0),
          perRental: Boolean(c.per_rental),
        });
      }
    }
  }

  const days = Math.max(1, Math.round(rentalDays));
  const normalized: NormalizedAncillaryItem[] = [];
  for (const raw of items) {
    const refId = (raw.ancillaryId ?? raw.id ?? '').trim() || null;
    const cat = refId ? catalogById.get(refId) : undefined;
    const code = (raw.code?.trim() || cat?.code || 'ANCILLARY').toUpperCase();
    const name = raw.name?.trim() || cat?.name || code;
    const qty = Math.max(1, Math.round(Number(raw.quantity ?? 1)));
    const rate = round2(
      raw.dailyRate !== undefined ? Number(raw.dailyRate) : Number(cat?.dailyRate ?? 0),
    );
    const perRental = raw.perRental !== undefined ? Boolean(raw.perRental) : Boolean(cat?.perRental);
    const chargeQty = perRental ? qty : qty * days;
    const preVatTotal = round2(chargeQty * rate);
    normalized.push({
      ancillaryId: refId,
      code,
      name,
      quantity: qty,
      dailyRate: rate,
      perRental,
      chargeQty,
      preVatTotal,
    });
  }
  return normalized;
}

async function insertExtraChargesForAgreementInTx(
  tx: TxClient,
  opts: {
    tenantId: string;
    agreementId: string;
    rentalDays: number;
    ancillaries: NormalizedAncillaryItem[];
    drivers: ValidatedAdditionalDriver[];
    actorUserId: string;
  },
): Promise<void> {
  if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe !== 'function') return;
  const days = Math.max(1, Math.round(opts.rentalDays));

  for (const anc of opts.ancillaries) {
    if (anc.preVatTotal <= 0) continue;
    const vatAmt = round2(anc.preVatTotal * 0.05);
    const grossAmt = round2(anc.preVatTotal + vatAmt);
    await withSavepoint(
      tx,
      'handover_ins_anc_charge',
      () =>
        tx.$executeRawUnsafe(
          `INSERT INTO rental_additional_charges
             (id, tenant_id, agreement_id, charge_type, description, quantity, amount,
              vat_rate, vat_amount, total_amount, billed_to_customer, created_by, created_at)
           VALUES
             ($1, $2, $3, 'ANCILLARY', $4, $5, $6, 5, $7, $8, true, $9, NOW())`,
          crypto.randomUUID(),
          opts.tenantId,
          opts.agreementId,
          `Ancillary — ${anc.name} (${anc.code})`,
          anc.chargeQty,
          anc.dailyRate,
          vatAmt,
          grossAmt,
          opts.actorUserId,
        ),
      0,
    );
  }

  for (const drv of opts.drivers) {
    if (drv.totalFee <= 0 || drv.dailyFee <= 0) continue;
    const preVat = round2(drv.dailyFee * days);
    const vatAmt = round2(preVat * 0.05);
    const grossAmt = round2(preVat + vatAmt);
    await withSavepoint(
      tx,
      'handover_ins_drv_charge',
      () =>
        tx.$executeRawUnsafe(
          `INSERT INTO rental_additional_charges
             (id, tenant_id, agreement_id, charge_type, description, quantity, amount,
              vat_rate, vat_amount, total_amount, billed_to_customer, created_by, created_at)
           VALUES
             ($1, $2, $3, 'ADDITIONAL_DRIVER', $4, $5, $6, 5, $7, $8, true, $9, NOW())`,
          crypto.randomUUID(),
          opts.tenantId,
          opts.agreementId,
          `Additional Driver — ${drv.fullName} (DL ${drv.drivingLicenseNo})`,
          days,
          drv.dailyFee,
          vatAmt,
          grossAmt,
          opts.actorUserId,
        ),
      0,
    );
  }
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const bookingId = sp.get('bookingId');
      const search = sp.get('search')?.trim() ?? '';

      const clauses: string[] = [
        'rb.tenant_id::text = $1',
        'rb.deleted_at IS NULL',
        "rb.status IN ('CONFIRMED', 'PENDING')",
      ];
      const params: unknown[] = [tenantId];
      let idx = 2;

      if (bookingId) {
        clauses.push(`rb.id = $${idx++}`);
        params.push(bookingId);
      }
      if (search) {
        const escaped = escapeIlikePattern(search);
        clauses.push(
          `(COALESCE(rb.booking_ref, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.full_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.company_name, '') ILIKE $${idx} ESCAPE '\\')`,
        );
        params.push(`%${escaped}%`);
        idx++;
      }

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           rb.id,
           rb.booking_ref,
           rb.customer_id,
           rb.vehicle_id,
           rb.vehicle_category,
           rb.pickup_date,
           rb.dropoff_date,
           rb.pickup_location,
           rb.dropoff_location,
           rb.total_days,
           rb.daily_rate,
           rb.total_amount,
           rb.currency,
           rb.status,
           rb.channel,
           rc.full_name AS customer_name,
           rc.company_name,
           rc.phone AS customer_phone,
           rc.email AS customer_email,
           COALESCE(v.plate_number, v.license_plate, v.registration_no) AS plate_number,
           v.make AS vehicle_make,
           v.model AS vehicle_model,
           v.current_mileage AS vehicle_mileage,
           pa.id::text AS preauth_id,
           pa.amount::text AS preauth_amount,
           pa.authorization_code AS preauth_code,
           pa.card_brand AS preauth_card_brand,
           pa.card_last4 AS preauth_card_last4,
           pa.status AS preauth_status
         FROM rental_bookings rb
         LEFT JOIN rental_customers rc ON rc.id = rb.customer_id AND rc.tenant_id::text = rb.tenant_id::text
         LEFT JOIN vehicles v ON v.id = rb.vehicle_id AND v.tenant_id::text = rb.tenant_id::text
         LEFT JOIN LATERAL (
           SELECT id, amount, authorization_code, card_brand, card_last4, status
             FROM rac_card_preauths
            WHERE booking_id = rb.id AND tenant_id::text = $1
            ORDER BY CASE WHEN status = 'AUTHORIZED' THEN 0 ELSE 1 END, created_at DESC
            LIMIT 1
         ) pa ON true
         WHERE ${clauses.join(' AND ')}
         ORDER BY rb.pickup_date ASC
         LIMIT 100`,
        ...params,
      );

      const bookings = rows.map((r) => ({
        id: String(r.id),
        bookingRef: (r.booking_ref as string | null) ?? null,
        customerId: String(r.customer_id),
        vehicleId: (r.vehicle_id as string | null) ?? null,
        vehicleCategory: (r.vehicle_category as string | null) ?? 'ECONOMY',
        pickupDate: r.pickup_date ? new Date(String(r.pickup_date)).toISOString() : null,
        dropoffDate: r.dropoff_date ? new Date(String(r.dropoff_date)).toISOString() : null,
        pickupLocation: (r.pickup_location as string | null) ?? null,
        dropoffLocation: (r.dropoff_location as string | null) ?? null,
        totalDays: Number(r.total_days ?? 1),
        dailyRate: Number(r.daily_rate ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
        currency: String(r.currency ?? 'AED'),
        status: String(r.status ?? 'CONFIRMED'),
        channel: (r.channel as string | null) ?? 'DIRECT',
        customer: {
          id: String(r.customer_id),
          fullName: (r.customer_name as string | null) ?? '',
          companyName: (r.company_name as string | null) ?? null,
          phone: (r.customer_phone as string | null) ?? null,
          email: (r.customer_email as string | null) ?? null,
        },
        vehicle: r.vehicle_id
          ? {
              id: String(r.vehicle_id),
              plateNumber: (r.plate_number as string | null) ?? null,
              make: (r.vehicle_make as string | null) ?? null,
              model: (r.vehicle_model as string | null) ?? null,
              currentMileage: Number(r.vehicle_mileage ?? 0),
            }
          : null,
        preauth: r.preauth_id
          ? {
              id: String(r.preauth_id),
              amount: Number(r.preauth_amount ?? 0),
              authorizationCode: String(r.preauth_code ?? ''),
              cardBrand: (r.preauth_card_brand as string | null) ?? null,
              cardLast4: (r.preauth_card_last4 as string | null) ?? null,
              status: String(r.preauth_status ?? 'AUTHORIZED'),
            }
          : null,
        ancillaries: [] as unknown[],
        additionalDrivers: [] as unknown[],
      }));

      if (bookings.length > 0 && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const bookingIds = bookings.map((b) => b.id);
        const extraCols = await withSavepoint<
          Array<{ id: string; ancillaries: unknown; additional_drivers: unknown }>
        >(
          tx,
          'handover_get_bk_extras',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, ancillaries, additional_drivers
                 FROM rental_bookings
                WHERE tenant_id::text = $1
                  AND id::text = ANY($2::text[])`,
              tenantId,
              bookingIds,
            ),
          [],
        );
        const byBkId = new Map(extraCols.map((e) => [e.id, e]));
        for (const bk of bookings) {
          const ex = byBkId.get(bk.id);
          if (ex && Array.isArray(ex.ancillaries)) bk.ancillaries = ex.ancillaries;
          if (ex && Array.isArray(ex.additional_drivers)) bk.additionalDrivers = ex.additional_drivers;
        }
      }

      return NextResponse.json({ bookings });
    } catch (err) {
      console.error('[counter handover GET] error:', err);
      return NextResponse.json({ error: 'Failed to load pickup queue' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const counterPermErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'counter',
    req.nextUrl.pathname,
  );
  if (counterPermErr) return counterPermErr;

  try {
    const jsonRaw = await req.json();
    const json = stripTenantOwnershipFields(
      (jsonRaw && typeof jsonRaw === 'object' ? jsonRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const isWalkIn = Boolean(!data.bookingId);

    if (isWalkIn) {
      if (!data.customerId || !data.vehicleId) {
        return NextResponse.json(
          {
            error:
              'Walk-in checkout requires customerId and vehicleId when bookingId is omitted',
          },
          { status: 400 },
        );
      }
      const walkInStart = parseIsoOrDate(data.pickupDate ?? data.startDate);
      const walkInEnd = parseIsoOrDate(data.dropoffDate ?? data.endDate);
      if (!walkInStart || !walkInEnd || walkInEnd.getTime() < walkInStart.getTime()) {
        return NextResponse.json(
          {
            error:
              'Walk-in checkout requires valid pickupDate/startDate and dropoffDate/endDate (dropoff >= pickup)',
          },
          { status: 400 },
        );
      }
      if (data.dailyRate !== undefined || data.totalAmount !== undefined) {
        const rateDenied = await requireRentalPermission(
          req.headers,
          tenantId,
          'approve',
          'rates',
          req.nextUrl.pathname,
        );
        if (rateDenied) return rateDenied;
      }
    }

    const resolvedMileageOut = data.mileageOut ?? data.pickupOdometer;
    if (resolvedMileageOut === undefined || resolvedMileageOut === null || resolvedMileageOut < 0) {
      return NextResponse.json(
        { error: 'Validation failed: mileageOut (or pickupOdometer) is required' },
        { status: 400 },
      );
    }

    const pickupFuelPct = resolveInputFuelPct(json, 'pickup', 'EIGHTHS');
    if (pickupFuelPct === null) {
      return NextResponse.json(
        { error: 'Validation failed: fuelOut (or pickupFuelLevel) is required' },
        { status: 400 },
      );
    }
    const fuelOutEighths = pctToEighths(pickupFuelPct);

    // Validate signature URL & inspection photo URLs against XSS / SSRF / SVG injection
    const safeSignatureInput = validateSafeDocumentOrSignatureUrl(data.signatureDataUrl, {
      fieldName: 'signatureDataUrl',
    });
    const safePhotoUrls: string[] = [];
    for (const rawPhoto of data.photoUrls) {
      const validated = validateSafeDocumentOrSignatureUrl(rawPhoto, { fieldName: 'photoUrl' });
      if (validated) safePhotoUrls.push(validated);
    }

    // Enforce Booking Approval workflow gate before allowing counter handover on booked reservations
    if (!isWalkIn && data.bookingId) {
      const approvalBlock = await requireApproved({
        headers: req.headers,
        tenantId,
        referenceType: 'rental_booking',
        referenceId: data.bookingId,
      });
      if (approvalBlock) return approvalBlock;
    }

    // Require customer signature on handover unless caller holds manager override (`rental:approve:agreements`)
    if (!safeSignatureInput) {
      const canBypassSignature = await hasRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'agreements',
      );
      if (!canBypassSignature) {
        return NextResponse.json(
          {
            error:
              'Customer signature is required for counter handover (requires RAC Manager override to proceed unsigned)',
          },
          { status: 400 },
        );
      }
    }

    const allowCreditOverride = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
    );
    const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'counter-staff';
    const sigStorageRef = (data.bookingId ?? data.customerId ?? 'walkin').slice(0, 36);

    // Save the signature image to storage OUTSIDE `withTenantRls` so storage I/O never holds DB locks
    let signatureUrl: string | null = null;
    if (safeSignatureInput?.startsWith('data:image/')) {
      try {
        const match = safeSignatureInput.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
        const buffer = match ? Buffer.from(match[2], 'base64') : null;
        const kind =
          buffer && buffer.length <= MAX_SIGNATURE_BYTES ? detectFileKind(buffer) : null;
        if (buffer && (kind === 'png' || kind === 'jpeg')) {
          const stored = await getStorage().upload({
            buffer,
            originalName: `sig-${sigStorageRef.slice(0, 8)}.${kind === 'png' ? 'png' : 'jpg'}`,
            mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
            prefix: `rental/handover/${sigStorageRef}`,
          });
          signatureUrl = stored.url;
        } else {
          return NextResponse.json(
            { error: 'Invalid signature image encoding (PNG or JPEG required)' },
            { status: 400 },
          );
        }
      } catch (err) {
        captureException(err, { context: 'rental.counter.handover.signature' });
      }
    } else if (safeSignatureInput) {
      signatureUrl = safeSignatureInput;
    }

    type HandoverTxSuccess = {
      kind: 'ok';
      agreement: Awaited<ReturnType<typeof prisma.rentalAgreement.findFirst>> & { id: string; agreementNo: string | null };
      bookingId: string;
      bookingRef: string | null;
      inspectionId: string;
      signatureUrl: string | null;
      linkedPreauthId: string | null;
      regulatoryReport: UaeRegulatoryReportRecord | null;
      isWalkIn: boolean;
    };
    type HandoverTxResponse =
      | { kind: 'http'; response: NextResponse }
      | HandoverTxSuccess;

    const txResult: HandoverTxResponse = await withTenantRls(prisma, tenantId, async (tx) => {
      // ── Branch A: Walk-In Direct Counter Checkout (no prior booking required) ──
      if (isWalkIn) {
        const customerId = data.customerId!;
        const vehicleId = data.vehicleId!;
        const startDate = parseIsoOrDate(data.pickupDate ?? data.startDate)!;
        const endDate = parseIsoOrDate(data.dropoffDate ?? data.endDate)!;
        const rentalDays = Math.max(
          1,
          Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000),
        );
        const category = (data.vehicleCategory?.trim() || 'ECONOMY').toUpperCase();
        const currency = (data.currency?.trim() || 'AED').toUpperCase();
        const corporateAccountId = data.corporateAccountId?.trim() || null;

        await assertRentalForeignKeysInTenant(tx, tenantId, {
          customerId,
          corporateAccountId,
          vehicleId,
          branchIds: [data.openBranchId ?? null],
        });

        const resolvedAncillaries = await resolveAncillariesInTx(
          tx,
          tenantId,
          data.ancillaries,
          data.ancillaryIds,
          rentalDays,
        );
        const validatedDrivers = assertAdditionalDriversEligible(data.additionalDrivers ?? [], {
          dropoffDate: endDate,
          rentalDays,
          vehicleCategory: category,
        });

        const customer = await tx.rentalCustomer.findFirst({
          where: { id: customerId, tenantId, deletedAt: null },
          select: { id: true, fullName: true, customerType: true },
        });
        if (!customer) {
          return {
            kind: 'http',
            response: NextResponse.json({ error: 'Customer not found' }, { status: 404 }),
          };
        }

        let baseDailyRate = data.dailyRate ?? 0;
        let baseGrossTotal = data.totalAmount ?? 0;
        if (data.dailyRate === undefined && data.totalAmount === undefined) {
          const quote = await quoteRentalRateInTx(tx, tenantId, {
            vehicleCategory: category,
            pickupDate: startDate,
            dropoffDate: endDate,
            pickupLocationCode: data.pickupLocation ?? data.openBranchId ?? undefined,
            dropoffLocationCode: data.dropoffLocation ?? data.openBranchId ?? undefined,
            customerType: customer.customerType ?? 'INDIVIDUAL',
            corporateAccountId:
              corporateAccountId ??
              (customer.customerType === 'CORPORATE' ? customer.id : undefined),
            channel: 'WALK_IN',
            currency,
          });
          baseDailyRate = quote.dailyRate;
          baseGrossTotal = quote.totalAmount;
        } else if (data.dailyRate !== undefined && data.totalAmount === undefined) {
          const sub = round2(data.dailyRate * rentalDays);
          baseGrossTotal = round2(sub + round2(sub * 0.05));
        }

        const extrasPreVat = round2(
          resolvedAncillaries.reduce((s, a) => s + a.preVatTotal, 0) +
            validatedDrivers.reduce((s, d) => s + d.totalFee, 0),
        );
        const extrasGross = round2(extrasPreVat + round2(extrasPreVat * 0.05));
        const finalTotalAmount =
          data.totalAmount !== undefined
            ? round2(data.totalAmount)
            : round2(baseGrossTotal + extrasGross);

        await assertCustomerEligibleForRental(tx, {
          tenantId,
          customerId,
          corporateAccountId,
          dropoffDate: endDate,
          vehicleCategory: category,
          additionalExposureAed: finalTotalAmount,
          allowCreditOverride,
          requireLicenseOnFile: true,
        });

        const walkInOutcome = await withRentalLock(
          tx,
          tenantId,
          { entityKey: `walkin:${customerId}:${vehicleId}`, vehicleIds: [vehicleId] },
          async () => {
            const vehRow = await tx.vehicle.findFirst({
              where: { id: vehicleId, tenantId },
              select: {
                status: true,
                isActive: true,
                licensePlate: true,
                type: true,
              },
            });
            const vehStatus = String(vehRow?.status ?? '').toUpperCase();
            if (
              vehRow?.isActive === false ||
              ['GROUNDED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DISPOSED', 'SOLD'].includes(vehStatus)
            ) {
              return {
                kind: 'conflict' as const,
                conflictError: `Vehicle is currently ${vehStatus || 'INACTIVE'} and cannot be dispatched`,
              };
            }

            const conflict = await checkVehicleRentalConflict(tx, {
              tenantId,
              vehicleId,
              startDate,
              endDate,
              checkGrounding: true,
            });
            if (conflict.hasConflict) {
              return {
                kind: 'conflict' as const,
                conflictError:
                  conflict.reason ?? 'Vehicle has an overlapping reservation or active agreement',
              };
            }

            const bookingRef = await nextRentalSerial(tx, {
              tenantId,
              series: 'RBK',
              prefix: 'RBK-',
              table: 'rental_bookings',
              column: 'booking_ref',
              padWidth: 6,
            });

            const walkInBooking = await tx.rentalBooking.create({
              data: {
                tenantId,
                bookingRef,
                customerId,
                vehicleId,
                vehicleCategory: category,
                pickupDate: startDate,
                dropoffDate: endDate,
                pickupLocation: data.pickupLocation ?? data.openBranchId ?? null,
                dropoffLocation: data.dropoffLocation ?? data.openBranchId ?? null,
                totalDays: rentalDays,
                dailyRate: baseDailyRate,
                totalAmount: finalTotalAmount,
                currency,
                status: 'ACTIVE',
                channel: 'WALK_IN',
                notes: data.notes ?? null,
              },
            });

            if (
              (resolvedAncillaries.length > 0 || validatedDrivers.length > 0) &&
              typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
            ) {
              await withSavepoint(
                tx,
                'walkin_bk_extras_json',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE rental_bookings
                        SET ancillaries = $1::jsonb,
                            additional_drivers = $2::jsonb
                      WHERE id = $3 AND tenant_id::text = $4`,
                    JSON.stringify(resolvedAncillaries),
                    JSON.stringify(validatedDrivers),
                    walkInBooking.id,
                    tenantId,
                  ),
                0,
              );
            }

            const agreementNo = await nextRentalSerial(tx, {
              tenantId,
              series: 'RA',
              prefix: 'RA-',
              table: 'rental_agreements',
              column: 'agreement_no',
            });

            const signed = Boolean(signatureUrl || safeSignatureInput);
            const agreement = await tx.rentalAgreement.create({
              data: {
                tenantId,
                agreementNo,
                bookingId: walkInBooking.id,
                customerId,
                vehicleId,
                startDate,
                endDate,
                dailyRate: baseDailyRate,
                totalAmount: finalTotalAmount,
                currency,
                mileageOut: resolvedMileageOut,
                fuelOut: pickupFuelPct,
                status: 'ACTIVE',
                signedAt: signed ? new Date() : null,
                signedBy: signed ? actorUserId : null,
                openBranchId: data.openBranchId ?? null,
                notes: data.notes,
                sourceType: 'WALK_IN',
                ...(corporateAccountId ? { corporateAccountId, isCorporate: true } : {}),
                ...(data.securityDeposit !== undefined
                  ? { securityDeposit: data.securityDeposit }
                  : {}),
                ...(data.depositStatus !== undefined
                  ? { depositStatus: data.depositStatus }
                  : {}),
              },
            });

            await tx.$executeRawUnsafe(
              `UPDATE rental_agreements
                  SET mileage_out = $1,
                      pickup_odometer = $1,
                      fuel_out = $2,
                      pickup_fuel_level = $2,
                      channel = 'WALK_IN',
                      updated_at = NOW()
                WHERE id = $3 AND tenant_id::text = $4`,
              resolvedMileageOut,
              pickupFuelPct,
              agreement.id,
              tenantId,
            );

            if (validatedDrivers.length > 0) {
              await persistAdditionalDriversInTx(tx, {
                tenantId,
                bookingId: walkInBooking.id,
                agreementId: agreement.id,
                drivers: validatedDrivers,
              });
            }

            await insertExtraChargesForAgreementInTx(tx, {
              tenantId,
              agreementId: agreement.id,
              rentalDays,
              ancillaries: resolvedAncillaries,
              drivers: validatedDrivers,
              actorUserId,
            });

            const inspectionId = crypto.randomUUID();
            await tx.$executeRawUnsafe(
              `INSERT INTO vehicle_inspections
                 (id, tenant_id, booking_id, type, mileage, fuel_level, damages, inspector, notes,
                  photos, damage_markers, checklist_items, signature_url, created_at)
               VALUES
                 ($1, $2, $3, 'checkin', $4, $5, $6, $7, $8,
                  $9, $10::jsonb, $11::jsonb, $12, NOW())`,
              inspectionId,
              tenantId,
              walkInBooking.id,
              resolvedMileageOut,
              pickupFuelPct,
              data.damageMarkers.length > 0 ? JSON.stringify(data.damageMarkers) : null,
              actorUserId,
              data.notes ?? null,
              JSON.stringify(safePhotoUrls),
              JSON.stringify(data.damageMarkers),
              JSON.stringify(data.checklist ?? {}),
              signatureUrl,
            );

            const collectedDepositAmt = Number(
              data.securityDeposit ?? agreement.securityDeposit ?? 0,
            );
            const effectiveDepStatus = String(
              data.depositStatus ?? agreement.depositStatus ?? '',
            ).toUpperCase();
            if (collectedDepositAmt > 0 && effectiveDepStatus === 'PAID') {
              await recordRacSecurityDepositCollected(tx, {
                tenantId,
                agreementId: agreement.id,
                agreementNo: agreement.agreementNo,
                customerName: customer.fullName ?? 'Rental Customer',
                vehiclePlate: vehRow?.licensePlate ?? '—',
                vehicleType: vehRow?.type ?? null,
                branch: data.openBranchId ?? 'Dubai',
                amount: collectedDepositAmt,
                collectionMethod: data.depositMethod ?? 'CARD',
                collectionDate: new Date().toISOString(),
                currency,
                preparedBy: actorUserId,
              });
            }

            await tx.vehicle.updateMany({
              where: { id: vehicleId, tenantId },
              data: {
                status: 'RENTED',
                currentMileage: BigInt(Math.round(resolvedMileageOut)),
                fuelLevel: pickupFuelPct,
              },
            });

            const regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
              tx,
              'walkin_handover_reg_report',
              () =>
                queueUaeRegulatoryReportInTx(tx, {
                  tenantId,
                  agreementId: agreement.id,
                  eventType: 'HANDOVER',
                  submittedBy: actorUserId,
                }),
              null,
            );

            const refreshedAgreement = await tx.rentalAgreement.findFirst({
              where: { id: agreement.id, tenantId },
            });

            return {
              kind: 'ok' as const,
              agreement: (refreshedAgreement ?? agreement) as HandoverTxSuccess['agreement'],
              bookingId: walkInBooking.id,
              bookingRef: walkInBooking.bookingRef,
              inspectionId,
              signatureUrl,
              linkedPreauthId: null,
              regulatoryReport,
              isWalkIn: true,
            };
          },
        );

        if (walkInOutcome.kind === 'conflict') {
          return {
            kind: 'http',
            response: NextResponse.json({ error: walkInOutcome.conflictError }, { status: 409 }),
          };
        }
        return walkInOutcome;
      }

      // ── Branch B: Booked Reservation Counter Handover ──
      const bookingId = data.bookingId!;
      const booking = await tx.rentalBooking.findFirst({
        where: { id: bookingId, tenantId, deletedAt: null },
      });
      if (!booking) {
        return {
          kind: 'http',
          response: NextResponse.json({ error: 'Booking not found' }, { status: 404 }),
        };
      }

      const bookingStatus = String(booking.status ?? '').toUpperCase();
      if (bookingStatus !== 'PENDING' && bookingStatus !== 'CONFIRMED') {
        return {
          kind: 'http',
          response: NextResponse.json(
            { error: `Cannot hand over a booking in status ${booking.status}` },
            { status: 409 },
          ),
        };
      }

      const vehicleId = data.vehicleId ?? booking.vehicleId ?? null;
      if (!vehicleId) {
        return {
          kind: 'http',
          response: NextResponse.json(
            { error: 'A physical vehicle must be assigned before counter handover' },
            { status: 400 },
          ),
        };
      }

      // Verify customer, vehicle, and branch strictly belong to this tenant
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: booking.customerId,
        vehicleId,
        branchIds: [data.openBranchId ?? null],
      });

      const rentalDays = Math.max(
        1,
        Number(booking.totalDays ?? 0) ||
          Math.ceil(
            (booking.dropoffDate.getTime() - booking.pickupDate.getTime()) / 86_400_000,
          ),
      );

      const deskAncillaries = await resolveAncillariesInTx(
        tx,
        tenantId,
        data.ancillaries,
        data.ancillaryIds,
        rentalDays,
      );
      const deskDrivers =
        data.additionalDrivers !== undefined
          ? assertAdditionalDriversEligible(data.additionalDrivers, {
              dropoffDate: booking.dropoffDate,
              rentalDays,
              vehicleCategory: booking.vehicleCategory,
            })
          : [];

      const deskExtrasPreVat = round2(
        deskAncillaries.reduce((s, a) => s + a.preVatTotal, 0) +
          deskDrivers.reduce((s, d) => s + d.totalFee, 0),
      );
      const deskExtrasGross = round2(deskExtrasPreVat + round2(deskExtrasPreVat * 0.05));
      const updatedBookingTotal = round2(Number(booking.totalAmount ?? 0) + deskExtrasGross);

      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId: booking.customerId,
        dropoffDate: booking.dropoffDate,
        vehicleCategory: booking.vehicleCategory,
        additionalExposureAed: updatedBookingTotal,
        excludeBookingId: booking.id,
        allowCreditOverride,
        requireLicenseOnFile: true,
      });

      const existingAgreement = await tx.rentalAgreement.findFirst({
        where: { bookingId: booking.id, tenantId },
        select: {
          id: true,
          agreementNo: true,
          securityDeposit: true,
          depositStatus: true,
          vehicleId: true,
        },
      });

      const priorVehicleId = booking.vehicleId ?? existingAgreement?.vehicleId ?? null;

      const outcome = await withRentalLock(
        tx,
        tenantId,
        { entityKey: booking.id, vehicleIds: [priorVehicleId, vehicleId] },
        async () => {
          // 1a. Verify vehicle row is not grounded / in maintenance / out-of-service
          const vehRow = await tx.vehicle.findFirst({
            where: { id: vehicleId, tenantId },
            select: {
              status: true,
              isActive: true,
              licensePlate: true,
              type: true,
            },
          });
          const vehStatus = String(vehRow?.status ?? '').toUpperCase();
          if (
            vehRow?.isActive === false ||
            ['GROUNDED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DISPOSED', 'SOLD'].includes(vehStatus)
          ) {
            return {
              kind: 'conflict' as const,
              conflictError: `Vehicle is currently ${vehStatus || 'INACTIVE'} and cannot be dispatched`,
            };
          }

          // 1b. Check physical vehicle conflict + grounding blocks (`checkGrounding: true`)
          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId,
            vehicleId,
            startDate: booking.pickupDate,
            endDate: booking.dropoffDate,
            excludeBookingId: booking.id,
            excludeAgreementId: existingAgreement?.id ?? null,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            return {
              kind: 'conflict' as const,
              conflictError:
                conflict.reason ?? 'Vehicle has an overlapping reservation or active agreement',
            };
          }

          // 2. Serialize per-tenant agreement numbering (`RA-XXXXXX`)
          const agreementNo =
            existingAgreement?.agreementNo ??
            (await nextRentalSerial(tx, {
              tenantId,
              series: 'RA',
              prefix: 'RA-',
              table: 'rental_agreements',
              column: 'agreement_no',
            }));

          const signed = Boolean(signatureUrl || safeSignatureInput);
          const agreement = existingAgreement
            ? await tx.rentalAgreement.update({
                where: { id: existingAgreement.id, tenantId },
                data: {
                  mileageOut: resolvedMileageOut,
                  fuelOut: pickupFuelPct,
                  status: 'ACTIVE',
                  signedAt: signed ? new Date() : null,
                  signedBy: signed ? actorUserId : null,
                  openBranchId: data.openBranchId ?? null,
                  notes: data.notes,
                  vehicleId,
                  ...(deskExtrasGross > 0 ? { totalAmount: updatedBookingTotal } : {}),
                  ...(data.securityDeposit !== undefined
                    ? { securityDeposit: data.securityDeposit }
                    : {}),
                  ...(data.depositStatus !== undefined
                    ? { depositStatus: data.depositStatus }
                    : {}),
                },
              })
            : await tx.rentalAgreement.create({
                data: {
                  tenantId,
                  agreementNo,
                  bookingId,
                  customerId: booking.customerId,
                  vehicleId,
                  startDate: booking.pickupDate,
                  endDate: booking.dropoffDate,
                  dailyRate: booking.dailyRate,
                  totalAmount: deskExtrasGross > 0 ? updatedBookingTotal : booking.totalAmount,
                  currency: booking.currency,
                  mileageOut: resolvedMileageOut,
                  fuelOut: pickupFuelPct,
                  status: 'ACTIVE',
                  signedAt: signed ? new Date() : null,
                  signedBy: signed ? actorUserId : null,
                  openBranchId: data.openBranchId ?? null,
                  notes: data.notes,
                  sourceType: 'BOOKING',
                  ...(data.securityDeposit !== undefined
                    ? { securityDeposit: data.securityDeposit }
                    : {}),
                  ...(data.depositStatus !== undefined
                    ? { depositStatus: data.depositStatus }
                    : {}),
                },
              });

          // 3. Sync canonical `0..100%` fuel + odometer km across BOTH column pairs
          await tx.$executeRawUnsafe(
            `UPDATE rental_agreements
                SET mileage_out = $1,
                    pickup_odometer = $1,
                    fuel_out = $2,
                    pickup_fuel_level = $2,
                    channel = COALESCE(channel, $3),
                    updated_at = NOW()
              WHERE id = $4 AND tenant_id::text = $5`,
            resolvedMileageOut,
            pickupFuelPct,
            booking.channel ?? 'DIRECT',
            agreement.id,
            tenantId,
          );

          // 3b. Persist additional drivers & ancillaries onto agreement (from desk payload or pre-booked)
          let effectiveAncillaries = deskAncillaries;
          if (
            effectiveAncillaries.length === 0 &&
            typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function'
          ) {
            const bkJsonRows = await withSavepoint<Array<{ ancillaries: unknown }>>(
              tx,
              'handover_read_bk_anc',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT ancillaries FROM rental_bookings WHERE id = $1 AND tenant_id::text = $2 LIMIT 1`,
                  booking.id,
                  tenantId,
                ),
              [],
            );
            if (Array.isArray(bkJsonRows[0]?.ancillaries) && bkJsonRows[0].ancillaries.length > 0) {
              effectiveAncillaries = await resolveAncillariesInTx(
                tx,
                tenantId,
                bkJsonRows[0].ancillaries as Array<z.infer<typeof ancillaryItemSchema>>,
                undefined,
                rentalDays,
              );
            }
          }

          if (deskDrivers.length > 0) {
            await persistAdditionalDriversInTx(tx, {
              tenantId,
              bookingId: booking.id,
              agreementId: agreement.id,
              drivers: deskDrivers,
            });
          } else if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
            // Link any pre-booked additional drivers to the newly activated agreement
            await withSavepoint(
              tx,
              'handover_link_bk_drivers',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_additional_drivers
                      SET agreement_id = $1
                    WHERE booking_id = $2
                      AND tenant_id::text = $3
                      AND agreement_id IS NULL`,
                  agreement.id,
                  booking.id,
                  tenantId,
                ),
              0,
            );
          }

          let preBookedDriversForCharges: ValidatedAdditionalDriver[] = deskDrivers;
          if (
            preBookedDriversForCharges.length === 0 &&
            typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function'
          ) {
            const drvRows = await withSavepoint<
              Array<{
                full_name: string;
                driving_license_no: string;
                daily_fee: string | number;
                total_fee: string | number;
              }>
            >(
              tx,
              'handover_read_bk_drivers',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT full_name, driving_license_no, daily_fee, total_fee
                     FROM rental_additional_drivers
                    WHERE agreement_id = $1 AND tenant_id::text = $2`,
                  agreement.id,
                  tenantId,
                ),
              [],
            );
            preBookedDriversForCharges = drvRows.map((d) => ({
              fullName: d.full_name,
              nationality: null,
              dateOfBirth: null,
              emiratesId: null,
              passportNo: null,
              drivingLicenseNo: d.driving_license_no,
              licenseIssuingCountry: 'AE',
              licenseExpiry:
                booking.dropoffDate instanceof Date
                  ? booking.dropoffDate.toISOString().slice(0, 10)
                  : String(booking.dropoffDate ?? '').slice(0, 10),
              internationalPermitNo: null,
              internationalPermitExpiry: null,
              dailyFee: Number(d.daily_fee ?? 0),
              totalFee: Number(d.total_fee ?? 0),
            }));
          }

          await insertExtraChargesForAgreementInTx(tx, {
            tenantId,
            agreementId: agreement.id,
            rentalDays,
            ancillaries: effectiveAncillaries,
            drivers: preBookedDriversForCharges,
            actorUserId,
          });

          if (
            (deskAncillaries.length > 0 || deskDrivers.length > 0) &&
            typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
          ) {
            await withSavepoint(
              tx,
              'handover_upd_bk_extras_json',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_bookings
                      SET ancillaries = CASE WHEN $1::int > 0 THEN $2::jsonb ELSE ancillaries END,
                          additional_drivers = CASE WHEN $3::int > 0 THEN $4::jsonb ELSE additional_drivers END
                    WHERE id = $5 AND tenant_id::text = $6`,
                  deskAncillaries.length,
                  JSON.stringify(deskAncillaries),
                  deskDrivers.length,
                  JSON.stringify(deskDrivers),
                  booking.id,
                  tenantId,
                ),
              0,
            );
          }

          // 4. Persist pick-up inspection properly
          const inspectionId = crypto.randomUUID();
          await tx.$executeRawUnsafe(
            `INSERT INTO vehicle_inspections
               (id, tenant_id, booking_id, type, mileage, fuel_level, damages, inspector, notes,
                photos, damage_markers, checklist_items, signature_url, created_at)
             VALUES
               ($1, $2, $3, 'checkin', $4, $5, $6, $7, $8,
                $9, $10::jsonb, $11::jsonb, $12, NOW())`,
            inspectionId,
            tenantId,
            booking.id,
            resolvedMileageOut,
            pickupFuelPct,
            data.damageMarkers.length > 0 ? JSON.stringify(data.damageMarkers) : null,
            actorUserId,
            data.notes ?? null,
            JSON.stringify(safePhotoUrls),
            JSON.stringify(data.damageMarkers),
            JSON.stringify(data.checklist ?? {}),
            signatureUrl,
          );

          // 5. Link any AUTHORIZED card pre-auth holds on booking.id (off-balance-sheet bank hold)
          const linkedPreauths = await tx.$queryRawUnsafe<
            Array<{
              id: string;
              amount: string;
              authorization_code: string;
              card_last4: string | null;
              card_token: string | null;
            }>
          >(
            `UPDATE rac_card_preauths
                SET agreement_id = $1, updated_at = NOW()
              WHERE booking_id = $2
                AND tenant_id::text = $3
                AND customer_id::text = $4
                AND status = 'AUTHORIZED'
              RETURNING id::text AS id, amount::text AS amount, authorization_code, card_last4, card_token`,
            agreement.id,
            booking.id,
            tenantId,
            booking.customerId,
          );

          if (linkedPreauths.length > 0) {
            const pa = linkedPreauths[0];
            await tx.$executeRawUnsafe(
              `UPDATE rental_agreements
                  SET security_deposit = COALESCE(NULLIF(security_deposit, 0), $1),
                      deposit_status = 'PAID',
                      authorization_code = COALESCE(authorization_code, $2),
                      credit_card_last4 = COALESCE(credit_card_last4, $3),
                      credit_card_token = COALESCE(credit_card_token, $4),
                      updated_at = NOW()
                WHERE id = $5 AND tenant_id::text = $6`,
              Number(pa.amount),
              pa.authorization_code,
              pa.card_last4,
              pa.card_token,
              agreement.id,
              tenantId,
            );
          } else {
            // If an actual cash/card deposit (NOT a pre-auth hold) was collected, sync finance_security_deposits + GL (CR 2150)
            const collectedDepositAmt = Number(
              data.securityDeposit ?? agreement.securityDeposit ?? 0,
            );
            const effectiveDepStatus = String(
              data.depositStatus ?? agreement.depositStatus ?? '',
            ).toUpperCase();
            if (collectedDepositAmt > 0 && effectiveDepStatus === 'PAID') {
              const cust = await tx.rentalCustomer.findFirst({
                where: { id: booking.customerId, tenantId },
                select: { fullName: true },
              });
              await recordRacSecurityDepositCollected(tx, {
                tenantId,
                agreementId: agreement.id,
                agreementNo: agreement.agreementNo,
                customerName: cust?.fullName ?? 'Rental Customer',
                vehiclePlate: vehRow?.licensePlate ?? '—',
                vehicleType: vehRow?.type ?? null,
                branch: data.openBranchId ?? 'Dubai',
                amount: collectedDepositAmt,
                collectionMethod: data.depositMethod ?? 'CARD',
                collectionDate: new Date().toISOString(),
                currency: booking.currency ?? 'AED',
                preparedBy: actorUserId,
              });
            }
          }

          // 6. Update booking status to ACTIVE & vehicleId (tenant-scoped)
          await tx.rentalBooking.update({
            where: { id: bookingId, tenantId },
            data: {
              status: 'ACTIVE',
              ...(vehicleId !== booking.vehicleId ? { vehicleId } : {}),
              ...(deskExtrasGross > 0 ? { totalAmount: updatedBookingTotal } : {}),
              updatedAt: new Date(),
            },
          });

          // 6b. Plate-swap leak fix: if a different vehicle was previously reserved on the booking, release it safely
          if (priorVehicleId && priorVehicleId !== vehicleId) {
            await withSavepoint(
              tx,
              'handover_release_prior_veh',
              async () => {
                const { status: safeOldStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: priorVehicleId,
                  excludeAgreementId: agreement.id,
                  excludeBookingId: booking.id,
                });
                await tx.vehicle.updateMany({
                  where: {
                    id: priorVehicleId,
                    tenantId,
                    status: { in: ['RESERVED', 'RENTED'] },
                  },
                  data: { status: safeOldStatus },
                });
              },
              undefined,
            );
          }

          // 7. Update assigned vehicle status to RENTED and sync currentMileage + fuelLevel
          await tx.vehicle.updateMany({
            where: { id: vehicleId, tenantId },
            data: {
              status: 'RENTED',
              currentMileage: BigInt(Math.round(resolvedMileageOut)),
              fuelLevel: pickupFuelPct,
            },
          });

          // 8. Queue UAE Tarrashud / ITC regulatory manifest inside transaction
          const regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
            tx,
            'handover_reg_report',
            () =>
              queueUaeRegulatoryReportInTx(tx, {
                tenantId,
                agreementId: agreement.id,
                eventType: 'HANDOVER',
                submittedBy: actorUserId,
              }),
            null,
          );

          const refreshedAgreement = await tx.rentalAgreement.findFirst({
            where: { id: agreement.id, tenantId },
          });

          return {
            kind: 'ok' as const,
            agreement: (refreshedAgreement ?? agreement) as HandoverTxSuccess['agreement'],
            bookingId: booking.id,
            bookingRef: booking.bookingRef,
            inspectionId,
            signatureUrl,
            linkedPreauthId: linkedPreauths[0]?.id ?? null,
            regulatoryReport,
            isWalkIn: false,
          };
        },
      );

      if (outcome.kind === 'conflict') {
        return {
          kind: 'http',
          response: NextResponse.json({ error: outcome.conflictError }, { status: 409 }),
        };
      }

      return outcome;
    });

    if (txResult.kind === 'http') {
      return txResult.response;
    }

    // Post-commit external regulatory dispatch (strictly OUTSIDE `withTenantRls`)
    let finalRegReport = txResult.regulatoryReport;
    if (finalRegReport?.status === 'QUEUED') {
      try {
        finalRegReport = await dispatchUaeRegulatoryReportOutsideRls(finalRegReport);
      } catch (regErr) {
        captureException(regErr, { context: 'rental.counter.handover.tarrashud' });
      }
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalAgreement',
      entityId: txResult.agreement.id,
      entityName: txResult.agreement.agreementNo ?? undefined,
      action: 'CREATE',
      details: `Counter handover${txResult.isWalkIn ? ' (WALK-IN)' : ''}: agreement ${txResult.agreement.agreementNo} (booking ${txResult.bookingRef ?? txResult.bookingId.slice(0, 8)}), mileageOut=${resolvedMileageOut}, fuelOut=${pickupFuelPct}% (${fuelOutEighths}/8), ${data.damageMarkers.length} damage marker(s), ${safePhotoUrls.length} photo(s)${txResult.signatureUrl ? ', signed' : ', manager-override unsigned'}.`,
    });

    return NextResponse.json(
      {
        ok: true,
        walkIn: txResult.isWalkIn,
        bookingId: txResult.bookingId,
        bookingRef: txResult.bookingRef,
        agreement: txResult.agreement,
        inspectionId: txResult.inspectionId,
        signatureUrl: txResult.signatureUrl,
        linkedPreauthId: txResult.linkedPreauthId,
        regulatoryReport: finalRegReport,
        bookingStatus: 'ACTIVE',
      },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'rental.counter.handover' });
    console.error('[counter handover] error:', err);
    return NextResponse.json({ error: 'Handover submission failed' }, { status: 500 });
  }
}
