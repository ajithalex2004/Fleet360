export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { withApprovalStart } from '@/lib/workflow/approvals';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  assertAdditionalDriversEligible,
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
  persistAdditionalDriversInTx,
} from '@/lib/rental/security-guards';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BookingAncillarySelection {
  ancillaryId: string | null;
  code: string;
  name: string;
  quantity: number;
  dailyRate: number;
  perRental: boolean;
  preVatTotal: number;
}

async function resolveBookingAncillariesInTx(
  tx: TxClient,
  tenantId: string,
  rawAncillaries: unknown,
  rawAncillaryIds: unknown,
  rentalDays: number,
): Promise<BookingAncillarySelection[]> {
  const rawList: Array<Record<string, unknown>> = Array.isArray(rawAncillaries)
    ? rawAncillaries.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
    : [];
  if (Array.isArray(rawAncillaryIds)) {
    for (const idVal of rawAncillaryIds) {
      if (typeof idVal === 'string' && idVal.trim()) {
        const trimmed = idVal.trim();
        if (!rawList.some((r) => (r.ancillaryId ?? r.id) === trimmed)) {
          rawList.push({ ancillaryId: trimmed, quantity: 1 });
        }
      }
    }
  }
  if (rawList.length === 0) return [];

  const lookupIds = Array.from(
    new Set(
      rawList
        .map((r) => String(r.ancillaryId ?? r.id ?? '').trim())
        .filter((v) => v.length > 0),
    ),
  );
  if (lookupIds.length > 0) {
    await assertRentalForeignKeysInTenant(tx, tenantId, { ancillaryIds: lookupIds });
  }

  const catalogById = new Map<
    string,
    { code: string; name: string; dailyRate: number; perRental: boolean }
  >();
  if (lookupIds.length > 0 && typeof tx.rentalAncillary?.findMany === 'function') {
    const found = await tx.rentalAncillary.findMany({
      where: { tenantId, deletedAt: null, id: { in: lookupIds } },
    });
    for (const f of found) {
      const rec = f as unknown as Record<string, unknown>;
      const rt = String(rec.rateType ?? '').toUpperCase();
      catalogById.set(f.id, {
        code: f.code,
        name: String(rec.name ?? rec.titleEn ?? f.code),
        dailyRate: Number(rec.dailyRate ?? rec.rateAmount ?? 0),
        perRental: Boolean(rec.perRental ?? (rt === 'PER_RENTAL' || rt === 'FLAT')),
      });
    }
  }

  const days = Math.max(1, Math.round(rentalDays));
  return rawList.map((r) => {
    const refId = String(r.ancillaryId ?? r.id ?? '').trim() || null;
    const cat = refId ? catalogById.get(refId) : undefined;
    const code = (typeof r.code === 'string' && r.code.trim() ? r.code.trim() : cat?.code ?? 'ANCILLARY').toUpperCase();
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : cat?.name ?? code;
    const qty = Math.max(1, Math.min(20, Math.round(Number(r.quantity ?? 1) || 1)));
    const rate = round2(
      r.dailyRate !== undefined && r.dailyRate !== null && r.dailyRate !== ''
        ? Math.max(0, Number(r.dailyRate) || 0)
        : Number(cat?.dailyRate ?? 0),
    );
    const perRental = r.perRental !== undefined ? Boolean(r.perRental) : Boolean(cat?.perRental);
    const preVatTotal = round2(rate * qty * (perRental ? 1 : days));
    return { ancillaryId: refId, code, name, quantity: qty, dailyRate: rate, perRental, preVatTotal };
  });
}

