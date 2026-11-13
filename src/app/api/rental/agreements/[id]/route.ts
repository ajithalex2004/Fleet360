export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { recordRacSecurityDepositCollected } from '@/lib/finance/rac-gl-posting';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';

const ALLOWED_STATUS_TRANSITIONS = new Set([
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
]);

function coerceFuelField(
  fieldName: 'fuelOut' | 'fuelIn',
  fuelPct: number | null,
): string | number | null {
  if (fuelPct == null) return null;
  const field = Prisma.dmmf?.datamodel?.models
    ?.find((m) => m.name === 'RentalAgreement')
    ?.fields?.find((f) => f.name === fieldName);
  if (field?.type === 'Int' || field?.type === 'Float' || field?.type === 'Decimal') {
    return fuelPct;
  }
  return String(fuelPct);
}

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
      const agreement = await tx.rentalAgreement.findFirst({
        where: { id: params.id, tenantId },
        include: {
          booking: { include: { customer: true, inspections: true } },
          payments: { orderBy: { createdAt: 'desc' } },
          extensions: { orderBy: { createdAt: 'desc' } },
          charges: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const rawRows = await withSavepoint<
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
          'agr_get_fuel_odo',
          () =>
            tx.$queryRawUnsafe(
              `SELECT pickup_odometer, return_odometer, mileage_out, mileage_in,
                      pickup_fuel_level, return_fuel_level, fuel_out, fuel_in
                 FROM rental_agreements
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              agreement.id,
              tenantId,
            ),
          [],
        );
        const raw = rawRows[0];
        if (raw) {
          const agrAny = agreement as unknown as Record<string, unknown>;
          const mOut = resolveStoredOdometerKm(raw.pickup_odometer, raw.mileage_out ?? agrAny.mileageOut);
          const mIn = resolveStoredOdometerKm(raw.return_odometer, raw.mileage_in ?? agrAny.mileageIn);
          const fOut = resolveStoredFuelPct(raw.pickup_fuel_level, raw.fuel_out ?? agrAny.fuelOut);
          const fIn = resolveStoredFuelPct(raw.return_fuel_level, raw.fuel_in ?? agrAny.fuelIn);
          agrAny.mileageOut = mOut;
          agrAny.pickupOdometer = mOut;
          agrAny.mileageIn = mIn;
          agrAny.returnOdometer = mIn;
          agrAny.fuelOut = fOut != null ? String(fOut) : null;
          agrAny.pickupFuelLevel = fOut;
          agrAny.fuelIn = fIn != null ? String(fIn) : null;
          agrAny.returnFuelLevel = fIn;
        }

        const agrAny = agreement as unknown as Record<string, unknown>;

        if (agreement.vehicleId) {
          const vehRows = await withSavepoint<
            Array<{
              id: string;
              plate_number: string | null;
              make: string | null;
              model: string | null;
              status: string | null;
              current_mileage: number | bigint | null;
              fuel_level: number | null;
            }>
          >(
            tx,
            'agr_get_vehicle',
            () =>
              tx.$queryRawUnsafe(
                `SELECT id::text AS id,
                        COALESCE(plate_number, license_plate, registration_no) AS plate_number,
                        make, model, status::text AS status, current_mileage, fuel_level
                   FROM vehicles
                  WHERE id = $1 AND tenant_id::text = $2
                  LIMIT 1`,
                agreement.vehicleId,
                tenantId,
              ),
            [],
          );
          if (vehRows[0]) {
            agrAny.vehicle = {
              id: vehRows[0].id,
              plateNumber: vehRows[0].plate_number,
              make: vehRows[0].make,
              model: vehRows[0].model,
              status: vehRows[0].status,
              currentMileage: Number(vehRows[0].current_mileage ?? 0),
              fuelLevel: vehRows[0].fuel_level,
            };
          }
        }

        const exchangeRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'agr_get_exchanges',
          () =>
            tx.$queryRawUnsafe(
              `SELECT rve.id::text AS id,
                      rve.exchange_no,
                      rve.from_vehicle_id,
                      rve.to_vehicle_id,
                      rve.reason,
                      rve.exchange_date,
                      rve.mileage_at_exchange,
                      rve.fuel_at_exchange,
                      rve.from_mileage_in,
                      rve.from_fuel_in,
                      rve.to_mileage_out,
                      rve.to_fuel_out,
                      rve.from_vehicle_status_after,
                      rve.rate_difference,
                      rve.processed_by,
                      rve.notes,
                      rve.created_at,
                      COALESCE(fv.plate_number, fv.license_plate, fv.registration_no) AS from_plate,
                      fv.make AS from_make,
                      fv.model AS from_model,
                      COALESCE(tv.plate_number, tv.license_plate, tv.registration_no) AS to_plate,
                      tv.make AS to_make,
                      tv.model AS to_model
                 FROM rental_vehicle_exchanges rve
                 LEFT JOIN vehicles fv ON fv.id = rve.from_vehicle_id AND fv.tenant_id::text = rve.tenant_id::text
                 LEFT JOIN vehicles tv ON tv.id = rve.to_vehicle_id AND tv.tenant_id::text = rve.tenant_id::text
                WHERE rve.agreement_id = $1
                  AND rve.tenant_id::text = $2
                ORDER BY rve.exchange_date DESC, rve.created_at DESC`,
              agreement.id,
              tenantId,
            ),
          [],
        );
        agrAny.vehicleExchanges = exchangeRows.map((ex) => ({
          id: String(ex.id),
          exchangeNo: (ex.exchange_no as string | null) ?? null,
          fromVehicleId: String(ex.from_vehicle_id),
          toVehicleId: String(ex.to_vehicle_id),
          reason: String(ex.reason ?? 'OTHER'),
          exchangeDate: ex.exchange_date,
          fromMileageIn: Number(ex.from_mileage_in ?? ex.mileage_at_exchange ?? 0),
          fromFuelIn: resolveStoredFuelPct(ex.from_fuel_in, ex.fuel_at_exchange),
          toMileageOut: ex.to_mileage_out != null ? Number(ex.to_mileage_out) : null,
          toFuelOut: ex.to_fuel_out != null ? Number(ex.to_fuel_out) : null,
          fromVehicleStatusAfter: (ex.from_vehicle_status_after as string | null) ?? null,
          rateDifference: ex.rate_difference != null ? Number(ex.rate_difference) : 0,
          processedBy: (ex.processed_by as string | null) ?? null,
          notes: (ex.notes as string | null) ?? null,
          fromVehicle: {
            id: String(ex.from_vehicle_id),
            plateNumber: (ex.from_plate as string | null) ?? null,
            make: (ex.from_make as string | null) ?? null,
            model: (ex.from_model as string | null) ?? null,
          },
          toVehicle: {
            id: String(ex.to_vehicle_id),
            plateNumber: (ex.to_plate as string | null) ?? null,
            make: (ex.to_make as string | null) ?? null,
            model: (ex.to_model as string | null) ?? null,
          },
        }));

        const addDrivers = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'agr_get_add_drivers',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, full_name, nationality, date_of_birth, emirates_id,
                      passport_no, driving_license_no, license_issuing_country, license_expiry,
                      international_permit_no, international_permit_expiry, daily_fee, total_fee
                 FROM rental_additional_drivers
                WHERE agreement_id = $1 AND tenant_id::text = $2
                ORDER BY created_at ASC`,
              agreement.id,
              tenantId,
            ),
          [],
        );
        agrAny.additionalDrivers = addDrivers;

        const regReports = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'agr_get_reg_reports',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, authority, event_type, status, external_ref,
                      error_message, submitted_at, submitted_by, created_at
                 FROM rental_regulatory_reports
                WHERE agreement_id = $1 AND tenant_id::text = $2
                ORDER BY created_at DESC`,
              agreement.id,
              tenantId,
            ),
          [],
        );
        agrAny.regulatoryReports = regReports;
      }

      return NextResponse.json(agreement);
    } catch {
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

  const editPermErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'agreements',
    req.nextUrl.pathname,
  );
  if (editPermErr) return editPermErr;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    // A deposit is refunded through /refund-deposit (Finance > Security
    // Deposits, with its approval), not by setting the status here.
    if (['REFUNDED', 'REFUND_REQUESTED'].includes(String(body.depositStatus ?? '').toUpperCase())) {
      return NextResponse.json(
        { error: 'Request the deposit refund instead (Refund Security Deposit)' },
        { status: 400 },
      );
    }
    if (body.depositStatus !== undefined) {
      return NextResponse.json(
        { error: 'Deposit status cannot be modified directly on the agreement' },
        { status: 400 },
      );
    }
    const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'staff';

    let targetStatus: string | undefined;
    if (body.status !== undefined && body.status !== null && body.status !== '') {
      const normalizedStatus = String(body.status).trim().toUpperCase();
      if (!ALLOWED_STATUS_TRANSITIONS.has(normalizedStatus)) {
        return NextResponse.json(
          { error: `Invalid agreement status: ${normalizedStatus}` },
          { status: 400 },
        );
      }
      if (normalizedStatus === 'CANCELLED') {
        const cancelPermErr = await requireRentalPermission(
          req.headers,
          tenantId,
          'delete',
          'bookings',
          req.nextUrl.pathname,
        );
        if (cancelPermErr) return cancelPermErr;
      }
      targetStatus = normalizedStatus;
    }

    // Rate / financial overrides require explicit `rental:approve:rates` permission
    if (body.dailyRate !== undefined || body.totalAmount !== undefined) {
      const permErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'rates',
        req.nextUrl.pathname,
      );
      if (permErr) return permErr;
    }

    // Whitelist safe editable fields to prevent mass-assignment
    const safeData: Record<string, unknown> = {};

    const stringKeys = ['notes', 'terms', 'openBranchId', 'closeBranchId', 'signedBy'] as const;
    for (const key of stringKeys) {
      if (body[key] !== undefined) {
        safeData[key] = body[key] === null ? null : String(body[key]);
      }
    }

    const rawMileageOut = body.mileageOut !== undefined ? body.mileageOut : body.pickupOdometer;
    if (rawMileageOut !== undefined) {
      if (rawMileageOut === null || rawMileageOut === '') {
        safeData.mileageOut = null;
      } else {
        const n = Number(rawMileageOut);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Invalid mileageOut' }, { status: 400 });
        }
        safeData.mileageOut = Math.round(n);
      }
    }

    const rawMileageIn = body.mileageIn !== undefined ? body.mileageIn : body.returnOdometer;
    if (rawMileageIn !== undefined) {
      if (rawMileageIn === null || rawMileageIn === '') {
        safeData.mileageIn = null;
      } else {
        const n = Number(rawMileageIn);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Invalid mileageIn' }, { status: 400 });
        }
        safeData.mileageIn = Math.round(n);
      }
    }

    const hasPickupFuelInput =
      body.fuelOut !== undefined ||
      body.pickupFuelLevel !== undefined ||
      body.fuelOutPct !== undefined ||
      body.pickupFuelPct !== undefined;
    const pickupFuelPct = hasPickupFuelInput
      ? resolveInputFuelPct(body, 'pickup', 'PCT')
      : undefined;
    if (hasPickupFuelInput) {
      safeData.fuelOut = coerceFuelField('fuelOut', pickupFuelPct ?? null);
    }

    const hasReturnFuelInput =
      body.fuelIn !== undefined ||
      body.returnFuelLevel !== undefined ||
      body.fuelInPct !== undefined ||
      body.returnFuelPct !== undefined;
    const returnFuelPct = hasReturnFuelInput
      ? resolveInputFuelPct(body, 'return', 'PCT')
      : undefined;
    if (hasReturnFuelInput) {
      safeData.fuelIn = coerceFuelField('fuelIn', returnFuelPct ?? null);
    }

    if (body.signedAt !== undefined) {
      if (body.signedAt === null || body.signedAt === '') {
        safeData.signedAt = null;
      } else {
        const dt = new Date(String(body.signedAt));
        if (Number.isNaN(dt.getTime())) {
          return NextResponse.json({ error: 'Invalid signedAt date' }, { status: 400 });
        }
        safeData.signedAt = dt;
      }
    }

    const rateKeys = ['dailyRate', 'totalAmount'] as const;
    for (const key of rateKeys) {
      if (body[key] !== undefined) {
        if (body[key] === null || body[key] === '') {
          safeData[key] = null;
        } else {
          const n = Number(body[key]);
          if (!Number.isFinite(n) || n < 0) {
            return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
          }
          safeData[key] = n;
        }
      }
    }

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalAgreement.findFirst({
        where: { id: params.id, tenantId },
        include: { booking: { include: { customer: true } } },
      });
      if (!existing) {
        return { error: 'Not found', status: 404 as const };
      }

      const currentStatus = String(existing.status ?? '').toUpperCase();
      if (currentStatus === 'CLOSED' || currentStatus === 'CANCELLED') {
        return {
          error: `Cannot modify a ${currentStatus} rental agreement`,
          status: 409 as const,
        };
      }

      if (targetStatus === 'CANCELLED' && currentStatus === 'ACTIVE') {
        return {
          error:
            'Cannot cancel an ACTIVE rental agreement after vehicle handover; process vehicle return instead',
          status: 409 as const,
        };
      }

      if (
        targetStatus === 'ACTIVE' &&
        currentStatus !== 'ACTIVE' &&
        !['DRAFT', 'CONFIRMED'].includes(currentStatus)
      ) {
        return {
          error: `Cannot activate a rental agreement from status ${currentStatus}`,
          status: 409 as const,
        };
      }

      // Resolve stored pickup/return odometer from both SQL column pairs so validation never misses pickup_odometer
      let storedPickupOdo = resolveStoredOdometerKm(existing.mileageOut);
      let storedReturnOdo = resolveStoredOdometerKm(existing.mileageIn);
      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const odoRows = await withSavepoint<
          Array<{
            pickup_odometer: number | null;
            return_odometer: number | null;
            mileage_out: number | null;
            mileage_in: number | null;
          }>
        >(
          tx,
          'agr_patch_read_odo',
          () =>
            tx.$queryRawUnsafe(
              `SELECT pickup_odometer, return_odometer, mileage_out, mileage_in
                 FROM rental_agreements
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              existing.id,
              tenantId,
            ),
          [],
        );
        if (odoRows[0]) {
          storedPickupOdo = resolveStoredOdometerKm(
            odoRows[0].pickup_odometer,
            odoRows[0].mileage_out ?? existing.mileageOut,
          );
          storedReturnOdo = resolveStoredOdometerKm(
            odoRows[0].return_odometer,
            odoRows[0].mileage_in ?? existing.mileageIn,
          );
        }
      }

      const effOut =
        safeData.mileageOut !== undefined
          ? (safeData.mileageOut as number | null)
          : storedPickupOdo;
      const effIn =
        safeData.mileageIn !== undefined
          ? (safeData.mileageIn as number | null)
          : storedReturnOdo;
      if (effOut != null && effIn != null && Number(effIn) < Number(effOut)) {
        return {
          error: 'mileageIn cannot be less than mileageOut',
          status: 422 as const,
        };
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        branchIds: [
          typeof safeData.openBranchId === 'string' ? safeData.openBranchId : null,
          typeof safeData.closeBranchId === 'string' ? safeData.closeBranchId : null,
        ],
      });

      const targetVehicleId = existing.vehicleId ?? existing.booking?.vehicleId ?? null;

      const patchUnderLock = async () => {
        const now = new Date();
        if (targetStatus !== undefined) {
          safeData.status = targetStatus;
        }

        if (targetStatus === 'ACTIVE' && currentStatus !== 'ACTIVE') {
          if (targetVehicleId && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
            const vehRows = await withSavepoint<Array<{ status: string | null }>>(
              tx,
              'agr_patch_chk_veh_status',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT status::text AS status FROM vehicles WHERE id = $1 AND tenant_id::text = $2 LIMIT 1`,
                  targetVehicleId,
                  tenantId,
                ),
              [],
            );
            const vehStatus = String(vehRows[0]?.status ?? '').toUpperCase();
            if (['GROUNDED', 'MAINTENANCE', 'INACTIVE'].includes(vehStatus)) {
              return {
                error: `Cannot activate agreement: vehicle is in ${vehStatus} status`,
                status: 409 as const,
              };
            }

            const conflict = await checkVehicleRentalConflict(tx, {
              tenantId,
              vehicleId: targetVehicleId,
              startDate: existing.startDate,
              endDate: existing.endDate,
              excludeBookingId: existing.bookingId,
              excludeAgreementId: existing.id,
              checkGrounding: true,
            });
            if (conflict.hasConflict) {
              return {
                error: conflict.reason ?? 'Vehicle has a conflicting reservation',
                status: 409 as const,
              };
            }
          }

          if (safeData.signedAt === undefined && !existing.signedAt) {
            safeData.signedAt = now;
          }
          if (safeData.signedBy === undefined && !existing.signedBy) {
            safeData.signedBy = actorUserId;
          }
        }

        const agreement = await tx.rentalAgreement.update({
          where: { id: params.id, tenantId },
          data: {
            ...(safeData as Prisma.RentalAgreementUncheckedUpdateInput),
            updatedAt: now,
          },
        });

        // Synchronize dual SQL columns for pickup/return odometer & canonical 0-100% fuel
        const syncPickupOdo = safeData.mileageOut !== undefined;
        const syncReturnOdo = safeData.mileageIn !== undefined;
        const syncClosedCols = targetStatus === 'CLOSED';
        if (
          typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function' &&
          (syncPickupOdo || syncReturnOdo || hasPickupFuelInput || hasReturnFuelInput || syncClosedCols)
        ) {
          const sets: string[] = [];
          const sqlParams: unknown[] = [];
          let pi = 1;
          if (syncPickupOdo) {
            sets.push(`pickup_odometer = $${pi}`, `mileage_out = $${pi}`);
            sqlParams.push(safeData.mileageOut);
            pi++;
          }
          if (hasPickupFuelInput) {
            sets.push(`pickup_fuel_level = $${pi}`);
            sqlParams.push(pickupFuelPct ?? null);
            pi++;
          }
          if (syncReturnOdo) {
            sets.push(`return_odometer = $${pi}`, `mileage_in = $${pi}`);
            sqlParams.push(safeData.mileageIn);
            pi++;
          }
          if (hasReturnFuelInput) {
            sets.push(`return_fuel_level = $${pi}`);
            sqlParams.push(returnFuelPct ?? null);
            pi++;
          }
          if (syncClosedCols) {
            sets.push(`closed_at = COALESCE(closed_at, $${pi})`, `closed_by = COALESCE(closed_by, $${pi + 1})`);
            sqlParams.push(now, actorUserId);
            pi += 2;
          }
          sqlParams.push(existing.id, tenantId);
          await withSavepoint(
            tx,
            'agr_patch_sync_dual_cols',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET ${sets.join(', ')}
                  WHERE id::text = $${pi}
                    AND tenant_id::text = $${pi + 1}`,
                ...sqlParams,
              ),
            0,
          );
        }

        // Synchronize RentalBooking.status and physical Vehicle.status on lifecycle transitions
        if (targetStatus && targetStatus !== currentStatus) {
          if (targetStatus === 'ACTIVE') {
            if (existing.bookingId && typeof tx.rentalBooking?.updateMany === 'function') {
              await tx.rentalBooking.updateMany({
                where: { id: existing.bookingId, tenantId },
                data: { status: 'ACTIVE', updatedAt: now },
              });
            }
            if (targetVehicleId && typeof tx.vehicle?.updateMany === 'function') {
              await withSavepoint(
                tx,
                'agr_patch_veh_rented',
                () =>
                  tx.vehicle.updateMany({
                    where: { id: targetVehicleId, tenantId },
                    data: { status: 'RENTED', updatedAt: now },
                  }),
                { count: 0 },
              );
            }

            const depAmt = Number(agreement.securityDeposit ?? existing.securityDeposit ?? 0);
            const depSt = String(agreement.depositStatus ?? existing.depositStatus ?? '').toUpperCase();
            if (depAmt > 0 && depSt === 'PAID') {
              await recordRacSecurityDepositCollected(tx, {
                tenantId,
                agreementId: agreement.id,
                agreementNo: agreement.agreementNo ?? null,
                customerName: existing.booking?.customer?.fullName ?? 'Rental Customer',
                branch: agreement.openBranchId ?? existing.booking?.pickupLocation ?? null,
                amount: depAmt,
                collectionMethod: 'CARD',
                currency: agreement.currency ?? 'AED',
                preparedBy: actorUserId,
              });
            }
          } else if (targetStatus === 'COMPLETED' || targetStatus === 'CLOSED') {
            if (existing.bookingId && typeof tx.rentalBooking?.updateMany === 'function') {
              await tx.rentalBooking.updateMany({
                where: { id: existing.bookingId, tenantId },
                data: { status: 'COMPLETED', updatedAt: now },
              });
            }
            if (targetVehicleId) {
              await withSavepoint(
                tx,
                'agr_patch_veh_release_complete',
                async () => {
                  if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function' && typeof tx.vehicle?.updateMany === 'function') {
                    const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                      tenantId,
                      vehicleId: targetVehicleId,
                      excludeAgreementId: existing.id,
                      excludeBookingId: existing.bookingId,
                    });
                    await tx.vehicle.updateMany({
                      where: { id: targetVehicleId, tenantId, status: { in: ['RENTED', 'RESERVED'] } },
                      data: { status: safeStatus, updatedAt: now },
                    });
                  }
                },
                undefined,
              );
            }
          } else if (targetStatus === 'CANCELLED') {
            if (existing.bookingId && typeof tx.rentalBooking?.updateMany === 'function') {
              await tx.rentalBooking.updateMany({
                where: {
                  id: existing.bookingId,
                  tenantId,
                  status: { in: ['PENDING', 'CONFIRMED'] },
                },
                data: { status: 'CANCELLED', updatedAt: now },
              });
            }
            if (targetVehicleId) {
              await withSavepoint(
                tx,
                'agr_patch_veh_release_cancel',
                async () => {
                  if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function' && typeof tx.vehicle?.updateMany === 'function') {
                    const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                      tenantId,
                      vehicleId: targetVehicleId,
                      excludeAgreementId: existing.id,
                      excludeBookingId: existing.bookingId,
                    });
                    await tx.vehicle.updateMany({
                      where: { id: targetVehicleId, tenantId, status: { in: ['RESERVED', 'RENTED'] } },
                      data: { status: safeStatus, updatedAt: now },
                    });
                  }
                },
                undefined,
              );
            }
          }
        }

        let regulatoryReport: UaeRegulatoryReportRecord | null = null;
        if (
          targetStatus === 'ACTIVE' &&
          currentStatus !== 'ACTIVE' &&
          typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function'
        ) {
          regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
            tx,
            'agr_patch_active_reg_report',
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

        return { agreement, regulatoryReport };
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return withRentalLock(
          tx,
          tenantId,
          { entityKey: existing.id, vehicleIds: [targetVehicleId] },
          patchUnderLock,
        );
      }
      return patchUnderLock();
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.regulatoryReport?.status === 'QUEUED') {
      try {
        const dispatched = await dispatchUaeRegulatoryReportOutsideRls(result.regulatoryReport);
        (result.agreement as unknown as Record<string, unknown>).regulatoryReport = dispatched;
      } catch {
        // Non-fatal: report remains QUEUED in rental_regulatory_reports
      }
    }

    return NextResponse.json(result.agreement);
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
