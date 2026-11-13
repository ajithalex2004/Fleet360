export const dynamic = 'force-dynamic';

/**
 * GET / POST /api/rental/bookings/[id]/cross-border-permit
 *
 * Stateful Cross-Border NOC Permits & Oman/GCC Orange Card Insurance:
 *   - `GET` (without `destination` or with `format=json`): Lists persisted
 *     `rental_cross_border_permits` for the booking or agreement in `tenantId`.
 *   - `GET` (with `destination=OMAN|KSA|BAHRAIN|QATAR|KUWAIT`): Generates a
 *     bilingual cross-border travel permit PDF populated with real UAE KYC
 *     (`emirates_id`, `passport_no`, `visa_type`) and verified Mulkiya/Insurance.
 *   - `POST`: Validates customer eligibility (requiring `rental:approve:customers`
 *     for credit overrides), verifies assigned vehicle Mulkiya (`registrationExpiry`)
 *     and `insuranceExpiry` cover `returnDate`, allocates `CBP-...` via `lockSerialSeries`
 *     (`nextRentalSerial`), persists `rental_cross_border_permits`, and records the
 *     permit + Orange Card fee on `rental_additional_charges` when an agreement exists.
 */

import crypto from 'node:crypto';
import { createElement } from 'react';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import {
  CrossBorderPermitPdf,
  type CrossBorderPermitPdfData,
} from '@/lib/pdf/templates/cross-border-permit';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';
import { logAudit } from '@/lib/audit';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  RentalSecurityError,
  assertCustomerEligibleForRental,
  isRentalSecurityError,
  sanitizeDownloadFilename,
} from '@/lib/rental/security-guards';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  phone: '+971 4 000 0000',
  email: 'rental@fleet360.app',
  trn: '',
};

const DESTINATION_LABELS: Record<string, { en: string; ar: string }> = {
  OMAN: { en: 'Sultanate of Oman', ar: 'سلطنة عُمان' },
  KSA: { en: 'Kingdom of Saudi Arabia', ar: 'المملكة العربية السعودية' },
  BAHRAIN: { en: 'Kingdom of Bahrain', ar: 'مملكة البحرين' },
  QATAR: { en: 'State of Qatar', ar: 'دولة قطر' },
  KUWAIT: { en: 'State of Kuwait', ar: 'دولة الكويت' },
};

const DEFAULT_ORANGE_CARD_FEES: Record<string, number> = {
  OMAN: 150,
  KSA: 250,
  BAHRAIN: 200,
  QATAR: 200,
  KUWAIT: 250,
};

const DEFAULT_PERMIT_NOC_FEE = 100;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseSettingsJson(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function resolvePermitVendor(tx: TxClient, tenantId: string) {
  const tenantRecord =
    typeof tx.tenant?.findUnique === 'function'
      ? await withSavepoint(
          tx,
          'xbp_tenant_prisma',
          () =>
            tx.tenant.findUnique({
              where: { id: tenantId },
              select: {
                name: true,
                address: true,
                contactEmail: true,
                contactPhone: true,
                trn: true,
              },
            }),
          null,
        )
      : null;

  const rawRows = await withSavepoint<Array<Record<string, unknown>>>(
    tx,
    'xbp_tenant_raw',
    () =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT * FROM tenants WHERE id = $1 LIMIT 1',
        tenantId,
      ),
    [],
  );
  const rawTenant = rawRows[0] ?? null;
  const settings = parseSettingsJson(rawTenant?.settings);

  return {
    name: pickStr(tenantRecord?.name, rawTenant?.name, VENDOR.name),
    tagline: VENDOR.tagline,
    address: pickStr(tenantRecord?.address, rawTenant?.address, settings?.address, VENDOR.address),
    phone: pickStr(
      tenantRecord?.contactPhone,
      rawTenant?.contact_phone,
      rawTenant?.phone,
      settings?.phone,
      VENDOR.phone,
    ),
    email: pickStr(
      tenantRecord?.contactEmail,
      rawTenant?.contact_email,
      rawTenant?.email,
      settings?.email,
      VENDOR.email,
    ),
    trn: pickStr(
      tenantRecord?.trn,
      rawTenant?.trn,
      rawTenant?.tax_registration_number,
      rawTenant?.vat_number,
      settings?.trn,
      settings?.taxRegistrationNumber,
      settings?.vatNumber,
      VENDOR.trn,
    ),
  };
}

