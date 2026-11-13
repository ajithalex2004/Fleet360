export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/rental/agreements/[id]/exchange
 *
 * Mid-rental Vehicle Swap / Exchange workflow:
 *   - Locks BOTH `fromVehicleId` and `toVehicleId` in deterministic sorted order (`withRentalLock`)
 *   - Verifies replacement vehicle availability & grounding (`checkVehicleRentalConflict`)
 *   - Issues per-tenant `VEX-XXXXXX` serial under `lockRentalSerial`
 *   - Records split segment readings (`from_mileage_in`, `from_fuel_in`, `to_mileage_out`, `to_fuel_out`)
 *     alongside legacy `mileage_at_exchange` / `fuel_at_exchange` for seamless multi-segment return settlement
 *   - Safely transitions `fromVehicle` (`MAINTENANCE` for breakdown/maintenance, else `AVAILABLE`)
 *     and marks `toVehicle` `RENTED`
 *   - Adds pro-rata `VEHICLE_UPGRADE` charge (`rental_additional_charges`) when `rateDifference > 0`
 *   - Queues UAE Tarrashud / ITC `VEHICLE_SWAP` regulatory manifest and dispatches post-commit
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  lockRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  normalizeFuelToPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import { logAudit } from '@/lib/audit';

const ALLOWED_SWAP_REASONS = [
  'BREAKDOWN',
  'UPGRADE',
  'CUSTOMER_REQUEST',
  'MAINTENANCE',
  'OTHER',
] as const;

