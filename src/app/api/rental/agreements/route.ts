export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { assertCanWrite } from '@/lib/access-control';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertAdditionalDriversEligible,
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
  persistAdditionalDriversInTx,
  type ValidatedAdditionalDriver,
} from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import { requireApproved } from '@/lib/workflow/approvals';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';
import {
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function coerceFuelField(fieldName: 'fuelOut' | 'fuelIn', fuelPct: number | null): string | number | null {
  if (fuelPct == null) return null;
  const field = Prisma.dmmf?.datamodel?.models
    ?.find((m) => m.name === 'RentalAgreement')
    ?.fields?.find((f) => f.name === fieldName);
  if (field?.type === 'Int' || field?.type === 'Float' || field?.type === 'Decimal') {
    return fuelPct;
  }
  return String(fuelPct);
}

function parseOptionalNonNegNumber(val: unknown, fieldLabel: string): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`INVALID_FIELD:${fieldLabel}`);
  }
  return n;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
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
      const status = sp.get('status');
      const customerId = sp.get('customerId');
      const idParam = sp.get('id') || sp.get('agreementId');
      const { take, skip, page, limit } = paginate(sp);
      const where = {
        tenantId,
        ...(status ? { status } : {}),
        ...(customerId ? { customerId } : {}),
        ...(idParam ? { id: idParam } : {}),
      };
      const data = await tx.rentalAgreement.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              bookingRef: true,
              pickupDate: true,
              dropoffDate: true,
              pickupLocation: true,
              dropoffLocation: true,
              vehicleCategory: true,
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  email: true,
                  companyName: true,
                },
              },
              inspections: { orderBy: { createdAt: 'desc' } },
            },
          },
          extensions: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      const total = await tx.rentalAgreement.count({ where });

      // Unfiltered tenant-scoped status summary counts (sequentially on tx — never Promise.all!)
      const summary = {
        ALL: 0,
        DRAFT: 0,
        ACTIVE: 0,
        COMPLETED: 0,
        CANCELLED: 0,
        activeRevenue: 0,
        pendingDeposits: 0,
      };
      let summaryResolved = false;

      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const summaryRows = await withSavepoint<
          Array<{
            status: string | null;
            cnt: number | bigint;
            active_rev: number | string | null;
            pending_dep: number | bigint | null;
          }>
        >(
          tx,
          'agr_list_status_summary',
          () =>
            tx.$queryRawUnsafe(
              `SELECT UPPER(COALESCE(status, 'DRAFT')) AS status,
                      COUNT(*)::int AS cnt,
                      COALESCE(SUM(CASE WHEN UPPER(status) = 'ACTIVE' THEN COALESCE(total_amount, 0) ELSE 0 END), 0)::float8 AS active_rev,
                      COUNT(*) FILTER (WHERE UPPER(COALESCE(deposit_status, 'PENDING')) = 'PENDING')::int AS pending_dep
                 FROM rental_agreements
                WHERE tenant_id::text = $1
                GROUP BY UPPER(COALESCE(status, 'DRAFT'))`,
              tenantId,
            ),
          [],
        );
        if (Array.isArray(summaryRows) && summaryRows.length > 0) {
          summaryResolved = true;
          for (const r of summaryRows) {
            const st = String(r.status ?? 'DRAFT').toUpperCase();
            const cnt = Number(r.cnt ?? 0);
            summary.ALL += cnt;
            if (st === 'DRAFT') summary.DRAFT += cnt;
            else if (st === 'ACTIVE') summary.ACTIVE += cnt;
            else if (st === 'COMPLETED') summary.COMPLETED += cnt;
            else if (st === 'CANCELLED') summary.CANCELLED += cnt;
            summary.activeRevenue += Number(r.active_rev ?? 0);
            summary.pendingDeposits += Number(r.pending_dep ?? 0);
          }
        }
      }

      if (
        !summaryResolved &&
        typeof (tx.rentalAgreement as unknown as { groupBy?: unknown })?.groupBy === 'function'
      ) {
        try {
          const grouped = await (
            tx.rentalAgreement as unknown as {
              groupBy: (args: unknown) => Promise<Array<{ status: string | null; _count: { _all: number } }>>;
            }
          ).groupBy({
            by: ['status'],
            where: { tenantId },
            _count: { _all: true },
          });
          if (Array.isArray(grouped)) {
            summaryResolved = true;
            for (const g of grouped) {
              const st = String(g.status ?? 'DRAFT').toUpperCase();
              const cnt = Number(g._count?._all ?? 0);
              summary.ALL += cnt;
              if (st === 'DRAFT') summary.DRAFT += cnt;
              else if (st === 'ACTIVE') summary.ACTIVE += cnt;
              else if (st === 'COMPLETED') summary.COMPLETED += cnt;
              else if (st === 'CANCELLED') summary.CANCELLED += cnt;
            }
          }
        } catch {
          // Fall back to current page rows
        }
      }

      if (!summaryResolved) {
        for (const item of data) {
          const st = String(item.status ?? 'DRAFT').toUpperCase();
          if (st === 'DRAFT') summary.DRAFT += 1;
          else if (st === 'ACTIVE') {
            summary.ACTIVE += 1;
            summary.activeRevenue += Number(item.totalAmount ?? 0);
          } else if (st === 'COMPLETED') summary.COMPLETED += 1;
          else if (st === 'CANCELLED') summary.CANCELLED += 1;
          if (String(item.depositStatus ?? 'PENDING').toUpperCase() === 'PENDING') {
            summary.pendingDeposits += 1;
          }
        }
        summary.ALL = Math.max(total, data.length);
      }

      // Enrich page rows with canonical 0-100% fuel, dual-column odometer readings, and customer_name
      if (data.length > 0 && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const ids = data.map((a) => a.id);
        const rawCols = await withSavepoint<
          Array<{
            id: string;
            customer_name: string | null;
            pickup_odometer: number | null;
            return_odometer: number | null;
            mileage_out: number | null;
            mileage_in: number | null;
            pickup_fuel_level: number | null;
            return_fuel_level: number | null;
            fuel_out: string | number | null;
            fuel_in: string | number | null;
          }>
        >(
          tx,
          'agr_list_enrich_fuel_odo',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, customer_name, pickup_odometer, return_odometer,
                      mileage_out, mileage_in, pickup_fuel_level, return_fuel_level,
                      fuel_out, fuel_in
                 FROM rental_agreements
                WHERE tenant_id::text = $1
                  AND id::text = ANY($2::text[])`,
              tenantId,
              ids,
            ),
          [],
        );
        const byId = new Map(rawCols.map((r) => [r.id, r]));
        for (const item of data) {
          const rowAny = item as unknown as Record<string, unknown>;
          const raw = byId.get(item.id);
          const mOut = resolveStoredOdometerKm(raw?.pickup_odometer, raw?.mileage_out ?? rowAny.mileageOut);
          const mIn = resolveStoredOdometerKm(raw?.return_odometer, raw?.mileage_in ?? rowAny.mileageIn);
          const fOut = resolveStoredFuelPct(raw?.pickup_fuel_level, raw?.fuel_out ?? rowAny.fuelOut);
          const fIn = resolveStoredFuelPct(raw?.return_fuel_level, raw?.fuel_in ?? rowAny.fuelIn);
          rowAny.mileageOut = mOut;
          rowAny.pickupOdometer = mOut;
          rowAny.mileageIn = mIn;
          rowAny.returnOdometer = mIn;
          rowAny.fuelOut = fOut != null ? String(fOut) : null;
          rowAny.pickupFuelLevel = fOut;
          rowAny.fuelIn = fIn != null ? String(fIn) : null;
          rowAny.returnFuelLevel = fIn;
          rowAny.customerName =
            (raw?.customer_name && raw.customer_name.trim() ? raw.customer_name.trim() : null) ??
            (typeof rowAny.customerName === 'string' && rowAny.customerName.trim() ? rowAny.customerName.trim() : null) ??
            item.booking?.customer?.companyName ??
            item.booking?.customer?.fullName ??
            null;
        }

        // Enrich with assigned vehicle plate/model, mid-rental swap count, and UAE regulatory status
        const vehicleIds = Array.from(
          new Set(
            data
              .map((a) => a.vehicleId)
              .filter((v): v is string => typeof v === 'string' && v.length > 0),
          ),
        );
        if (vehicleIds.length > 0) {
          const vehRows = await withSavepoint<
            Array<{
              id: string;
              plate_number: string | null;
              make: string | null;
              model: string | null;
              status: string | null;
            }>
          >(
            tx,
            'agr_list_enrich_vehicles',
            () =>
              tx.$queryRawUnsafe(
                `SELECT id::text AS id,
                        COALESCE(plate_number, license_plate, registration_no) AS plate_number,
                        make,
                        model,
                        status::text AS status
                   FROM vehicles
                  WHERE tenant_id::text = $1
                    AND id::text = ANY($2::text[])`,
                tenantId,
                vehicleIds,
              ),
            [],
          );
          const vehById = new Map(vehRows.map((v) => [v.id, v]));
          for (const item of data) {
            if (!item.vehicleId) continue;
            const v = vehById.get(item.vehicleId);
            if (v) {
              (item as unknown as Record<string, unknown>).vehicle = {
                id: v.id,
                plateNumber: v.plate_number,
                make: v.make,
                model: v.model,
                status: v.status,
              };
            }
          }
        }

        const swapCounts = await withSavepoint<
          Array<{ agreement_id: string; cnt: number | bigint }>
        >(
          tx,
          'agr_list_enrich_swaps',
          () =>
            tx.$queryRawUnsafe(
              `SELECT agreement_id::text AS agreement_id, COUNT(*)::int AS cnt
                 FROM rental_vehicle_exchanges
                WHERE tenant_id::text = $1
                  AND agreement_id::text = ANY($2::text[])
                GROUP BY agreement_id`,
              tenantId,
              ids,
            ),
          [],
        );
        const swapMap = new Map(swapCounts.map((s) => [s.agreement_id, Number(s.cnt ?? 0)]));

        const regRows = await withSavepoint<
          Array<{
            agreement_id: string;
            authority: string;
            event_type: string;
            status: string;
            external_ref: string | null;
            submitted_at: Date | string | null;
          }>
        >(
          tx,
          'agr_list_enrich_regulatory',
          () =>
            tx.$queryRawUnsafe(
              `SELECT DISTINCT ON (agreement_id)
                      agreement_id::text AS agreement_id,
                      authority,
                      event_type,
                      status,
                      external_ref,
                      submitted_at
                 FROM rental_regulatory_reports
                WHERE tenant_id::text = $1
                  AND agreement_id::text = ANY($2::text[])
                ORDER BY agreement_id, created_at DESC`,
              tenantId,
              ids,
            ),
          [],
        );
        const regMap = new Map(regRows.map((r) => [r.agreement_id, r]));

        for (const item of data) {
          const rowAny = item as unknown as Record<string, unknown>;
          rowAny.exchangeCount = swapMap.get(item.id) ?? 0;
          const reg = regMap.get(item.id);
          rowAny.regulatoryReport = reg
            ? {
                authority: reg.authority,
                eventType: reg.event_type,
                status: reg.status,
                externalRef: reg.external_ref,
                submittedAt: reg.submitted_at,
              }
            : null;
        }
      }

      return NextResponse.json({
        ...paginatedResponse(data, total, page, limit),
        summary,
      });
    } catch {
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const guard = assertCanWrite(req, 'rental');
  if (guard) return guard;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  try {
    const bodyRaw = await req.json();
    const cleanBody = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    // Explicit rate / deposit override check
    const hasManualFinancials =
      cleanBody.dailyRate !== undefined ||
      cleanBody.totalAmount !== undefined ||
      cleanBody.depositAmount !== undefined ||
      cleanBody.securityDeposit !== undefined;
    if (hasManualFinancials) {
      const ratePermErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'rates',
        req.nextUrl.pathname,
      );
      if (ratePermErr) return ratePermErr;
    }

    const isWalkIn =
      String(cleanBody.sourceType ?? '').trim().toUpperCase() === 'WALK_IN' ||
      cleanBody.walkIn === true;
    const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'staff';

    const bookingId =
      typeof cleanBody.bookingId === 'string' && cleanBody.bookingId.trim()
        ? cleanBody.bookingId.trim()
        : null;
    if (!bookingId && !isWalkIn) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }

    if (bookingId) {
      const approvalBlock = await requireApproved({
        headers: req.headers,
        tenantId,
        referenceType: 'rental_booking',
        referenceId: bookingId,
      });
      if (approvalBlock) return approvalBlock;
    }

    let explicitDailyRate: number | undefined;
    let explicitTotalAmount: number | undefined;
    let explicitDeposit: number | undefined;
    let mileageOut: number | undefined;
    try {
      explicitDailyRate = parseOptionalNonNegNumber(cleanBody.dailyRate, 'dailyRate');
      explicitTotalAmount = parseOptionalNonNegNumber(cleanBody.totalAmount, 'totalAmount');
      explicitDeposit = parseOptionalNonNegNumber(
        cleanBody.depositAmount ?? cleanBody.securityDeposit,
        'securityDeposit',
      );
      const rawMileage = parseOptionalNonNegNumber(
        cleanBody.mileageOut ?? cleanBody.pickupOdometer,
        'mileageOut',
      );
      mileageOut = rawMileage !== undefined ? Math.round(rawMileage) : undefined;
    } catch (fieldErr) {
      const msg = fieldErr instanceof Error ? fieldErr.message.replace('INVALID_FIELD:', '') : 'numeric field';
      return NextResponse.json({ error: `Invalid ${msg}` }, { status: 400 });
    }

    const allowCreditOverride = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
    );

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const booking =
        bookingId && typeof tx.rentalBooking?.findFirst === 'function'
          ? await tx.rentalBooking.findFirst({
              where: { id: bookingId, tenantId, deletedAt: null },
            })
          : null;

      if (bookingId && typeof tx.rentalBooking?.findFirst === 'function' && !booking) {
        return { error: 'Booking not found in tenant', status: 404 as const };
      }

      const customerId =
        typeof cleanBody.customerId === 'string' && cleanBody.customerId.trim()
          ? cleanBody.customerId.trim()
          : booking?.customerId ?? null;
      if (!customerId) {
        return { error: 'customerId is required', status: 400 as const };
      }
      if (booking && customerId !== booking.customerId) {
        return {
          error: 'customerId does not match the referenced booking customer',
          status: 422 as const,
        };
      }

      const vehicleId =
        cleanBody.vehicleId !== undefined
          ? cleanBody.vehicleId === null || cleanBody.vehicleId === ''
            ? null
            : String(cleanBody.vehicleId).trim()
          : booking?.vehicleId ?? null;

      if (isWalkIn && !vehicleId) {
        return {
          error: 'vehicleId is required for WALK_IN rental agreements',
          status: 400 as const,
        };
      }

      const openBranchId =
        typeof cleanBody.openBranchId === 'string' && cleanBody.openBranchId.trim()
          ? cleanBody.openBranchId.trim()
          : null;
      const closeBranchId =
        typeof cleanBody.closeBranchId === 'string' && cleanBody.closeBranchId.trim()
          ? cleanBody.closeBranchId.trim()
          : null;
      const corporateAccountId =
        typeof cleanBody.corporateAccountId === 'string' && cleanBody.corporateAccountId.trim()
          ? cleanBody.corporateAccountId.trim()
          : null;

      const startDate = cleanBody.startDate
        ? new Date(String(cleanBody.startDate))
        : booking?.pickupDate ?? null;
      const endDate = cleanBody.endDate
        ? new Date(String(cleanBody.endDate))
        : booking?.dropoffDate ?? null;
      if (
        !startDate ||
        !endDate ||
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime()) ||
        endDate.getTime() <= startDate.getTime()
      ) {
        return { error: 'Valid startDate and endDate (endDate > startDate) are required', status: 400 as const };
      }

      const rawAncillaries: Array<Record<string, unknown>> = Array.isArray(cleanBody.ancillaries)
        ? cleanBody.ancillaries.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        : [];
      if (Array.isArray(cleanBody.ancillaryIds)) {
        for (const aid of cleanBody.ancillaryIds) {
          if (typeof aid === 'string' && aid.trim()) {
            const trimmed = aid.trim();
            if (!rawAncillaries.some((r) => (r.ancillaryId ?? r.id) === trimmed)) {
              rawAncillaries.push({ ancillaryId: trimmed, quantity: 1 });
            }
          }
        }
      }
      const ancillaryIds = Array.from(
        new Set(
          rawAncillaries
            .map((r) => String(r.ancillaryId ?? r.id ?? '').trim())
            .filter((v) => v.length > 0),
        ),
      );

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        bookingId,
        customerId,
        corporateAccountId,
        vehicleId,
        branchIds: [openBranchId, closeBranchId],
        ancillaryIds,
      });

      const currencyCode =
        typeof cleanBody.currency === 'string' && cleanBody.currency.trim()
          ? cleanBody.currency.trim().toUpperCase()
          : booking?.currency ?? 'AED';
      const totalDays = Math.max(
        1,
        Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000),
      );
      const vehicleCategory =
        typeof cleanBody.vehicleCategory === 'string' && cleanBody.vehicleCategory.trim()
          ? cleanBody.vehicleCategory.trim().toUpperCase()
          : booking?.vehicleCategory ?? 'ECONOMY';

      const validatedDrivers: ValidatedAdditionalDriver[] =
        cleanBody.additionalDrivers !== undefined
          ? assertAdditionalDriversEligible(cleanBody.additionalDrivers, {
              dropoffDate: endDate,
              rentalDays: totalDays,
              vehicleCategory,
            })
          : [];

      const catalogAncById = new Map<
        string,
        { code: string; name: string; dailyRate: number; perRental: boolean }
      >();
      if (ancillaryIds.length > 0 && typeof (tx as TxClient).rentalAncillary?.findMany === 'function') {
        const found = await (tx as TxClient).rentalAncillary.findMany({
          where: { tenantId, deletedAt: null, id: { in: ancillaryIds } },
        });
        for (const f of found) {
          const rec = f as unknown as Record<string, unknown>;
          const rt = String(rec.rateType ?? '').toUpperCase();
          catalogAncById.set(f.id, {
            code: f.code,
            name: String(rec.name ?? rec.titleEn ?? f.code),
            dailyRate: Number(rec.dailyRate ?? rec.rateAmount ?? 0),
            perRental: Boolean(rec.perRental ?? (rt === 'PER_RENTAL' || rt === 'FLAT')),
          });
        }
      }
      const normalizedAncillaries = rawAncillaries.map((r) => {
        const refId = String(r.ancillaryId ?? r.id ?? '').trim() || null;
        const cat = refId ? catalogAncById.get(refId) : undefined;
        const code = (
          typeof r.code === 'string' && r.code.trim() ? r.code.trim() : cat?.code ?? 'ANCILLARY'
        ).toUpperCase();
        const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : cat?.name ?? code;
        const qty = Math.max(1, Math.min(20, Math.round(Number(r.quantity ?? 1) || 1)));
        const rate = round2(
          r.dailyRate !== undefined && r.dailyRate !== null && r.dailyRate !== ''
            ? Math.max(0, Number(r.dailyRate) || 0)
            : Number(cat?.dailyRate ?? 0),
        );
        const perRental = r.perRental !== undefined ? Boolean(r.perRental) : Boolean(cat?.perRental);
        const chargeQty = perRental ? qty : qty * totalDays;
        return { ancillaryId: refId, code, name, quantity: qty, dailyRate: rate, perRental, chargeQty, preVatTotal: round2(chargeQty * rate) };
      });

      let resolvedDailyRate = explicitDailyRate;
      let resolvedTotalAmount = explicitTotalAmount;

      if (resolvedDailyRate === undefined && resolvedTotalAmount === undefined) {
        const quote = await quoteRentalRateInTx(tx, tenantId, {
          vehicleCategory,
          pickupDate: startDate,
          dropoffDate: endDate,
          pickupLocationCode: openBranchId ?? booking?.pickupLocation ?? undefined,
          dropoffLocationCode: closeBranchId ?? booking?.dropoffLocation ?? undefined,
          customerType: corporateAccountId ? 'CORPORATE' : 'INDIVIDUAL',
          corporateAccountId: corporateAccountId ?? undefined,
          channel: isWalkIn ? 'WALK_IN' : booking?.channel ?? (corporateAccountId ? 'CORPORATE' : 'DIRECT'),
          insurancePlanCode:
            typeof cleanBody.insurancePlanCode === 'string' && cleanBody.insurancePlanCode.trim()
              ? cleanBody.insurancePlanCode.trim()
              : undefined,
          currency: currencyCode,
        });

        if (quote.appliedRuleId != null && quote.dailyRate > 0) {
          resolvedDailyRate = quote.dailyRate;
          resolvedTotalAmount = quote.totalAmount;
        } else {
          resolvedDailyRate =
            booking?.dailyRate != null ? Number(booking.dailyRate) : undefined;
          resolvedTotalAmount =
            booking?.totalAmount != null ? Number(booking.totalAmount) : undefined;
        }
      } else if (resolvedDailyRate !== undefined && resolvedTotalAmount === undefined) {
        const sub = round2(resolvedDailyRate * totalDays);
        resolvedTotalAmount = round2(sub + round2(sub * 0.05));
      }

      const extrasPreVat = round2(
        normalizedAncillaries.reduce((s, a) => s + a.preVatTotal, 0) +
          validatedDrivers.reduce((s, d) => s + d.totalFee, 0),
      );
      if (explicitTotalAmount === undefined && extrasPreVat > 0) {
        const extrasGross = round2(extrasPreVat + round2(extrasPreVat * 0.05));
        resolvedTotalAmount = round2((resolvedTotalAmount ?? 0) + extrasGross);
      }

      const hasFuelOutInput =
        cleanBody.fuelOut !== undefined ||
        cleanBody.pickupFuelLevel !== undefined ||
        cleanBody.fuelOutPct !== undefined ||
        cleanBody.pickupFuelPct !== undefined ||
        cleanBody.fuelLevel !== undefined;
      const pickupFuelPct = hasFuelOutInput
        ? resolveInputFuelPct(cleanBody, 'pickup', 'PCT')
        : null;

      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId,
        corporateAccountId,
        dropoffDate: endDate,
        vehicleCategory,
        additionalExposureAed: resolvedTotalAmount ?? 0,
        excludeBookingId: bookingId,
        allowCreditOverride,
        requireLicenseOnFile: isWalkIn,
      });

      // Resolve customerName from verified RentalCustomer (companyName ?? fullName)
      let resolvedCustomerName: string | null = null;
      if (typeof tx.rentalCustomer?.findFirst === 'function') {
        const verifiedCust = await tx.rentalCustomer.findFirst({
          where: { id: customerId, tenantId },
          select: { companyName: true, fullName: true },
        });
        if (verifiedCust) {
          const comp =
            typeof verifiedCust.companyName === 'string' && verifiedCust.companyName.trim()
              ? verifiedCust.companyName.trim()
              : null;
          const full =
            typeof verifiedCust.fullName === 'string' && verifiedCust.fullName.trim()
              ? verifiedCust.fullName.trim()
              : null;
          resolvedCustomerName = comp ?? full ?? null;
        }
      } else if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const custRows = await withSavepoint<
          Array<{ company_name: string | null; full_name: string | null }>
        >(
          tx,
          'agr_post_lookup_customer_name',
          () =>
            tx.$queryRawUnsafe(
              `SELECT company_name, full_name
                 FROM rental_customers
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              customerId,
              tenantId,
            ),
          [],
        );
        if (custRows[0]) {
          const comp = custRows[0].company_name?.trim() || null;
          const full = custRows[0].full_name?.trim() || null;
          resolvedCustomerName = comp ?? full ?? null;
        }
      }

      const hasCustomerNameInPrismaModel = Boolean(
        Prisma.dmmf?.datamodel?.models
          ?.find((m) => m.name === 'RentalAgreement')
          ?.fields?.some((f) => f.name === 'customerName'),
      );

      // Only WALK_IN agreements may be opened directly as ACTIVE; standard booked POST always starts DRAFT
      const initialAgreementStatus =
        isWalkIn && String(cleanBody.status ?? 'ACTIVE').trim().toUpperCase() === 'ACTIVE'
          ? 'ACTIVE'
          : 'DRAFT';

      const createUnderLock = async () => {
        if (vehicleId && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId,
            vehicleId,
            startDate,
            endDate,
            excludeBookingId: bookingId,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            return {
              error: conflict.reason ?? 'Vehicle is already allocated during this period',
              status: 409 as const,
            };
          }
        }

        let effectiveBookingId = bookingId;
        if (!effectiveBookingId) {
          const walkInBookingRef =
            typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
              ? await nextRentalSerial(tx, {
                  tenantId,
                  series: 'RBK',
                  prefix: 'RBK-',
                  table: 'rental_bookings',
                  column: 'booking_ref',
                  padWidth: 6,
                })
              : `RBK-${Date.now()}`;
          const createdWalkInBooking = await tx.rentalBooking.create({
            data: {
              tenantId,
              bookingRef: walkInBookingRef,
              customerId,
              vehicleId,
              vehicleCategory,
              pickupDate: startDate,
              dropoffDate: endDate,
              pickupLocation: openBranchId,
              dropoffLocation: closeBranchId ?? openBranchId,
              totalDays,
              dailyRate: resolvedDailyRate ?? 0,
              totalAmount: resolvedTotalAmount ?? 0,
              currency: currencyCode,
              status: initialAgreementStatus === 'ACTIVE' ? 'ACTIVE' : 'CONFIRMED',
              channel: 'WALK_IN',
            },
          });
          effectiveBookingId = createdWalkInBooking.id;
        }

        const agreementNo =
          typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
            ? await nextRentalSerial(tx, {
                tenantId,
                series: 'RA',
                prefix: 'RA-',
                table: 'rental_agreements',
                column: 'agreement_no',
                padWidth: 6,
              })
            : `RA-${String((await tx.rentalAgreement.count({ where: { tenantId } })) + 1).padStart(6, '0')}`;

        // Strict field whitelist: never allow status (except WALK_IN ACTIVE), depositStatus, closedAt, closedBy, signedAt, signedBy
        const createPayload: Record<string, unknown> = {
          tenantId,
          agreementNo,
          bookingId: effectiveBookingId,
          customerId,
          ...(resolvedCustomerName && hasCustomerNameInPrismaModel
            ? { customerName: resolvedCustomerName }
            : {}),
          vehicleId,
          startDate,
          endDate,
          status: initialAgreementStatus,
          depositStatus: 'PENDING',
          currency: currencyCode,
          ...(isWalkIn ? { sourceType: 'WALK_IN' } : {}),
          ...(initialAgreementStatus === 'ACTIVE'
            ? { signedAt: new Date(), signedBy: actorUserId }
            : {}),
          ...(openBranchId ? { openBranchId } : {}),
          ...(closeBranchId ? { closeBranchId } : {}),
          ...(corporateAccountId ? { corporateAccountId, isCorporate: true } : {}),
          ...(resolvedDailyRate !== undefined ? { dailyRate: resolvedDailyRate } : {}),
          ...(resolvedTotalAmount !== undefined ? { totalAmount: resolvedTotalAmount } : {}),
          ...(explicitDeposit !== undefined ? { securityDeposit: explicitDeposit } : {}),
          ...(mileageOut !== undefined ? { mileageOut } : {}),
          ...(hasFuelOutInput ? { fuelOut: coerceFuelField('fuelOut', pickupFuelPct) } : {}),
          ...(typeof cleanBody.terms === 'string' ? { terms: cleanBody.terms } : {}),
          ...(typeof cleanBody.notes === 'string' ? { notes: cleanBody.notes } : {}),
          ...(typeof cleanBody.remarks === 'string' ? { remarks: cleanBody.remarks } : {}),
          ...(typeof cleanBody.insurancePlanCode === 'string'
            ? { insurancePlanCode: cleanBody.insurancePlanCode }
            : {}),
          ...(typeof cleanBody.language === 'string' && ['en', 'ar'].includes(cleanBody.language)
            ? { language: cleanBody.language }
            : {}),
        };

        const agreement = await tx.rentalAgreement.create({
          data: createPayload as Prisma.RentalAgreementUncheckedCreateInput,
        });

        if (
          agreement?.id &&
          (mileageOut !== undefined || pickupFuelPct !== null || resolvedCustomerName !== null) &&
          typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
        ) {
          await withSavepoint(
            tx,
            'agr_post_sync_cols',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET pickup_odometer = COALESCE($1, pickup_odometer),
                        mileage_out = COALESCE($1, mileage_out),
                        pickup_fuel_level = COALESCE($2, pickup_fuel_level),
                        customer_name = COALESCE($3, customer_name)
                  WHERE id::text = $4
                    AND tenant_id::text = $5`,
                mileageOut ?? null,
                pickupFuelPct,
                resolvedCustomerName,
                agreement.id,
                tenantId,
              ),
            0,
          );
        }

        if (agreement?.id && validatedDrivers.length > 0) {
          await persistAdditionalDriversInTx(tx, {
            tenantId,
            bookingId: effectiveBookingId,
            agreementId: agreement.id,
            drivers: validatedDrivers,
          });
        }

        if (
          agreement?.id &&
          (normalizedAncillaries.length > 0 || validatedDrivers.length > 0) &&
          typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
        ) {
          for (const anc of normalizedAncillaries) {
            if (anc.preVatTotal <= 0) continue;
            const vatAmt = round2(anc.preVatTotal * 0.05);
            const grossAmt = round2(anc.preVatTotal + vatAmt);
            await withSavepoint(
              tx,
              'agr_post_anc_charge',
              () =>
                tx.$executeRawUnsafe(
                  `INSERT INTO rental_additional_charges
                     (id, tenant_id, agreement_id, charge_type, description, quantity, amount,
                      vat_rate, vat_amount, total_amount, billed_to_customer, created_by, created_at)
                   VALUES ($1, $2, $3, 'ANCILLARY', $4, $5, $6, 5, $7, $8, true, $9, NOW())`,
                  crypto.randomUUID(),
                  tenantId,
                  agreement.id,
                  `Ancillary — ${anc.name} (${anc.code})`,
                  anc.chargeQty,
                  anc.dailyRate,
                  vatAmt,
                  grossAmt,
                  actorUserId,
                ),
              0,
            );
          }
          for (const drv of validatedDrivers) {
            if (drv.totalFee <= 0 || drv.dailyFee <= 0) continue;
            const vatAmt = round2(drv.totalFee * 0.05);
            const grossAmt = round2(drv.totalFee + vatAmt);
            await withSavepoint(
              tx,
              'agr_post_drv_charge',
              () =>
                tx.$executeRawUnsafe(
                  `INSERT INTO rental_additional_charges
                     (id, tenant_id, agreement_id, charge_type, description, quantity, amount,
                      vat_rate, vat_amount, total_amount, billed_to_customer, created_by, created_at)
                   VALUES ($1, $2, $3, 'ADDITIONAL_DRIVER', $4, $5, $6, 5, $7, $8, true, $9, NOW())`,
                  crypto.randomUUID(),
                  tenantId,
                  agreement.id,
                  `Additional Driver — ${drv.fullName} (DL ${drv.drivingLicenseNo})`,
                  totalDays,
                  drv.dailyFee,
                  vatAmt,
                  grossAmt,
                  actorUserId,
                ),
              0,
            );
          }
        }

        let regulatoryReport: UaeRegulatoryReportRecord | null = null;
        if (initialAgreementStatus === 'ACTIVE' && agreement?.id) {
          if (vehicleId && typeof tx.vehicle?.updateMany === 'function') {
            await withSavepoint(
              tx,
              'agr_post_walkin_rented',
              () =>
                tx.vehicle.updateMany({
                  where: { id: vehicleId, tenantId },
                  data: {
                    status: 'RENTED',
                    ...(mileageOut !== undefined ? { currentMileage: BigInt(mileageOut) } : {}),
                    ...(pickupFuelPct !== null ? { fuelLevel: pickupFuelPct } : {}),
                  },
                }),
              { count: 0 },
            );
          }
          if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
            regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
              tx,
              'agr_post_walkin_reg',
              () =>
                queueUaeRegulatoryReportInTx(tx, {
                  tenantId,
                  agreementId: agreement.id,
                  eventType: 'HANDOVER',
                  submittedBy: actorUserId,
                }),
              null,
            );
          }
        }

        if (agreement && resolvedCustomerName) {
          const agrAny = agreement as unknown as Record<string, unknown>;
          if (!agrAny.customerName) {
            agrAny.customerName = resolvedCustomerName;
          }
        }

        return { agreement, regulatoryReport };
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return withRentalLock(
          tx,
          tenantId,
          { entityKey: bookingId ?? `walkin:${customerId}`, vehicleIds: [vehicleId] },
          createUnderLock,
        );
      }
      return createUnderLock();
    });

    if ('error' in result && result.error !== undefined) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.regulatoryReport?.status === 'QUEUED') {
      try {
        const dispatched = await dispatchUaeRegulatoryReportOutsideRls(result.regulatoryReport);
        (result.agreement as unknown as Record<string, unknown>).regulatoryReport = dispatched;
      } catch {
        // Non-fatal: report remains QUEUED in rental_regulatory_reports for retry
      }
    }

    return NextResponse.json(result.agreement, { status: 201 });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
