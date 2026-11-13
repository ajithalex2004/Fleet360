export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
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
import { resolveStoredFuelPct, resolveStoredOdometerKm } from '@/lib/rental/fuel-odometer';
import { approvalInProgress, withdrawApproval } from '@/lib/workflow/approvals';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function resolvePatchAncillariesInTx(
  tx: TxClient,
  tenantId: string,
  rawAncillaries: unknown,
  rawAncillaryIds: unknown,
  rentalDays: number,
) {
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

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasBookingModelField(fieldName: string): boolean {
  return Boolean(
    Prisma.dmmf?.datamodel?.models
      ?.find((m) => m.name === 'RentalBooking')
      ?.fields?.some((f) => f.name === fieldName),
  );
}

const TERMINAL_BOOKING_STATUSES = new Set([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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
      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: {
          customer: true,
          inspections: { orderBy: { createdAt: 'desc' } },
          damageClaims: { orderBy: { createdAt: 'desc' } },
          agreement: {
            include: {
              payments: { orderBy: { createdAt: 'desc' } },
              extensions: { orderBy: { createdAt: 'desc' } },
              charges: { orderBy: { createdAt: 'desc' } },
            },
          },
        },
      });
      if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      if (booking.agreement && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const rawAgrRows = await withSavepoint<
          Array<{
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
          'bk_get_agr_fuel_odo',
          () =>
            tx.$queryRawUnsafe(
              `SELECT pickup_odometer, return_odometer, mileage_out, mileage_in,
                      pickup_fuel_level, return_fuel_level, fuel_out, fuel_in
                 FROM rental_agreements
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              booking.agreement!.id,
              tenantId,
            ),
          [],
        );
        const raw = rawAgrRows[0];
        if (raw) {
          const agrAny = booking.agreement as Record<string, unknown>;
          const mOut = resolveStoredOdometerKm(raw.pickup_odometer, raw.mileage_out ?? agrAny.mileageOut);
          const mIn = resolveStoredOdometerKm(raw.return_odometer, raw.mileage_in ?? agrAny.mileageIn);
          const fOut = resolveStoredFuelPct(raw.pickup_fuel_level, raw.fuel_out ?? agrAny.fuelOut);
          const fIn = resolveStoredFuelPct(raw.return_fuel_level, raw.fuel_in ?? agrAny.fuelIn);
          agrAny.mileageOut = mOut;
          agrAny.pickupOdometer = mOut;
          agrAny.mileageIn = mIn;
          agrAny.returnOdometer = mIn;
          agrAny.fuelOut = fOut != null ? String(fOut) : agrAny.fuelOut;
          agrAny.pickupFuelLevel = fOut;
          agrAny.fuelIn = fIn != null ? String(fIn) : agrAny.fuelIn;
          agrAny.returnFuelLevel = fIn;
        }
      }

      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const bkMetaRows = await withSavepoint<
          Array<{
            ancillaries: unknown;
            additional_drivers: unknown;
            plate_number: string | null;
            vehicle_make: string | null;
            vehicle_model: string | null;
          }>
        >(
          tx,
          'bk_get_meta_extras',
          () =>
            tx.$queryRawUnsafe(
              `SELECT rb.ancillaries,
                      rb.additional_drivers,
                      COALESCE(v.plate_number, v.license_plate, v.registration_no) AS plate_number,
                      v.make AS vehicle_make,
                      v.model AS vehicle_model
                 FROM rental_bookings rb
                 LEFT JOIN vehicles v
                   ON v.id = rb.vehicle_id
                  AND v.tenant_id::text = rb.tenant_id::text
                WHERE rb.id::text = $1 AND rb.tenant_id::text = $2
                LIMIT 1`,
              booking.id,
              tenantId,
            ),
          [],
        );
        const drvRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'bk_get_add_drivers_tbl',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, full_name, nationality, date_of_birth, emirates_id,
                      passport_no, driving_license_no, license_issuing_country, license_expiry,
                      international_permit_no, international_permit_expiry, daily_fee, total_fee
                 FROM rental_additional_drivers
                WHERE booking_id = $1 AND tenant_id::text = $2
                ORDER BY created_at ASC`,
              booking.id,
              tenantId,
            ),
          [],
        );
        const bkAny = booking as unknown as Record<string, unknown>;
        const meta = bkMetaRows[0];
        bkAny.ancillaries = Array.isArray(meta?.ancillaries) ? meta.ancillaries : [];
        bkAny.additionalDrivers =
          drvRows.length > 0
            ? drvRows
            : Array.isArray(meta?.additional_drivers)
              ? meta.additional_drivers
              : [];
        if (booking.vehicleId && meta?.plate_number) {
          bkAny.vehicle = {
            id: booking.vehicleId,
            plateNumber: meta.plate_number,
            make: meta.vehicle_make,
            model: meta.vehicle_model,
          };
        }
      }

      return NextResponse.json(booking);
    } catch (e) {
      console.error('Error fetching booking:', e);
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const editDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'bookings',
    req.nextUrl.pathname,
  );
  if (editDenied) return editDenied;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    if ('status' in body && body.status !== undefined) {
      return NextResponse.json(
        { error: "Change a booking's status with confirm, activate, complete or cancel" },
        { status: 400 },
      );
    }

    const hasFinancialOverride =
      body.rateOverride === true ||
      body.dailyRate !== undefined ||
      body.totalAmount !== undefined ||
      body.deposit !== undefined ||
      body.securityDeposit !== undefined;

    if (hasFinancialOverride) {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'rates',
        req.nextUrl.pathname,
      );
      if (denied) return denied;
    }

    // Block modifying booking terms while a workflow approval is pending
    if (await approvalInProgress(tenantId, 'rental_booking', params.id)) {
      return NextResponse.json(
        { error: 'Cannot modify booking while an approval workflow is in progress' },
        { status: 409 },
      );
    }

    // Strict field whitelist — never allow deletedAt, bookingRef, id, tenantId
    const safeData: Record<string, unknown> = {};

    if (body.pickupDate !== undefined) {
      const d = parseDate(body.pickupDate);
      if (!d) return NextResponse.json({ error: 'Invalid pickupDate' }, { status: 400 });
      safeData.pickupDate = d;
    }
    if (body.dropoffDate !== undefined) {
      const d = parseDate(body.dropoffDate);
      if (!d) return NextResponse.json({ error: 'Invalid dropoffDate' }, { status: 400 });
      safeData.dropoffDate = d;
    }

    const nullableStringKeys = [
      'pickupLocation',
      'dropoffLocation',
      'vehicleCategory',
      'vehicleId',
      'notes',
      'channel',
      'currency',
    ] as const;
    for (const key of nullableStringKeys) {
      if (body[key] !== undefined) {
        safeData[key] =
          body[key] === null || String(body[key]).trim() === ''
            ? null
            : String(body[key]).trim();
      }
    }

    if (body.customerId !== undefined) {
      const cid = typeof body.customerId === 'string' ? body.customerId.trim() : '';
      if (!cid) return NextResponse.json({ error: 'Invalid customerId' }, { status: 400 });
      safeData.customerId = cid;
    }

    if (body.dailyRate !== undefined) {
      if (body.dailyRate === null || body.dailyRate === '') {
        safeData.dailyRate = null;
      } else {
        const n = Number(body.dailyRate);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Invalid dailyRate' }, { status: 400 });
        }
        safeData.dailyRate = round2(n);
      }
    }

    if (body.totalAmount !== undefined) {
      if (body.totalAmount === null || body.totalAmount === '') {
        safeData.totalAmount = null;
      } else {
        const n = Number(body.totalAmount);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Invalid totalAmount' }, { status: 400 });
        }
        safeData.totalAmount = round2(n);
      }
    }

    if (body.deposit !== undefined) {
      if (body.deposit !== null && body.deposit !== '') {
        const n = Number(body.deposit);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Invalid deposit' }, { status: 400 });
        }
        if (hasBookingModelField('deposit')) safeData.deposit = round2(n);
      } else if (hasBookingModelField('deposit')) {
        safeData.deposit = null;
      }
    }
    if (body.driverRequired !== undefined && hasBookingModelField('driverRequired')) {
      safeData.driverRequired = Boolean(body.driverRequired);
    }
    if (body.extras !== undefined && hasBookingModelField('extras')) {
      safeData.extras =
        typeof body.extras === 'string' ? body.extras : JSON.stringify(body.extras);
    }

    const allowCreditOverride = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
    );

    return await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { agreement: true, customer: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const currentStatus = String(existing.status ?? '').toUpperCase();
      if (TERMINAL_BOOKING_STATUSES.has(currentStatus)) {
        return NextResponse.json(
          { error: `Cannot modify a ${currentStatus} booking` },
          { status: 409 },
        );
      }

      const nextCustomerId =
        typeof safeData.customerId === 'string' ? safeData.customerId : existing.customerId;
      const nextVehicleId =
        'vehicleId' in safeData ? (safeData.vehicleId as string | null) : existing.vehicleId;
      const nextPickup = (safeData.pickupDate as Date | undefined) ?? existing.pickupDate;
      const nextDropoff = (safeData.dropoffDate as Date | undefined) ?? existing.dropoffDate;
      const nextCategory =
        ('vehicleCategory' in safeData
          ? (safeData.vehicleCategory as string | null)
          : existing.vehicleCategory) ?? 'ECONOMY';

      if (nextDropoff.getTime() < nextPickup.getTime()) {
        return NextResponse.json(
          { error: 'Drop-off date must be on or after the pickup date' },
          { status: 400 },
        );
      }

      const nextTotalDays = Math.max(
        1,
        Math.ceil((nextDropoff.getTime() - nextPickup.getTime()) / 86_400_000),
      );
      if (safeData.pickupDate !== undefined || safeData.dropoffDate !== undefined) {
        safeData.totalDays = nextTotalDays;
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: nextCustomerId,
        vehicleId: nextVehicleId,
        branchIds: [
          typeof body.pickupBranchId === 'string' ? body.pickupBranchId : null,
          typeof body.dropoffBranchId === 'string' ? body.dropoffBranchId : null,
        ],
      });

      const hasAncillaryPatch = body.ancillaries !== undefined || body.ancillaryIds !== undefined;
      const hasDriversPatch = body.additionalDrivers !== undefined;
      const patchedAncillaries = hasAncillaryPatch
        ? await resolvePatchAncillariesInTx(
            tx,
            tenantId,
            body.ancillaries,
            body.ancillaryIds,
            nextTotalDays,
          )
        : [];
      const patchedDrivers = hasDriversPatch
        ? assertAdditionalDriversEligible(body.additionalDrivers, {
            dropoffDate: nextDropoff,
            rentalDays: nextTotalDays,
            vehicleCategory: nextCategory,
          })
        : [];

      const pricingInputsChanged =
        safeData.pickupDate !== undefined ||
        safeData.dropoffDate !== undefined ||
        safeData.vehicleCategory !== undefined;

      // Re-quote from Master Price List when dates or category change without manual financial override
      if (pricingInputsChanged && !hasFinancialOverride) {
        const nextCustomer =
          nextCustomerId === existing.customerId
            ? existing.customer
            : await tx.rentalCustomer.findFirst({
                where: { id: nextCustomerId, tenantId, deletedAt: null },
              });
        const quote = await quoteRentalRateInTx(tx, tenantId, {
          vehicleCategory: nextCategory,
          pickupDate: nextPickup,
          dropoffDate: nextDropoff,
          pickupLocationCode:
            (('pickupLocation' in safeData
              ? (safeData.pickupLocation as string | null)
              : existing.pickupLocation) ?? undefined),
          dropoffLocationCode:
            (('dropoffLocation' in safeData
              ? (safeData.dropoffLocation as string | null)
              : existing.dropoffLocation) ?? undefined),
          customerType: nextCustomer?.customerType ?? 'INDIVIDUAL',
          corporateAccountId:
            nextCustomer?.customerType === 'CORPORATE' ? nextCustomer.id : undefined,
          channel:
            (('channel' in safeData
              ? (safeData.channel as string | null)
              : existing.channel) ?? 'DIRECT'),
          currency:
            (('currency' in safeData
              ? (safeData.currency as string | null)
              : existing.currency) ?? 'AED'),
        });

        if (quote.appliedRuleId != null && quote.dailyRate > 0) {
          safeData.dailyRate = quote.dailyRate;
          safeData.totalAmount = quote.totalAmount;
        } else if (existing.dailyRate != null && Number(existing.dailyRate) > 0) {
          const subtotal = round2(Number(existing.dailyRate) * nextTotalDays);
          const vat = round2(subtotal * 0.05);
          safeData.totalAmount = round2(subtotal + vat);
        }
      } else if (
        (safeData.dailyRate !== undefined ||
          safeData.pickupDate !== undefined ||
          safeData.dropoffDate !== undefined) &&
        safeData.totalAmount === undefined
      ) {
        // Recompute 5% UAE VAT totalAmount if overridden dailyRate changed without explicit totalAmount
        const effRate =
          safeData.dailyRate !== undefined
            ? (safeData.dailyRate as number | null)
            : existing.dailyRate != null
              ? Number(existing.dailyRate)
              : null;
        if (effRate !== null && effRate > 0) {
          const subtotal = round2(effRate * nextTotalDays);
          const vat = round2(subtotal * 0.05);
          safeData.totalAmount = round2(subtotal + vat);
        }
      }

      if ((hasAncillaryPatch || hasDriversPatch) && body.totalAmount === undefined) {
        const baseRate =
          safeData.dailyRate !== undefined
            ? Number(safeData.dailyRate ?? 0)
            : Number(existing.dailyRate ?? 0);
        const baseSubtotal = round2(baseRate * nextTotalDays);
        const extrasPreVat = round2(
          patchedAncillaries.reduce((s, a) => s + a.preVatTotal, 0) +
            patchedDrivers.reduce((s, d) => s + d.totalFee, 0),
        );
        const combinedSub = round2(baseSubtotal + extrasPreVat);
        if (combinedSub > 0) {
          safeData.totalAmount = round2(combinedSub + round2(combinedSub * 0.05));
        }
      }

      const effTotalAmount =
        safeData.totalAmount !== undefined
          ? Number(safeData.totalAmount ?? 0)
          : Number(existing.totalAmount ?? 0);

      if (
        nextCustomerId !== existing.customerId ||
        safeData.dropoffDate !== undefined ||
        safeData.vehicleCategory !== undefined ||
        safeData.dailyRate !== undefined ||
        safeData.totalAmount !== undefined
      ) {
        await assertCustomerEligibleForRental(tx, {
          tenantId,
          customerId: nextCustomerId,
          dropoffDate: nextDropoff,
          vehicleCategory: nextCategory,
          additionalExposureAed: effTotalAmount,
          excludeBookingId: existing.id,
          allowCreditOverride,
        });
      }

      const patchUnderLock = async () => {
        if (
          nextVehicleId &&
          (nextVehicleId !== existing.vehicleId ||
            safeData.pickupDate !== undefined ||
            safeData.dropoffDate !== undefined)
        ) {
          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId,
            vehicleId: nextVehicleId,
            startDate: nextPickup,
            endDate: nextDropoff,
            excludeBookingId: existing.id,
            excludeAgreementId: existing.agreement?.id ?? null,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            return NextResponse.json(
              { error: conflict.reason ?? 'Vehicle unavailable for requested dates' },
              { status: 409 },
            );
          }
        }

        const now = new Date();
        const booking = await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: {
            ...(safeData as Prisma.RentalBookingUncheckedUpdateInput),
            updatedAt: now,
          },
          include: { customer: true },
        });

        // Keep linked DRAFT agreement synchronized when booking dates/vehicle/rates change
        if (existing.agreement && String(existing.agreement.status ?? '').toUpperCase() === 'DRAFT') {
          await tx.rentalAgreement.update({
            where: { id: existing.agreement.id, tenantId },
            data: {
              customerId: nextCustomerId,
              vehicleId: nextVehicleId,
              startDate: nextPickup,
              endDate: nextDropoff,
              ...(safeData.dailyRate !== undefined
                ? { dailyRate: safeData.dailyRate as number | null }
                : {}),
              ...(safeData.totalAmount !== undefined
                ? { totalAmount: safeData.totalAmount as number | null }
                : {}),
              updatedAt: now,
            },
          });
        }

        // Synchronize physical Vehicle.status when vehicle assignment changes on a non-ACTIVE booking
        if (existing.vehicleId !== nextVehicleId && currentStatus !== 'ACTIVE') {
          if (existing.vehicleId) {
            await withSavepoint(
              tx,
              'patch_bk_release_old_veh',
              async () => {
                if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
                  const { status: safeOldStatus } = await computeSafePostRentalVehicleStatus(tx, {
                    tenantId,
                    vehicleId: existing.vehicleId!,
                    excludeAgreementId: existing.agreement?.id ?? null,
                    excludeBookingId: existing.id,
                  });
                  if (typeof tx.vehicle?.updateMany === 'function') {
                    await tx.vehicle.updateMany({
                      where: { id: existing.vehicleId!, tenantId, status: 'RESERVED' },
                      data: { status: safeOldStatus, updatedAt: now },
                    });
                  }
                }
              },
              undefined,
            );
          }

          if (nextVehicleId && currentStatus === 'CONFIRMED') {
            await withSavepoint(
              tx,
              'patch_bk_reserve_new_veh',
              async () => {
                if (typeof tx.vehicle?.updateMany === 'function') {
                  await tx.vehicle.updateMany({
                    where: { id: nextVehicleId, tenantId, status: 'AVAILABLE' },
                    data: { status: 'RESERVED', updatedAt: now },
                  });
                }
              },
              undefined,
            );
          }
        }

        if (
          (hasAncillaryPatch || hasDriversPatch) &&
          typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
        ) {
          if (hasAncillaryPatch) {
            await withSavepoint(
              tx,
              'patch_bk_upd_ancillaries_json',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_bookings SET ancillaries = $1::jsonb WHERE id = $2 AND tenant_id::text = $3`,
                  JSON.stringify(patchedAncillaries),
                  booking.id,
                  tenantId,
                ),
              0,
            );
          }
          if (hasDriversPatch) {
            await withSavepoint(
              tx,
              'patch_bk_upd_drivers_json',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_bookings SET additional_drivers = $1::jsonb WHERE id = $2 AND tenant_id::text = $3`,
                  JSON.stringify(patchedDrivers),
                  booking.id,
                  tenantId,
                ),
              0,
            );
            await withSavepoint(
              tx,
              'patch_bk_clear_old_drivers',
              () =>
                tx.$executeRawUnsafe(
                  `DELETE FROM rental_additional_drivers
                    WHERE booking_id = $1 AND tenant_id::text = $2 AND agreement_id IS NULL`,
                  booking.id,
                  tenantId,
                ),
              0,
            );
            if (patchedDrivers.length > 0) {
              await persistAdditionalDriversInTx(tx, {
                tenantId,
                bookingId: booking.id,
                drivers: patchedDrivers,
              });
            }
          }
        }

        if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const bkMetaRows = await withSavepoint<
          Array<{
            ancillaries: unknown;
            additional_drivers: unknown;
            plate_number: string | null;
            vehicle_make: string | null;
            vehicle_model: string | null;
          }>
        >(
          tx,
          'bk_get_meta_extras',
          () =>
            tx.$queryRawUnsafe(
              `SELECT rb.ancillaries,
                      rb.additional_drivers,
                      COALESCE(v.plate_number, v.license_plate, v.registration_no) AS plate_number,
                      v.make AS vehicle_make,
                      v.model AS vehicle_model
                 FROM rental_bookings rb
                 LEFT JOIN vehicles v
                   ON v.id = rb.vehicle_id
                  AND v.tenant_id::text = rb.tenant_id::text
                WHERE rb.id::text = $1 AND rb.tenant_id::text = $2
                LIMIT 1`,
              booking.id,
              tenantId,
            ),
          [],
        );
        const drvRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'bk_get_add_drivers_tbl',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, full_name, nationality, date_of_birth, emirates_id,
                      passport_no, driving_license_no, license_issuing_country, license_expiry,
                      international_permit_no, international_permit_expiry, daily_fee, total_fee
                 FROM rental_additional_drivers
                WHERE booking_id = $1 AND tenant_id::text = $2
                ORDER BY created_at ASC`,
              booking.id,
              tenantId,
            ),
          [],
        );
        const bkAny = booking as unknown as Record<string, unknown>;
        const meta = bkMetaRows[0];
        bkAny.ancillaries = Array.isArray(meta?.ancillaries) ? meta.ancillaries : [];
        bkAny.additionalDrivers =
          drvRows.length > 0
            ? drvRows
            : Array.isArray(meta?.additional_drivers)
              ? meta.additional_drivers
              : [];
        if (booking.vehicleId && meta?.plate_number) {
          bkAny.vehicle = {
            id: booking.vehicleId,
            plateNumber: meta.plate_number,
            make: meta.vehicle_make,
            model: meta.vehicle_model,
          };
        }
      }

      return NextResponse.json(booking);
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return withRentalLock(
          tx,
          tenantId,
          { entityKey: existing.id, vehicleIds: [existing.vehicleId, nextVehicleId] },
          patchUnderLock,
        );
      }
      return patchUnderLock();
    });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error updating booking:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'bookings',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { agreement: true },
      });
      if (!existing) {
        return { error: 'Not found', status: 404 as const };
      }

      const currentStatus = String(existing.status ?? '').toUpperCase();
      const agrStatus = String(existing.agreement?.status ?? '').toUpperCase();
      if (currentStatus === 'ACTIVE' || agrStatus === 'ACTIVE') {
        return {
          error: 'Cannot delete an ACTIVE booking; complete vehicle return first',
          status: 409 as const,
        };
      }

      const assignedVehicleId = existing.vehicleId ?? existing.agreement?.vehicleId ?? null;

      const deleteUnderLock = async () => {
        const now = new Date();
        await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: {
            deletedAt: now,
            ...(currentStatus === 'PENDING' || currentStatus === 'CONFIRMED'
              ? { status: 'CANCELLED' }
              : {}),
            updatedAt: now,
          },
        });

        if (existing.agreement && agrStatus === 'DRAFT') {
          await tx.rentalAgreement.update({
            where: { id: existing.agreement.id, tenantId },
            data: { status: 'CANCELLED', updatedAt: now },
          });
        }

        if (assignedVehicleId && (currentStatus === 'PENDING' || currentStatus === 'CONFIRMED')) {
          await withSavepoint(
            tx,
            'del_bk_release_veh',
            async () => {
              if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
                const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: assignedVehicleId,
                  excludeAgreementId: existing.agreement?.id ?? null,
                  excludeBookingId: existing.id,
                });
                if (typeof tx.vehicle?.updateMany === 'function') {
                  await tx.vehicle.updateMany({
                    where: {
                      id: assignedVehicleId,
                      tenantId,
                      status: 'RESERVED',
                    },
                    data: { status: safeStatus, updatedAt: now },
                  });
                }
              } else if (typeof tx.vehicle?.updateMany === 'function') {
                await tx.vehicle.updateMany({
                  where: {
                    id: assignedVehicleId,
                    tenantId,
                    status: 'RESERVED',
                  },
                  data: { status: 'AVAILABLE', updatedAt: now },
                });
              }
            },
            undefined,
          );
        }

        return { ok: true as const };
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return withRentalLock(
          tx,
          tenantId,
          { entityKey: existing.id, vehicleIds: [assignedVehicleId] },
          deleteUnderLock,
        );
      }
      return deleteUnderLock();
    });

    if ('error' in outcome && outcome.error) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    await withdrawApproval(tenantId, 'rental_booking', params.id, 'Booking deleted');
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error deleting booking:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