const exchangeBodySchema = z
  .object({
    toVehicleId: z.string().min(1),
    reason: z.enum(ALLOWED_SWAP_REASONS).default('BREAKDOWN'),
    fromMileageIn: z.coerce.number().int().min(0).optional(),
    mileageAtExchange: z.coerce.number().int().min(0).optional(),
    fromFuelIn: z.union([z.coerce.number().min(0).max(100), z.string()]).optional(),
    fuelAtExchange: z.union([z.coerce.number().min(0).max(100), z.string()]).optional(),
    fromFuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    toMileageOut: z.coerce.number().int().min(0).optional(),
    toFuelOut: z.union([z.coerce.number().min(0).max(100), z.string()]).optional(),
    toFuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    fromVehicleStatusAfter: z.enum(['AVAILABLE', 'MAINTENANCE']).optional(),
    rateDifference: z.coerce.number().optional().default(0),
    inspectionInId: z.string().optional(),
    inspectionOutId: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .passthrough();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const agreementId = params.id?.trim();

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const agreement = await tx.rentalAgreement.findFirst({
        where: { id: agreementId, tenantId },
        select: {
          id: true,
          agreementNo: true,
          status: true,
          vehicleId: true,
          startDate: true,
          endDate: true,
        },
      });
      if (!agreement) {
        return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
      }

      const rows = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'vex_list_split',
        () =>
          tx.$queryRawUnsafe(
            `SELECT rve.id::text AS id,
                    rve.exchange_no,
                    rve.agreement_id,
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
               LEFT JOIN vehicles fv
                 ON fv.id = rve.from_vehicle_id
                AND fv.tenant_id::text = rve.tenant_id::text
               LEFT JOIN vehicles tv
                 ON tv.id = rve.to_vehicle_id
                AND tv.tenant_id::text = rve.tenant_id::text
              WHERE rve.agreement_id = $1
                AND rve.tenant_id::text = $2
              ORDER BY rve.exchange_date DESC, rve.created_at DESC`,
            agreementId,
            tenantId,
          ),
        [],
      );

      const exchanges = rows.map((r) => ({
        id: String(r.id),
        exchangeNo: (r.exchange_no as string | null) ?? null,
        agreementId: String(r.agreement_id),
        fromVehicleId: String(r.from_vehicle_id),
        toVehicleId: String(r.to_vehicle_id),
        reason: String(r.reason ?? 'OTHER'),
        exchangeDate: r.exchange_date ? new Date(String(r.exchange_date)).toISOString() : null,
        fromMileageIn: Number(r.from_mileage_in ?? r.mileage_at_exchange ?? 0),
        fromFuelIn: resolveStoredFuelPct(r.from_fuel_in, r.fuel_at_exchange),
        toMileageOut: r.to_mileage_out != null ? Number(r.to_mileage_out) : null,
        toFuelOut: r.to_fuel_out != null ? Number(r.to_fuel_out) : null,
        fromVehicleStatusAfter: (r.from_vehicle_status_after as string | null) ?? null,
        rateDifference: r.rate_difference != null ? Number(r.rate_difference) : 0,
        processedBy: (r.processed_by as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        fromVehicle: {
          id: String(r.from_vehicle_id),
          plateNumber: (r.from_plate as string | null) ?? null,
          make: (r.from_make as string | null) ?? null,
          model: (r.from_model as string | null) ?? null,
        },
        toVehicle: {
          id: String(r.to_vehicle_id),
          plateNumber: (r.to_plate as string | null) ?? null,
          make: (r.to_make as string | null) ?? null,
          model: (r.to_model as string | null) ?? null,
        },
      }));

      return NextResponse.json({ agreement, exchanges });
    } catch (err) {
      console.error('[GET /api/rental/agreements/[id]/exchange] error:', err);
      return NextResponse.json({ error: 'Failed to load vehicle exchanges' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const agreementId = params.id?.trim();

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  if (!agreementId) {
    return NextResponse.json({ error: 'Agreement ID is required' }, { status: 400 });
  }

  try {
    const rawBody = await req.json();
    const cleanBody = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const parsed = exchangeBodySchema.safeParse(cleanBody);
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
    const toVehicleId = data.toVehicleId.trim();

    const fromMileageIn = data.fromMileageIn ?? data.mileageAtExchange;
    if (fromMileageIn === undefined || fromMileageIn === null || fromMileageIn < 0) {
      return NextResponse.json(
        { error: 'fromMileageIn (returned vehicle odometer km) is required' },
        { status: 400 },
      );
    }

    const rawFromFuel = data.fromFuelIn ?? data.fuelAtExchange;
    const fromFuelIn =
      rawFromFuel !== undefined
        ? normalizeFuelToPct(rawFromFuel, {
            unit: data.fromFuelUnit,
            defaultUnitFor0To8: 'PCT',
          })
        : null;
    if (fromFuelIn === null) {
      return NextResponse.json(
        { error: 'fromFuelIn (returned vehicle fuel 0..100%) is required' },
        { status: 400 },
      );
    }

    const explicitToFuelOut =
      data.toFuelOut !== undefined
        ? normalizeFuelToPct(data.toFuelOut, {
            unit: data.toFuelUnit,
            defaultUnitFor0To8: 'PCT',
          })
        : null;

    const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'counter-staff';

    const txOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const agreement = await tx.rentalAgreement.findFirst({
        where: { id: agreementId, tenantId },
      });
      if (!agreement) {
        return { kind: 'err' as const, status: 404, error: 'Rental agreement not found' };
      }

      const agrStatus = String(agreement.status ?? '').toUpperCase();
      if (agrStatus !== 'ACTIVE') {
        return {
          kind: 'err' as const,
          status: 409,
          error: `Only ACTIVE agreements can exchange vehicles (current status: ${agreement.status})`,
        };
      }

      const fromVehicleId = agreement.vehicleId?.trim() || null;
      if (!fromVehicleId) {
        return {
          kind: 'err' as const,
          status: 422,
          error: 'Agreement does not have an active vehicle assigned to exchange from',
        };
      }

      if (fromVehicleId === toVehicleId) {
        return {
          kind: 'err' as const,
          status: 400,
          error: 'Replacement vehicle must be different from the currently assigned vehicle',
        };
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        vehicleId: toVehicleId,
      });

      return withRentalLock(
        tx,
        tenantId,
        { entityKey: agreement.id, vehicleIds: [fromVehicleId, toVehicleId] },
        async () => {
          // 1. Inspect both physical vehicles under deterministic lock
          const vehRows = await tx.$queryRawUnsafe<
            Array<{
              id: string;
              plate_number: string | null;
              make: string | null;
              model: string | null;
              status: string | null;
              is_active: boolean | null;
              current_mileage: number | bigint | null;
              fuel_level: number | null;
            }>
          >(
            `SELECT id::text AS id,
                    COALESCE(plate_number, license_plate, registration_no) AS plate_number,
                    make,
                    model,
                    status::text AS status,
                    is_active,
                    current_mileage,
                    fuel_level
               FROM vehicles
              WHERE tenant_id::text = $1
                AND id::text = ANY($2::text[])`,
            tenantId,
            [fromVehicleId, toVehicleId],
          );

          const fromVeh = vehRows.find((v) => v.id === fromVehicleId);
          const toVeh = vehRows.find((v) => v.id === toVehicleId);
          if (!toVeh) {
            return {
              kind: 'err' as const,
              status: 404,
              error: 'Replacement vehicle not found in tenant',
            };
          }

          const toStatus = String(toVeh.status ?? '').toUpperCase();
          if (
            toVeh.is_active === false ||
            ['GROUNDED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE', 'DISPOSED', 'SOLD', 'RENTED'].includes(
              toStatus,
            )
          ) {
            return {
              kind: 'err' as const,
              status: 409,
              error: `Replacement vehicle (${toVeh.plate_number ?? toVehicleId}) is currently ${toStatus || 'UNAVAILABLE'}`,
            };
          }

          const now = new Date();
          const windowEnd =
            agreement.endDate && new Date(agreement.endDate) > now
              ? new Date(agreement.endDate)
              : new Date(now.getTime() + 86_400_000);

          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId,
            vehicleId: toVehicleId,
            startDate: now,
            endDate: windowEnd,
            excludeBookingId: agreement.bookingId ?? null,
            excludeAgreementId: agreement.id,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            return {
              kind: 'err' as const,
              status: 409,
              error:
                conflict.reason ??
                `Replacement vehicle (${toVeh.plate_number ?? toVehicleId}) has a conflicting reservation`,
            };
          }

          // 2. Validate odometer continuity for the returned segment vehicle
          const priorSwapRows = await withSavepoint<
            Array<{ to_mileage_out: number | null }>
          >(
            tx,
            'vex_read_prior_swap_odo',
            () =>
              tx.$queryRawUnsafe(
                `SELECT to_mileage_out
                   FROM rental_vehicle_exchanges
                  WHERE agreement_id = $1 AND tenant_id::text = $2
                  ORDER BY exchange_date DESC, created_at DESC
                  LIMIT 1`,
                agreement.id,
                tenantId,
              ),
            [],
          );

          let currentSegmentStartKm = 0;
          if (priorSwapRows[0]?.to_mileage_out != null) {
            currentSegmentStartKm = Number(priorSwapRows[0].to_mileage_out);
          } else {
            const agrOdoRows = await withSavepoint<
              Array<{ pickup_odometer: number | null; mileage_out: number | null }>
            >(
              tx,
              'vex_read_agr_odo',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT pickup_odometer, mileage_out
                     FROM rental_agreements
                    WHERE id = $1 AND tenant_id::text = $2
                    LIMIT 1`,
                  agreement.id,
                  tenantId,
                ),
              [],
            );
            currentSegmentStartKm =
              resolveStoredOdometerKm(
                agrOdoRows[0]?.pickup_odometer,
                agrOdoRows[0]?.mileage_out ?? agreement.mileageOut,
              ) ?? 0;
          }

          if (fromMileageIn < currentSegmentStartKm) {
            return {
              kind: 'err' as const,
              status: 422,
              error: `Returned vehicle odometer (${fromMileageIn.toLocaleString()} km) cannot be less than its segment dispatch odometer (${currentSegmentStartKm.toLocaleString()} km)`,
            };
          }

          const resolvedToMileageOut =
            data.toMileageOut ?? Math.max(0, Number(toVeh.current_mileage ?? 0));
          const resolvedToFuelOut =
            explicitToFuelOut ??
            normalizeFuelToPct(toVeh.fuel_level ?? 100, { defaultUnitFor0To8: 'PCT' }) ??
            100;

          const desiredFromStatus: 'MAINTENANCE' | 'AVAILABLE' =
            data.fromVehicleStatusAfter ??
            (data.reason === 'BREAKDOWN' || data.reason === 'MAINTENANCE'
              ? 'MAINTENANCE'
              : 'AVAILABLE');

          const safeFromVeh = await computeSafePostRentalVehicleStatus(tx, {
            tenantId,
            vehicleId: fromVehicleId,
            excludeAgreementId: agreement.id,
            excludeBookingId: agreement.bookingId ?? null,
            preferredStatus: desiredFromStatus,
          });

          // 3. Serialize per-tenant VEX-XXXXXX exchange number
          await lockRentalSerial(tx, tenantId, 'VEX');
          const seqRows = await withSavepoint<Array<{ max_seq: string | number | bigint }>>(
            tx,
            'vex_next_serial',
            () =>
              tx.$queryRawUnsafe(
                `SELECT COALESCE(MAX((SUBSTRING(exchange_no FROM '([0-9]+)$'))::bigint), 0) AS max_seq
                   FROM rental_vehicle_exchanges
                  WHERE tenant_id::text = $1
                    AND exchange_no LIKE 'VEX-%'`,
                tenantId,
              ),
            [{ max_seq: 0 }],
          );
          const nextSeq = Number(seqRows[0]?.max_seq ?? 0) + 1;
          const exchangeNo = `VEX-${String(nextSeq).padStart(6, '0')}`;
          const exchangeId = crypto.randomUUID();
          const rateDiff = round2(Number(data.rateDifference ?? 0));

          const insertedSplit = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'vex_insert_split',
            () =>
              tx.$queryRawUnsafe(
                `INSERT INTO rental_vehicle_exchanges
                   (id, tenant_id, agreement_id, exchange_no, from_vehicle_id, to_vehicle_id,
                    reason, exchange_date, mileage_at_exchange, fuel_at_exchange,
                    from_mileage_in, from_fuel_in, to_mileage_out, to_fuel_out,
                    from_vehicle_status_after, inspection_in_id, inspection_out_id,
                    rate_difference, processed_by, notes, created_at)
                 VALUES
                   ($1, $2, $3, $4, $5, $6,
                    $7, NOW(), $8, $9,
                    $8, $10, $11, $12,
                    $13, $14, $15,
                    $16, $17, $18, NOW())
                 RETURNING *`,
                exchangeId,
                tenantId,
                agreement.id,
                exchangeNo,
                fromVehicleId,
                toVehicleId,
                data.reason,
                fromMileageIn,
                String(fromFuelIn),
                fromFuelIn,
                resolvedToMileageOut,
                resolvedToFuelOut,
                safeFromVeh.status,
                data.inspectionInId ?? null,
                data.inspectionOutId ?? null,
                rateDiff,
                actorUserId,
                data.notes ?? null,
              ),
            [],
          );

          if (insertedSplit.length === 0) {
            await tx.$executeRawUnsafe(
              `INSERT INTO rental_vehicle_exchanges
                 (id, tenant_id, agreement_id, from_vehicle_id, to_vehicle_id,
                  reason, exchange_date, mileage_at_exchange, fuel_at_exchange,
                  rate_difference, processed_by, notes, created_at)
               VALUES
                 ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, NOW())`,
              exchangeId,
              tenantId,
              agreement.id,
              fromVehicleId,
              toVehicleId,
              data.reason,
              fromMileageIn,
              String(fromFuelIn),
              rateDiff,
              actorUserId,
              data.notes ?? null,
            );
          }

          // 4. Transition returned vehicle & replacement vehicle statuses + telemetry
          await tx.$executeRawUnsafe(
            `UPDATE vehicles
                SET status = $1,
                    current_mileage = GREATEST(COALESCE(current_mileage, 0), $2::bigint),
                    fuel_level = $3,
                    updated_at = NOW()
              WHERE id = $4 AND tenant_id::text = $5`,
            safeFromVeh.status,
            fromMileageIn,
            fromFuelIn,
            fromVehicleId,
            tenantId,
          );

          await tx.$executeRawUnsafe(
            `UPDATE vehicles
                SET status = 'RENTED',
                    current_mileage = GREATEST(COALESCE(current_mileage, 0), $1::bigint),
                    fuel_level = $2,
                    updated_at = NOW()
              WHERE id = $3 AND tenant_id::text = $4`,
            resolvedToMileageOut,
            resolvedToFuelOut,
            toVehicleId,
            tenantId,
          );

          // 5. Point agreement (and linked booking) to the replacement vehicle
          const updatedAgreement = await tx.rentalAgreement.update({
            where: { id: agreement.id, tenantId },
            data: {
              vehicleId: toVehicleId,
              updatedAt: now,
            },
          });

          if (agreement.bookingId) {
            await tx.rentalBooking.updateMany({
              where: { id: agreement.bookingId, tenantId },
              data: { vehicleId: toVehicleId, updatedAt: now },
            });
          }

          // 6. Pro-rata upgrade charge for remaining rental days when rateDifference > 0
          let upgradeCharge: {
            remainingDays: number;
            dailyDifference: number;
            preVatSubtotal: number;
            grossTotal: number;
          } | null = null;
          if (rateDiff > 0) {
            const remainingDays = Math.max(
              1,
              Math.ceil(
                (new Date(agreement.endDate).getTime() - now.getTime()) / 86_400_000,
              ),
            );
            const preVatSub = round2(rateDiff * remainingDays);
            const vatAmt = round2(preVatSub * 0.05);
            const grossAmt = round2(preVatSub + vatAmt);

            await withSavepoint(
              tx,
              'vex_insert_upgrade_charge',
              () =>
                tx.$executeRawUnsafe(
                  `INSERT INTO rental_additional_charges
                     (id, tenant_id, agreement_id, charge_type, description,
                      quantity, amount, vat_rate, vat_amount, total_amount,
                      billed_to_customer, created_by, created_at)
                   VALUES
                     ($1, $2, $3, 'VEHICLE_UPGRADE', $4,
                      $5, $6, 5, $7, $8,
                      true, $9, NOW())`,
                  crypto.randomUUID(),
                  tenantId,
                  agreement.id,
                  `Vehicle Swap Upgrade (${exchangeNo}): ${fromVeh?.plate_number ?? fromVehicleId.slice(0, 8)} → ${toVeh.plate_number ?? toVehicleId.slice(0, 8)}`,
                  remainingDays,
                  rateDiff,
                  vatAmt,
                  grossAmt,
                  actorUserId,
                ),
              0,
            );
            upgradeCharge = {
              remainingDays,
              dailyDifference: rateDiff,
              preVatSubtotal: preVatSub,
              grossTotal: grossAmt,
            };
          }

          // 7. Queue UAE Tarrashud / ITC VEHICLE_SWAP regulatory manifest
          const regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
            tx,
            'vex_reg_report',
            () =>
              queueUaeRegulatoryReportInTx(tx, {
                tenantId,
                agreementId: agreement.id,
                eventType: 'VEHICLE_SWAP',
                submittedBy: actorUserId,
                previousVehicleId: fromVehicleId,
                previousPlateNumber: fromVeh?.plate_number ?? null,
              }),
            null,
          );

          return {
            kind: 'ok' as const,
            exchange: {
              id: exchangeId,
              exchangeNo,
              agreementId: agreement.id,
              fromVehicleId,
              toVehicleId,
              reason: data.reason,
              fromMileageIn,
              fromFuelIn,
              toMileageOut: resolvedToMileageOut,
              toFuelOut: resolvedToFuelOut,
              fromVehicleStatusAfter: safeFromVeh.status,
              rateDifference: rateDiff,
              notes: data.notes ?? null,
              fromVehicle: {
                id: fromVehicleId,
                plateNumber: fromVeh?.plate_number ?? null,
                make: fromVeh?.make ?? null,
                model: fromVeh?.model ?? null,
              },
              toVehicle: {
                id: toVehicleId,
                plateNumber: toVeh.plate_number ?? null,
                make: toVeh.make ?? null,
                model: toVeh.model ?? null,
              },
            },
            agreement: updatedAgreement,
            upgradeCharge,
            regulatoryReport,
          };
        },
      );
    });

    if (txOutcome.kind === 'err') {
      return NextResponse.json({ error: txOutcome.error }, { status: txOutcome.status });
    }

    let finalRegReport = txOutcome.regulatoryReport;
    if (finalRegReport?.status === 'QUEUED') {
      try {
        finalRegReport = await dispatchUaeRegulatoryReportOutsideRls(finalRegReport);
      } catch {
        // Non-fatal: manifest stays QUEUED in rental_regulatory_reports
      }
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalAgreement',
      entityId: agreementId,
      entityName: txOutcome.agreement.agreementNo ?? undefined,
      action: 'UPDATE',
      details: `Vehicle swap ${txOutcome.exchange.exchangeNo}: ${txOutcome.exchange.fromVehicle.plateNumber ?? txOutcome.exchange.fromVehicleId} (in @ ${fromMileageIn} km, ${fromFuelIn}%, status -> ${txOutcome.exchange.fromVehicleStatusAfter}) -> ${txOutcome.exchange.toVehicle.plateNumber ?? toVehicleId} (out @ ${txOutcome.exchange.toMileageOut} km, ${txOutcome.exchange.toFuelOut}%), reason=${data.reason}.`,
    });

    return NextResponse.json(
      {
        ok: true,
        exchange: txOutcome.exchange,
        agreement: txOutcome.agreement,
        upgradeCharge: txOutcome.upgradeCharge,
        regulatoryReport: finalRegReport,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[POST /api/rental/agreements/[id]/exchange] error:', err);
    return NextResponse.json({ error: 'Vehicle exchange failed' }, { status: 500 });
  }
}