interface CustomerKycSnapshot {
  emirates_id: string | null;
  passport_no: string | null;
  passport_expiry: Date | string | null;
  visa_type: string | null;
}

async function fetchCustomerKycSnapshot(
  tx: TxClient,
  tenantId: string,
  customerId: string,
): Promise<CustomerKycSnapshot | null> {
  if (typeof tx.$queryRawUnsafe !== 'function') return null;
  const rows = await withSavepoint<CustomerKycSnapshot[]>(
    tx,
    'xbp_customer_kyc',
    () =>
      tx.$queryRawUnsafe<CustomerKycSnapshot[]>(
        `SELECT emirates_id, passport_no, passport_expiry, visa_type
           FROM rental_customers
          WHERE id::text = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        customerId,
        tenantId,
      ),
    [],
  );
  return rows[0] ?? null;
}

async function assertVehicleMulkiyaAndInsuranceCoverReturn(
  tx: TxClient,
  tenantId: string,
  vehicleId: string,
  vehicleRecord: Record<string, unknown>,
  returnDate: Date,
): Promise<{ mulkiyaVerified: boolean; insuranceVerified: boolean }> {
  let rawVeh: Record<string, unknown> | null = null;
  if (typeof tx.$queryRawUnsafe === 'function') {
    const rows = await withSavepoint<Array<Record<string, unknown>>>(
      tx,
      'xbp_vehicle_compliance',
      () =>
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT *
             FROM vehicles
            WHERE id::text = $1
              AND tenant_id = $2
            LIMIT 1`,
          vehicleId,
          tenantId,
        ),
      [],
    );
    rawVeh = rows[0] ?? null;
  }

  const regExpiryRaw =
    rawVeh?.registration_expiry ??
    rawVeh?.registrationExpiry ??
    rawVeh?.mulkiya_expiry ??
    rawVeh?.mulkiyaExpiry ??
    vehicleRecord.registrationExpiry ??
    null;

  const insExpiryRaw =
    rawVeh?.insurance_expiry ??
    rawVeh?.insuranceExpiry ??
    vehicleRecord.insuranceExpiry ??
    null;

  if (regExpiryRaw) {
    const regExp = new Date(String(regExpiryRaw));
    if (!Number.isNaN(regExp.getTime())) {
      regExp.setUTCHours(23, 59, 59, 999);
      if (regExp.getTime() < returnDate.getTime()) {
        throw new RentalSecurityError(
          422,
          'VEHICLE_REGISTRATION_EXPIRED',
          `Vehicle registration (Mulkiya) expires (${regExp.toISOString().slice(0, 10)}) before cross-border return date (${returnDate.toISOString().slice(0, 10)})`,
        );
      }
    }
  }

  if (insExpiryRaw) {
    const insExp = new Date(String(insExpiryRaw));
    if (!Number.isNaN(insExp.getTime())) {
      insExp.setUTCHours(23, 59, 59, 999);
      if (insExp.getTime() < returnDate.getTime()) {
        throw new RentalSecurityError(
          422,
          'VEHICLE_INSURANCE_EXPIRED',
          `Vehicle insurance expires (${insExp.toISOString().slice(0, 10)}) before cross-border return date (${returnDate.toISOString().slice(0, 10)})`,
        );
      }
    }
  }

  return { mulkiyaVerified: true, insuranceVerified: true };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const format = (sp.get('format') ?? '').trim().toLowerCase();
  const destinationParam = (sp.get('destination') ?? '').trim().toUpperCase();

  // Mode A: List persisted cross-border permits when `format=json` or `destination` is omitted
  if (format === 'json' || (!destinationParam && format !== 'pdf')) {
    const viewPermErr = await requireRentalPermission(
      req.headers,
      tenantId,
      'view',
      'agreements',
      req.nextUrl.pathname,
    );
    if (viewPermErr) return viewPermErr;

    try {
      const permits = await withTenantRls(prisma, tenantId, async (tx) => {
        return withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'xbp_list_permits',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT p.id::text AS id,
                      p.tenant_id AS "tenantId",
                      p.permit_no AS "permitNo",
                      p.booking_id AS "bookingId",
                      p.agreement_id AS "agreementId",
                      p.customer_id AS "customerId",
                      p.vehicle_id AS "vehicleId",
                      p.destination_country AS "destinationCountry",
                      p.border_post AS "borderPost",
                      p.departure_date AS "departureDate",
                      p.return_date AS "returnDate",
                      p.orange_card_policy_no AS "orangeCardPolicyNo",
                      p.orange_card_fee::float8 AS "orangeCardFee",
                      p.permit_fee::float8 AS "permitFee",
                      p.total_fee::float8 AS "totalFee",
                      p.mulkiya_verified AS "mulkiyaVerified",
                      p.insurance_verified AS "insuranceVerified",
                      p.status,
                      p.issued_by AS "issuedBy",
                      p.revoked_at AS "revokedAt",
                      p.notes,
                      p.created_at AS "createdAt",
                      p.updated_at AS "updatedAt"
                 FROM rental_cross_border_permits p
                WHERE p.tenant_id = $1
                  AND (p.booking_id = $2 OR p.agreement_id = $2)
                ORDER BY p.created_at DESC`,
              tenantId,
              id,
            ),
          [],
        );
      });

      return NextResponse.json({ permits, total: permits.length });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[cross-border-permit GET list] error:', err);
      return NextResponse.json(
        { error: 'Failed to list cross-border permits' },
        { status: 500 },
      );
    }
  }

  // Mode B: Render bilingual PDF permit for `destination`
  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const allowCreditOverride = sp.get('allowCreditOverride') === 'true';
  if (allowCreditOverride) {
    const creditOverrideErr = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
      req.nextUrl.pathname,
    );
    if (creditOverrideErr) return creditOverrideErr;
  }

  const lang: Lang = sp.get('lang') === 'ar' ? 'ar' : 'en';
  const download = sp.get('download') === '1';

  if (
    !destinationParam ||
    !Object.prototype.hasOwnProperty.call(DESTINATION_LABELS, destinationParam)
  ) {
    return jsonErr(
      'Invalid or missing required query param: destination (must be OMAN, KSA, BAHRAIN, QATAR, or KUWAIT)',
      400,
    );
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const booking = await tx.rentalBooking.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { customer: true, agreement: true },
      });
      if (!booking) return jsonErr('Booking not found', 404);

      const bkStatus = (booking.status ?? '').toUpperCase();
      if (bkStatus !== 'CONFIRMED' && bkStatus !== 'ACTIVE') {
        return jsonErr(
          `Cross-border permit can only be issued for CONFIRMED or ACTIVE bookings (current: ${booking.status})`,
          409,
        );
      }

      if (!booking.agreement || (booking.agreement.status ?? '').toUpperCase() === 'CANCELLED') {
        return jsonErr(
          'Cross-border permit requires a valid Rental Agreement on the booking',
          409,
        );
      }

      if (!booking.vehicleId) {
        return jsonErr('Cross-border permit requires an allocated vehicle on the booking', 409);
      }

      const vehicle = await tx.vehicle.findFirst({
        where: { id: booking.vehicleId, tenantId, deletedAt: null },
      });
      if (!vehicle) {
        return jsonErr('Allocated vehicle not found in tenant', 404);
      }

      const validFrom = sp.get('validFrom') ? new Date(sp.get('validFrom')!) : booking.pickupDate;
      const validUntil = sp.get('validUntil')
        ? new Date(sp.get('validUntil')!)
        : booking.dropoffDate;
      if (
        Number.isNaN(validFrom.getTime()) ||
        Number.isNaN(validUntil.getTime()) ||
        validUntil <= validFrom
      ) {
        return jsonErr('validUntil must be a valid date after validFrom', 400);
      }

      await assertVehicleMulkiyaAndInsuranceCoverReturn(
        tx,
        tenantId,
        booking.vehicleId,
        vehicle as unknown as Record<string, unknown>,
        validUntil,
      );

      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId: booking.customerId,
        dropoffDate: validUntil,
        additionalExposureAed: 0,
        allowCreditOverride,
      });

      const kyc = await fetchCustomerKycSnapshot(tx, tenantId, booking.customerId);
      const vendor = await resolvePermitVendor(tx, tenantId);
      const destLabel = DESTINATION_LABELS[destinationParam][lang];

      const persistedRows = await withSavepoint<Array<{ permit_no: string }>>(
        tx,
        'xbp_find_existing_permit_no',
        () =>
          tx.$queryRawUnsafe<Array<{ permit_no: string }>>(
            `SELECT permit_no
               FROM rental_cross_border_permits
              WHERE tenant_id = $1
                AND (booking_id = $2 OR agreement_id = $3)
                AND UPPER(destination_country) = $4
                AND status = 'ISSUED'
              ORDER BY created_at DESC
              LIMIT 1`,
            tenantId,
            id,
            booking.agreement?.id ?? null,
            destinationParam,
          ),
        [],
      );

      const permitNo =
        persistedRows[0]?.permit_no ??
        `CBP-${booking.bookingRef ?? id.slice(0, 8)}-${destinationParam.slice(0, 3)}`;

      const data: CrossBorderPermitPdfData = {
        permitNo,
        issueDate: new Date(),
        validFrom,
        validUntil,
        destinationCountry: destLabel,
        borderCrossing: sp.get('border'),
        routeOfTravel: sp.get('route'),
        purposeOfTravel: sp.get('purpose'),
        rentalAgreementRef: booking.agreement.agreementNo ?? null,
        bookingRef: booking.bookingRef,
        vendor,
        renter: {
          name: booking.customer.fullName ?? booking.customer.companyName ?? '—',
          nationality: booking.customer.nationality,
          drivingLicenseNo: booking.customer.drivingLicenseNo,
          passportNo: kyc?.passport_no ?? booking.customer.passportNo,
          emiratesId: kyc?.emirates_id ?? null,
          phone: booking.customer.phone,
        },
        vehicle: {
          make: vehicle.make ?? null,
          model: vehicle.model ?? null,
          year: vehicle.year != null ? Number(vehicle.year) : null,
          licensePlate: vehicle.licensePlate ?? null,
          vin: vehicle.vin ?? null,
          color: vehicle.color ?? null,
        },
      };

      const buffer = await renderPdf(createElement(CrossBorderPermitPdf, { data, lang }));

      void logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'RentalBooking',
        entityId: id,
        action: 'EXPORT',
        details: `Cross-border permit PDF generated: ${permitNo} → ${destLabel}, valid ${validFrom.toISOString().slice(0, 10)} to ${validUntil.toISOString().slice(0, 10)}.`,
      });

      const safeFilename = sanitizeDownloadFilename(
        `cross-border-permit-${permitNo}.pdf`,
        'cross-border-permit.pdf',
      );
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFilename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return jsonErr(err.message, err.status, err.code);
      }
      captureException(err, {
        context: 'rental.bookings.cross-border-permit',
        tags: { bookingId: id },
      });
      console.error('[cross-border-permit] error:', err);
      return jsonErr('Failed to generate cross-border permit', 500);
    }
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const { id } = await params;
  const actorId = (req.headers.get('x-user-id') ?? '').trim() || 'system';

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const allowCreditOverride = Boolean(body.allowCreditOverride);
    if (allowCreditOverride) {
      const creditOverrideErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'customers',
        req.nextUrl.pathname,
      );
      if (creditOverrideErr) return creditOverrideErr;
    }

    const destinationKey = String(
      body.destinationCountry ?? body.destination ?? '',
    )
      .trim()
      .toUpperCase();
    if (
      !destinationKey ||
      !Object.prototype.hasOwnProperty.call(DESTINATION_LABELS, destinationKey)
    ) {
      return NextResponse.json(
        {
          error:
            'Invalid or missing destinationCountry (must be OMAN, KSA, BAHRAIN, QATAR, or KUWAIT)',
        },
        { status: 400 },
      );
    }

    const borderPost =
      typeof body.borderPost === 'string' && body.borderPost.trim()
        ? body.borderPost.trim()
        : typeof body.border === 'string' && body.border.trim()
          ? body.border.trim()
          : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const orangeCardFee =
      body.orangeCardFee !== undefined && body.orangeCardFee !== null
        ? Math.max(0, round2(Number(body.orangeCardFee)))
        : DEFAULT_ORANGE_CARD_FEES[destinationKey] ?? 150;
    const permitFee =
      body.permitFee !== undefined && body.permitFee !== null
        ? Math.max(0, round2(Number(body.permitFee)))
        : DEFAULT_PERMIT_NOC_FEE;
    const totalFee = round2(orangeCardFee + permitFee);

    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      // Support issuing by bookingId OR directly by agreementId (for walk-in agreements)
      const booking = await tx.rentalBooking.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { customer: true, agreement: true },
      });

      let bookingId: string | null = booking?.id ?? null;
      let agreementId: string | null = booking?.agreement?.id ?? null;
      let agreementNo: string | null = booking?.agreement?.agreementNo ?? null;
      let customerId: string | null = booking?.customerId ?? null;
      let vehicleId: string | null =
        booking?.agreement?.vehicleId ?? booking?.vehicleId ?? null;
      let defaultDeparture: Date | null = booking?.pickupDate ?? null;
      let defaultReturn: Date | null = booking?.dropoffDate ?? null;

      if (!booking) {
        const walkInAgrRows = await withSavepoint<
          Array<{
            id: string;
            booking_id: string | null;
            agreement_no: string | null;
            customer_id: string;
            vehicle_id: string | null;
            status: string;
            start_date: Date | string;
            end_date: Date | string;
          }>
        >(
          tx,
          'xbp_walkin_agr',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, booking_id, agreement_no, customer_id, vehicle_id,
                      status, start_date, end_date
                 FROM rental_agreements
                WHERE id::text = $1
                  AND tenant_id = $2
                LIMIT 1`,
              id,
              tenantId,
            ),
          [],
        );
        const walkInAgr = walkInAgrRows[0];
        if (!walkInAgr) {
          return { error: 'Booking or rental agreement not found', status: 404 as const };
        }
        if (!['CONFIRMED', 'ACTIVE', 'DRAFT'].includes(String(walkInAgr.status).toUpperCase())) {
          return {
            error: `Cross-border permit cannot be issued for agreement in status ${walkInAgr.status}`,
            status: 409 as const,
          };
        }
        bookingId = walkInAgr.booking_id;
        agreementId = walkInAgr.id;
        agreementNo = walkInAgr.agreement_no;
        customerId = walkInAgr.customer_id;
        vehicleId = walkInAgr.vehicle_id;
        defaultDeparture = new Date(walkInAgr.start_date);
        defaultReturn = new Date(walkInAgr.end_date);
      } else {
        const bkStatus = (booking.status ?? '').toUpperCase();
        if (bkStatus !== 'CONFIRMED' && bkStatus !== 'ACTIVE') {
          return {
            error: `Cross-border permit can only be issued for CONFIRMED or ACTIVE bookings (current: ${booking.status})`,
            status: 409 as const,
          };
        }
      }

      if (!customerId) {
        return { error: 'Customer is required on booking/agreement', status: 409 as const };
      }
      if (!vehicleId) {
        return {
          error: 'Cross-border permit requires an allocated vehicle on the booking/agreement',
          status: 409 as const,
        };
      }

      const vehicle = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId, deletedAt: null },
      });
      if (!vehicle) {
        return { error: 'Allocated vehicle not found in tenant', status: 404 as const };
      }

      const departureDate = body.departureDate
        ? new Date(String(body.departureDate))
        : body.validFrom
          ? new Date(String(body.validFrom))
          : (defaultDeparture ?? new Date());
      const returnDate = body.returnDate
        ? new Date(String(body.returnDate))
        : body.validUntil
          ? new Date(String(body.validUntil))
          : (defaultReturn ?? new Date(departureDate.getTime() + 86_400_000));

      if (
        Number.isNaN(departureDate.getTime()) ||
        Number.isNaN(returnDate.getTime()) ||
        returnDate <= departureDate
      ) {
        return {
          error: 'returnDate must be a valid date after departureDate',
          status: 400 as const,
        };
      }

      // 1. Verify assigned vehicle Mulkiya (`registrationExpiry`) & `insuranceExpiry` cover `returnDate`
      const compliance = await assertVehicleMulkiyaAndInsuranceCoverReturn(
        tx,
        tenantId,
        vehicleId,
        vehicle as unknown as Record<string, unknown>,
        returnDate,
      );

      // 2. Fetch real UAE KYC fields (`emirates_id`, `passport_no`, `passport_expiry`, `visa_type`)
      const kyc = await fetchCustomerKycSnapshot(tx, tenantId, customerId);

      // 3. Enforce customer rental eligibility (with credit limit check + override permission)
      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId,
        dropoffDate: returnDate,
        additionalExposureAed: totalFee,
        excludeBookingId: bookingId ?? undefined,
        allowCreditOverride,
      });

      // 4. Serialize & allocate `CBP-...` permit number (`nextRentalSerial` locks series internally)
      const permitNo = await nextRentalSerial(tx, {
        tenantId,
        series: 'CBP',
        prefix: 'CBP-',
        table: 'rental_cross_border_permits',
        column: 'permit_no',
      });

      const orangeCardPolicyNo =
        typeof body.orangeCardPolicyNo === 'string' && body.orangeCardPolicyNo.trim()
          ? body.orangeCardPolicyNo.trim()
          : `OC-${destinationKey.slice(0, 3)}-${permitNo.replace(/^CBP-/, '')}`;

      const permitId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      await tx.$executeRawUnsafe(
        `INSERT INTO rental_cross_border_permits (
           id, tenant_id, permit_no, booking_id, agreement_id,
           customer_id, vehicle_id, destination_country, border_post,
           departure_date, return_date, orange_card_policy_no,
           orange_card_fee, permit_fee, total_fee,
           mulkiya_verified, insurance_verified, status, issued_by, notes,
           created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10::timestamptz, $11::timestamptz, $12,
           $13, $14, $15,
           $16, $17, 'ISSUED', $18, $19,
           $20::timestamptz, $20::timestamptz
         )`,
        permitId,
        tenantId,
        permitNo,
        bookingId,
        agreementId,
        customerId,
        vehicleId,
        destinationKey,
        borderPost,
        departureDate.toISOString(),
        returnDate.toISOString(),
        orangeCardPolicyNo,
        orangeCardFee,
        permitFee,
        totalFee,
        compliance.mulkiyaVerified,
        compliance.insuranceVerified,
        actorId,
        notes,
        nowIso,
      );

      // 5. Record Cross-Border NOC + Orange Card fee on `rental_additional_charges` if agreement exists
      let chargeRecorded = false;
      if (agreementId && totalFee > 0) {
        const taxRate = 5;
        const taxAmount = round2((totalFee * taxRate) / 100);
        const grossTotal = round2(totalFee + taxAmount);
        const chargeDesc = `Cross-Border NOC & Orange Card (${DESTINATION_LABELS[destinationKey].en} — ${permitNo})`;

        const insertedFull = await withSavepoint<number | null>(
          tx,
          'xbp_add_charge_full',
          () =>
            tx.$executeRawUnsafe(
              `INSERT INTO rental_additional_charges (
                 id, tenant_id, agreement_id, charge_type, description,
                 quantity, amount, tax_rate, tax_amount, total_amount,
                 billed_to_customer, created_by, created_at, updated_at
               ) VALUES (
                 $1, $2, $3, 'CROSS_BORDER_PERMIT', $4,
                 1, $5, $6, $7, $8,
                 TRUE, $9, $10::timestamptz, $10::timestamptz
               )`,
              crypto.randomUUID(),
              tenantId,
              agreementId,
              chargeDesc,
              totalFee,
              taxRate,
              taxAmount,
              grossTotal,
              actorId,
              nowIso,
            ),
          null,
        );

        if (insertedFull !== null) {
          chargeRecorded = true;
        } else {
          const insertedMin = await withSavepoint<number | null>(
            tx,
            'xbp_add_charge_min',
            () =>
              tx.$executeRawUnsafe(
                `INSERT INTO rental_additional_charges (
                   id, tenant_id, agreement_id, charge_type, description,
                   quantity, amount, billed_to_customer
                 ) VALUES ($1, $2, $3, 'CROSS_BORDER_PERMIT', $4, 1, $5, TRUE)`,
                crypto.randomUUID(),
                tenantId,
                agreementId,
                chargeDesc,
                totalFee,
              ),
            null,
          );
          chargeRecorded = insertedMin !== null;
        }
      }

      return {
        permit: {
          id: permitId,
          tenantId,
          permitNo,
          bookingId,
          agreementId,
          agreementNo,
          customerId,
          vehicleId,
          destinationCountry: destinationKey,
          destinationLabel: DESTINATION_LABELS[destinationKey].en,
          borderPost,
          departureDate: departureDate.toISOString(),
          returnDate: returnDate.toISOString(),
          orangeCardPolicyNo,
          orangeCardFee,
          permitFee,
          totalFee,
          mulkiyaVerified: compliance.mulkiyaVerified,
          insuranceVerified: compliance.insuranceVerified,
          status: 'ISSUED',
          issuedBy: actorId,
          notes,
          renterKyc: {
            emiratesId: kyc?.emirates_id ?? null,
            passportNo: kyc?.passport_no ?? booking?.customer?.passportNo ?? null,
            passportExpiry: kyc?.passport_expiry
              ? new Date(kyc.passport_expiry).toISOString().slice(0, 10)
              : null,
            visaType: kyc?.visa_type ?? 'RESIDENT',
          },
          createdAt: nowIso,
        },
        chargeRecorded,
      };
    });

    if ('error' in outcome && outcome.error !== undefined) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    void logAudit({
      tenantId,
      userId: actorId,
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'RentalBooking',
      entityId: id,
      action: 'CREATE',
      details: `Issued cross-border permit ${outcome.permit.permitNo} (${outcome.permit.destinationCountry}) with Orange Card ${outcome.permit.orangeCardPolicyNo} — fee AED ${outcome.permit.totalFee.toFixed(2)}.`,
    });

    return NextResponse.json(outcome, { status: 201 });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, {
      context: 'rental.bookings.cross-border-permit.post',
      tags: { bookingId: id },
    });
    console.error('[cross-border-permit POST] error:', err);
    return NextResponse.json(
      { error: 'Failed to issue cross-border permit' },
      { status: 500 },
    );
  }
}

function jsonErr(message: string, status: number, code?: string) {
  return new Response(JSON.stringify(code ? { error: message, code } : { error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