async function getBookings(
  tenantId: string,
  status: string | null,
  customerId: string | null,
  take: number,
  skip: number,
  page: number,
  limit: number,
) {
  const where = {
    tenantId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
  };
  const [data, total] = await withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.rentalBooking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            companyName: true,
            email: true,
            phone: true,
            nationality: true,
          },
        },
      },
    });
    const count = await tx.rentalBooking.count({ where });

    if (rows.length > 0 && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
      const ids = rows.map((r) => r.id);
      const enriched = await withSavepoint<
        Array<{
          id: string;
          ancillaries: unknown;
          additional_drivers: unknown;
          plate_number: string | null;
          vehicle_make: string | null;
          vehicle_model: string | null;
        }>
      >(
        tx,
        'bookings_list_enrich',
        () =>
          tx.$queryRawUnsafe(
            `SELECT rb.id::text AS id,
                    rb.ancillaries,
                    rb.additional_drivers,
                    COALESCE(v.plate_number, v.license_plate, v.registration_no) AS plate_number,
                    v.make AS vehicle_make,
                    v.model AS vehicle_model
               FROM rental_bookings rb
               LEFT JOIN vehicles v
                 ON v.id = rb.vehicle_id
                AND v.tenant_id::text = rb.tenant_id::text
              WHERE rb.tenant_id::text = $1
                AND rb.id::text = ANY($2::text[])`,
            tenantId,
            ids,
          ),
        [],
      );
      const byId = new Map(enriched.map((e) => [e.id, e]));
      for (const r of rows) {
        const rowAny = r as unknown as Record<string, unknown>;
        const meta = byId.get(r.id);
        rowAny.ancillaries = Array.isArray(meta?.ancillaries) ? meta.ancillaries : [];
        rowAny.additionalDrivers = Array.isArray(meta?.additional_drivers)
          ? meta.additional_drivers
          : [];
        if (r.vehicleId && meta?.plate_number) {
          rowAny.vehicle = {
            id: r.vehicleId,
            plateNumber: meta.plate_number,
            make: meta.vehicle_make,
            model: meta.vehicle_model,
          };
        }
      }
    }

    return [rows, count] as const;
  });
  return paginatedResponse(data, total, page, limit);
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

  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);

    const data = await getBookings(tenantId, status, customerId, take, skip, page, limit);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error fetching bookings:', e);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const createDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'bookings',
    req.nextUrl.pathname,
  );
  if (createDenied) return createDenied;

  const bodyRaw = await req.json().catch(() => null);
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );

  // Manual tariff/rate/deposit override requires `rental:approve:rates` regardless of `rateOverride` flag
  const hasManualFinancialOverride =
    body.rateOverride === true ||
    hasValue(body.dailyRate) ||
    hasValue(body.totalAmount) ||
    hasValue(body.deposit) ||
    hasValue(body.securityDeposit);

  if (hasManualFinancialOverride) {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'rates',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  }

  const customerId = text(body.customerId);
  const pickupDate = parseDate(body.pickupDate);
  const dropoffDate = parseDate(body.dropoffDate);
  if (!customerId || !pickupDate || !dropoffDate) {
    return NextResponse.json(
      { error: 'Customer, pickup date and drop-off date are required' },
      { status: 400 },
    );
  }
  if (dropoffDate < pickupDate) {
    return NextResponse.json(
      { error: 'Drop-off date must be on or after the pickup date' },
      { status: 400 },
    );
  }

  const dailyRate = !hasValue(body.dailyRate) ? null : Number(body.dailyRate);
  if (dailyRate !== null && (!Number.isFinite(dailyRate) || dailyRate < 0)) {
    return NextResponse.json(
      { error: 'Daily rate must be a non-negative number' },
      { status: 400 },
    );
  }

  const explicitTotalAmount = !hasValue(body.totalAmount) ? null : Number(body.totalAmount);
  if (
    explicitTotalAmount !== null &&
    (!Number.isFinite(explicitTotalAmount) || explicitTotalAmount < 0)
  ) {
    return NextResponse.json(
      { error: 'Total amount must be a non-negative number' },
      { status: 400 },
    );
  }

  const explicitDeposit = !hasValue(body.deposit ?? body.securityDeposit)
    ? null
    : Number(body.deposit ?? body.securityDeposit);
  if (explicitDeposit !== null && (!Number.isFinite(explicitDeposit) || explicitDeposit < 0)) {
    return NextResponse.json(
      { error: 'Deposit must be a non-negative number' },
      { status: 400 },
    );
  }

  const totalDays = Math.max(
    1,
    Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / 86_400_000),
  );
  const vehicleId = text(body.vehicleId);
  const pickupBranchId = text(body.pickupBranchId);
  const dropoffBranchId = text(body.dropoffBranchId);
  const allowCreditOverride = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
  );

  try {
    const txResult = await withTenantRls(prisma, tenantId, async (tx) => {
      const customer = await tx.rentalCustomer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        select: { id: true, customerType: true },
      });
      if (!customer) {
        return { kind: 'no-customer' as const };
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId,
        vehicleId,
        branchIds: [pickupBranchId, dropoffBranchId],
      });

      const category = text(body.vehicleCategory) ?? 'ECONOMY';
      const resolvedAncillaries = await resolveBookingAncillariesInTx(
        tx,
        tenantId,
        body.ancillaries,
        body.ancillaryIds,
        totalDays,
      );
      const validatedDrivers = assertAdditionalDriversEligible(body.additionalDrivers ?? [], {
        dropoffDate,
        rentalDays: totalDays,
        vehicleCategory: category,
      });

      return withRentalLock(
        tx,
        tenantId,
        { vehicleIds: [vehicleId] },
        async () => {
          if (vehicleId) {
            const conflict = await checkVehicleRentalConflict(tx, {
              tenantId,
              vehicleId,
              startDate: pickupDate,
              endDate: dropoffDate,
              checkGrounding: true,
            });
            if (conflict.hasConflict) {
              return {
                kind: 'conflict' as const,
                reason:
                  conflict.reason ??
                  'Vehicle is already reserved during the requested period',
              };
            }
          }

          let resolvedDailyRate = dailyRate;
          // Apply 5% UAE VAT whenever computing totalAmount from an overridden dailyRate
          let resolvedTotalAmount: number | null = null;
          if (explicitTotalAmount !== null) {
            resolvedTotalAmount = round2(explicitTotalAmount);
          } else if (dailyRate !== null && dailyRate > 0) {
            const subtotal = round2(dailyRate * totalDays);
            const vat = round2(subtotal * 0.05);
            resolvedTotalAmount = round2(subtotal + vat);
          }

          // Auto-quote from the 1 Master Price List when dailyRate is omitted or 0 (unless explicitTotalAmount was set)
          if ((dailyRate === null || dailyRate === 0) && explicitTotalAmount === null) {
            const quote = await quoteRentalRateInTx(tx, tenantId, {
              vehicleCategory: category,
              pickupDate,
              dropoffDate,
              pickupLocationCode: text(body.pickupLocation) ?? undefined,
              dropoffLocationCode: text(body.dropoffLocation) ?? undefined,
              customerType: customer.customerType ?? 'INDIVIDUAL',
              corporateAccountId:
                customer.customerType === 'CORPORATE' ? customer.id : undefined,
              channel: text(body.channel) ?? 'DIRECT',
              promoCode: text(body.promoCode) ?? undefined,
              insurancePlanCode: text(body.insurancePlanCode) ?? undefined,
              currency: text(body.currency) ?? 'AED',
            });

            if (quote.dailyRate > 0) {
              resolvedDailyRate = quote.dailyRate;
              resolvedTotalAmount = quote.totalAmount;
            } else if (dailyRate === 0) {
              resolvedDailyRate = 0;
              resolvedTotalAmount = 0;
            }
          }

          const extrasPreVat = round2(
            resolvedAncillaries.reduce((s, a) => s + a.preVatTotal, 0) +
              validatedDrivers.reduce((s, d) => s + d.totalFee, 0),
          );
          if (explicitTotalAmount === null && extrasPreVat > 0) {
            const extrasGross = round2(extrasPreVat + round2(extrasPreVat * 0.05));
            resolvedTotalAmount = round2((resolvedTotalAmount ?? 0) + extrasGross);
          }

          await assertCustomerEligibleForRental(tx, {
            tenantId,
            customerId,
            dropoffDate,
            vehicleCategory: text(body.vehicleCategory),
            additionalExposureAed: resolvedTotalAmount ?? 0,
            allowCreditOverride,
          });

          const bookingRef =
            typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
              ? await nextRentalSerial(tx, {
                  tenantId,
                  series: 'RBK',
                  prefix: 'RBK-',
                  table: 'rental_bookings',
                  column: 'booking_ref',
                  padWidth: 6,
                })
              : `RBK-${String((await tx.rentalBooking.count({ where: { tenantId } })) + 1).padStart(6, '0')}`;

          const booking = await tx.rentalBooking.create({
            data: {
              tenantId,
              bookingRef,
              customerId,
              vehicleId,
              vehicleCategory: text(body.vehicleCategory),
              pickupDate,
              dropoffDate,
              pickupLocation: text(body.pickupLocation),
              dropoffLocation: text(body.dropoffLocation),
              totalDays,
              dailyRate: resolvedDailyRate,
              totalAmount: resolvedTotalAmount,
              currency: text(body.currency) ?? 'AED',
              channel: text(body.channel) ?? 'DIRECT',
              notes: text(body.notes),
            },
          });

          if (
            (resolvedAncillaries.length > 0 || validatedDrivers.length > 0) &&
            typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
          ) {
            await withSavepoint(
              tx,
              'booking_create_extras_json',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_bookings
                      SET ancillaries = $1::jsonb,
                          additional_drivers = $2::jsonb
                    WHERE id = $3 AND tenant_id::text = $4`,
                  JSON.stringify(resolvedAncillaries),
                  JSON.stringify(validatedDrivers),
                  booking.id,
                  tenantId,
                ),
              0,
            );
          }

          if (validatedDrivers.length > 0) {
            await persistAdditionalDriversInTx(tx, {
              tenantId,
              bookingId: booking.id,
              drivers: validatedDrivers,
            });
          }

          const bookingWithExtras = {
            ...booking,
            ancillaries: resolvedAncillaries,
            additionalDrivers: validatedDrivers,
          };

          return { kind: 'ok' as const, booking: bookingWithExtras };
        },
      );
    });

    if (txResult.kind === 'no-customer') {
      return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
    }
    if (txResult.kind === 'conflict') {
      return NextResponse.json({ error: txResult.reason }, { status: 409 });
    }

    return withApprovalStart(NextResponse.json(txResult.booking, { status: 201 }), {
      headers: req.headers,
      tenantId,
      referenceType: 'rental_booking',
      referenceId: txResult.booking.id,
    });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error creating booking:', e);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
