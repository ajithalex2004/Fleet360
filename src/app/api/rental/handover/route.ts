export const dynamic = 'force-dynamic';

/**
 * Legacy RAC Handover/Return Checklists Compatibility API — /api/rental/handover
 *
 * Replaces broken raw-SQL queries against non-existent `rental_handovers` with
 * clean reads/writes backed by `vehicle_inspections` joined to `rental_bookings`
 * and `rental_agreements`. Primary counter workflows live at:
 *   - Pick-Up Desk: POST /api/rental/counter/handover
 *   - Return Desk:  GET & POST /api/rental/counter/return
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

function coerceAgreementFuelField(
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

async function nextHandoverNo(tx: TxClient, tenantId: string): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const prefix = `RHO-${ym}-`;
  const fromTable = await nextRentalSerial(tx, {
    tenantId,
    series: `RHO-${ym}`,
    prefix,
    table: 'rental_handovers',
    column: 'handover_no',
    padWidth: 4,
  });
  const tableSeq = parseInt(fromTable.slice(prefix.length), 10) || 1;

  const inspRows = await withSavepoint<Array<{ max_seq: string | number | bigint | null }>>(
    tx,
    'handover_insp_max_seq',
    () =>
      tx.$queryRawUnsafe<Array<{ max_seq: string | number | bigint | null }>>(
        `SELECT COALESCE(MAX((SUBSTRING(checklist_items->>'_handoverNo' FROM '([0-9]+)$'))::bigint), 0) AS max_seq
           FROM vehicle_inspections
          WHERE tenant_id::text = $1
            AND jsonb_typeof(checklist_items) = 'object'
            AND (checklist_items->>'_handoverNo') LIKE $2`,
        tenantId,
        `${prefix}%`,
      ),
    [{ max_seq: 0 }],
  );
  const inspNext = Number(inspRows[0]?.max_seq ?? 0) + 1;
  const finalSeq = Math.max(tableSeq, Number.isFinite(inspNext) ? inspNext : 1);
  return `${prefix}${String(finalSeq).padStart(4, '0')}`;
}

function packChecklistItems(rawChecklist: unknown, handoverNo: string): Record<string, unknown> {
  if (Array.isArray(rawChecklist)) {
    return { _handoverNo: handoverNo, items: rawChecklist };
  }
  if (rawChecklist && typeof rawChecklist === 'object') {
    return { ...(rawChecklist as Record<string, unknown>), _handoverNo: handoverNo };
  }
  return { _handoverNo: handoverNo };
}

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapInspectionToHandoverRow(r: Record<string, unknown>) {
  const rawType = String(r.type ?? 'checkin').toLowerCase();
  const handoverType =
    rawType === 'checkout' || rawType === 'return' || rawType === 'post_rental'
      ? 'RETURN'
      : 'PICKUP';
  const id = String(r.id);
  const createdAt = r.created_at
    ? new Date(String(r.created_at)).toISOString()
    : new Date().toISOString();
  const ym = createdAt.slice(0, 7).replace('-', '');
  const parsedChecklist = parseJsonSafe<unknown>(r.checklist_items, []);
  let handoverNo = `RHO-${ym}-${id.slice(0, 6).toUpperCase()}`;
  let checklistItems: unknown = parsedChecklist;
  if (
    parsedChecklist &&
    typeof parsedChecklist === 'object' &&
    !Array.isArray(parsedChecklist) &&
    '_handoverNo' in (parsedChecklist as Record<string, unknown>)
  ) {
    const obj = parsedChecklist as Record<string, unknown>;
    if (typeof obj._handoverNo === 'string' && obj._handoverNo.trim()) {
      handoverNo = obj._handoverNo.trim();
    }
    if ('items' in obj) {
      checklistItems = obj.items;
    } else {
      const rest = { ...obj };
      delete rest._handoverNo;
      checklistItems = rest;
    }
  }
  const damageMarkers = parseJsonSafe<unknown[]>(r.damage_markers, []);
  const photos = parseJsonSafe<string[]>(r.photos, []);
  const fuelPct = resolveStoredFuelPct(null, r.fuel_level) ?? 100;
  const mileage = Number(r.mileage ?? 0);

  return {
    id,
    handoverNo,
    handover_no: handoverNo,
    bookingId: String(r.booking_id),
    booking_id: String(r.booking_id),
    bookingRef: (r.booking_ref as string | null) ?? null,
    booking_ref: (r.booking_ref as string | null) ?? null,
    agreementId: (r.agreement_id as string | null) ?? null,
    agreement_id: (r.agreement_id as string | null) ?? null,
    agreementNo: (r.agreement_no as string | null) ?? null,
    agreement_no: (r.agreement_no as string | null) ?? null,
    customerName: (r.customer_name as string | null) ?? null,
    customer_name: (r.customer_name as string | null) ?? null,
    vehicleId: (r.vehicle_id as string | null) ?? null,
    vehicle_id: (r.vehicle_id as string | null) ?? null,
    vehicleNo: (r.vehicle_no as string | null) ?? null,
    vehicle_no: (r.vehicle_no as string | null) ?? null,
    vehicleName: (r.vehicle_name as string | null) ?? null,
    vehicle_name: (r.vehicle_name as string | null) ?? null,
    handoverType,
    handover_type: handoverType,
    type: r.type,
    handoverDate: createdAt,
    handover_date: createdAt,
    fuelLevel: fuelPct,
    fuel_level: fuelPct,
    odometerReading: mileage,
    odometer_reading: mileage,
    mileage,
    checklistItems,
    checklist_items: checklistItems,
    damageMarkers,
    damage_markers: damageMarkers,
    photos,
    signatureUrl: (r.signature_url as string | null) ?? null,
    signature_url: (r.signature_url as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: 'COMPLETED',
    createdAt,
    created_at: createdAt,
  };
}

const TENANT_SAFE_JOINS = `
  FROM vehicle_inspections vi
  JOIN rental_bookings rb
    ON rb.id = vi.booking_id
   AND rb.tenant_id::text = vi.tenant_id::text
   AND rb.deleted_at IS NULL
  LEFT JOIN rental_agreements ra
    ON ra.booking_id = rb.id
   AND ra.tenant_id::text = vi.tenant_id::text
   AND ra.deleted_at IS NULL
  LEFT JOIN rental_customers rc
    ON rc.id = rb.customer_id
   AND rc.tenant_id::text = vi.tenant_id::text
  LEFT JOIN vehicles v
    ON v.id = COALESCE(ra.vehicle_id, rb.vehicle_id)
   AND v.tenant_id::text = vi.tenant_id::text
`;

/* ─── GET ─── */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'handover',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const handoverType = sp.get('handoverType');
      const search = sp.get('search')?.trim() ?? '';
      const agreementNo = sp.get('agreementNo')?.trim() ?? '';
      const bookingId = sp.get('bookingId')?.trim() ?? '';
      const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
      const offset = (page - 1) * limit;

      const clauses: string[] = ['vi.tenant_id::text = $1'];
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (handoverType) {
        const upper = handoverType.toUpperCase();
        if (upper === 'PICKUP') {
          clauses.push("LOWER(vi.type) IN ('checkin', 'pickup', 'pre_rental')");
        } else if (upper === 'RETURN') {
          clauses.push("LOWER(vi.type) IN ('checkout', 'return', 'post_rental')");
        }
      }
      if (agreementNo) {
        clauses.push(`ra.agreement_no = $${pi++}`);
        params.push(agreementNo);
      }
      if (bookingId) {
        clauses.push(`vi.booking_id = $${pi++}`);
        params.push(bookingId);
      }
      if (search) {
        clauses.push(
          `(COALESCE(rc.full_name, '') ILIKE $${pi} ESCAPE '\\' OR COALESCE(ra.agreement_no, '') ILIKE $${pi} ESCAPE '\\' OR COALESCE(rb.booking_ref, '') ILIKE $${pi} ESCAPE '\\' OR COALESCE(v.plate_number, v.license_plate, v.registration_no, '') ILIKE $${pi} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const rawRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           vi.id,
           vi.booking_id,
           vi.type,
           vi.mileage,
           vi.fuel_level,
           vi.damages,
           vi.notes,
           vi.photos,
           vi.damage_markers,
           vi.checklist_items,
           vi.signature_url,
           vi.created_at,
           rb.booking_ref,
           ra.id AS agreement_id,
           ra.agreement_no,
           rc.full_name AS customer_name,
           COALESCE(ra.vehicle_id, rb.vehicle_id) AS vehicle_id,
           COALESCE(v.plate_number, v.license_plate, v.registration_no) AS vehicle_no,
           CONCAT_WS(' ', v.make, v.model) AS vehicle_name
         ${TENANT_SAFE_JOINS}
         WHERE ${clauses.join(' AND ')}
         ORDER BY vi.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        ...params,
        limit,
        offset,
      );

      const [pendingPickupsRow] = await tx.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text AS cnt
           FROM rental_bookings
          WHERE tenant_id::text = $1 AND deleted_at IS NULL AND status = 'CONFIRMED'`,
        tenantId,
      );
      const [pendingReturnsRow] = await tx.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text AS cnt
           FROM rental_agreements
          WHERE tenant_id::text = $1 AND deleted_at IS NULL AND status = 'ACTIVE'`,
        tenantId,
      );
      const [completedTodayRow] = await tx.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text AS cnt
           FROM vehicle_inspections
          WHERE tenant_id::text = $1 AND DATE(created_at) = CURRENT_DATE`,
        tenantId,
      );

      const data = rawRows.map(mapInspectionToHandoverRow);

      return NextResponse.json({
        data,
        kpis: {
          pendingPickups: parseInt(pendingPickupsRow?.cnt ?? '0', 10),
          pendingReturns: parseInt(pendingReturnsRow?.cnt ?? '0', 10),
          completedToday: parseInt(completedTodayRow?.cnt ?? '0', 10),
          avgConditionScore: 5.0,
        },
        page,
        limit,
      });
    } catch (err) {
      console.error('GET /api/rental/handover error:', err);
      return NextResponse.json({ error: 'Failed to load inspections' }, { status: 500 });
    }
  });
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'handover',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );

      let bookingId =
        typeof body.bookingId === 'string' && body.bookingId.trim()
          ? body.bookingId.trim()
          : null;
      const agreementId =
        typeof body.agreementId === 'string' && body.agreementId.trim()
          ? body.agreementId.trim()
          : null;

      if (!bookingId && (agreementId || body.agreementNo)) {
        const agrRows = await tx.$queryRawUnsafe<Array<{ booking_id: string }>>(
          `SELECT booking_id
             FROM rental_agreements
            WHERE tenant_id::text = $1
              AND deleted_at IS NULL
              AND (${agreementId ? 'id = $2' : 'agreement_no = $2'})
            LIMIT 1`,
          tenantId,
          String(agreementId ?? body.agreementNo),
        );
        bookingId = agrRows[0]?.booking_id ?? null;
      }

      if (!bookingId) {
        return NextResponse.json(
          {
            error:
              'bookingId or agreementId is required. Use /api/rental/counter/handover for pickups and /api/rental/counter/return for returns.',
          },
          { status: 400 },
        );
      }

      // Verify booking (and optional agreement/vehicle) belongs to tenantId
      const explicitVehicleId =
        typeof body.vehicleId === 'string' && body.vehicleId.trim()
          ? body.vehicleId.trim()
          : null;
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        bookingId,
        agreementId,
        vehicleId: explicitVehicleId,
      });

      const booking = await tx.rentalBooking.findFirst({
        where: { id: bookingId, tenantId, deletedAt: null },
        include: { agreement: true },
      });
      if (!booking) {
        return NextResponse.json({ error: 'Booking not found in tenant' }, { status: 404 });
      }
      const currentBookingStatus = String(booking.status ?? '').toUpperCase();
      if (currentBookingStatus === 'CANCELLED') {
        return NextResponse.json(
          { error: 'Cannot record handover checklist for a cancelled booking' },
          { status: 409 },
        );
      }

      const safeSignatureUrl = validateSafeDocumentOrSignatureUrl(body.signatureUrl, {
        fieldName: 'signatureUrl',
      });

      const safePhotos: string[] = [];
      if (Array.isArray(body.photos)) {
        for (const photo of body.photos) {
          const validated = validateSafeDocumentOrSignatureUrl(photo, { fieldName: 'photos' });
          if (validated) safePhotos.push(validated);
        }
      }

      const inspType =
        String(body.handoverType ?? body.type ?? 'PICKUP').toUpperCase() === 'RETURN'
          ? 'checkout'
          : 'checkin';

      const fuelPct =
        resolveInputFuelPct(body, inspType === 'checkout' ? 'return' : 'pickup', 'PCT') ?? 100;
      const rawMileage = Number(
        body.odometerReading ??
          body.mileageOut ??
          body.mileageIn ??
          body.pickupOdometer ??
          body.returnOdometer ??
          body.mileage ??
          0,
      );
      if (!Number.isFinite(rawMileage) || rawMileage < 0) {
        return NextResponse.json(
          { error: 'odometerReading must be zero or more' },
          { status: 400 },
        );
      }
      const mileage = Math.round(rawMileage);

      const targetVehicleId =
        explicitVehicleId ?? booking.vehicleId ?? booking.agreement?.vehicleId ?? null;
      const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'staff';

      return await withRentalLock(
        tx,
        tenantId,
        {
          entityKey: bookingId,
          vehicleIds: [booking.vehicleId, booking.agreement?.vehicleId, targetVehicleId],
        },
        async () => {
          if (inspType === 'checkin') {
            if (targetVehicleId) {
              const vehRows = await withSavepoint<Array<{ status: string | null }>>(
                tx,
                'handover_chk_veh_status',
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
                return NextResponse.json(
                  { error: `Cannot dispatch vehicle in ${vehStatus} status` },
                  { status: 409 },
                );
              }

              const conflict = await checkVehicleRentalConflict(tx, {
                tenantId,
                vehicleId: targetVehicleId,
                startDate: booking.pickupDate,
                endDate: booking.dropoffDate,
                excludeBookingId: booking.id,
                excludeAgreementId: booking.agreement?.id ?? null,
                checkGrounding: true,
              });
              if (conflict.hasConflict) {
                return NextResponse.json(
                  { error: conflict.reason ?? 'Vehicle has a conflicting reservation' },
                  { status: 409 },
                );
              }
            }
          } else if (booking.agreement) {
            const odoRows = await withSavepoint<
              Array<{ pickup_odometer: number | null; mileage_out: number | null }>
            >(
              tx,
              'handover_read_pickup_odo',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT pickup_odometer, mileage_out
                     FROM rental_agreements
                    WHERE id::text = $1 AND tenant_id::text = $2
                    LIMIT 1`,
                  booking.agreement!.id,
                  tenantId,
                ),
              [],
            );
            const storedPickupOdo = resolveStoredOdometerKm(
              odoRows[0]?.pickup_odometer,
              odoRows[0]?.mileage_out ?? booking.agreement.mileageOut,
            );
            if (storedPickupOdo != null && mileage < storedPickupOdo) {
              return NextResponse.json(
                { error: 'Return odometerReading cannot be lower than pickup odometer' },
                { status: 422 },
              );
            }
          }

          const handoverNo = await nextHandoverNo(tx, tenantId);
          const id = crypto.randomUUID();
          const packedChecklist = packChecklistItems(body.checklistItems ?? {}, handoverNo);

          await tx.$executeRawUnsafe(
            `INSERT INTO vehicle_inspections
               (id, tenant_id, booking_id, type, mileage, fuel_level, damages, notes,
                photos, damage_markers, checklist_items, signature_url, created_at)
             VALUES
               ($1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10::jsonb, $11::jsonb, $12, NOW())`,
            id,
            tenantId,
            bookingId,
            inspType,
            mileage,
            fuelPct,
            body.damages ? String(body.damages) : null,
            body.notes ? String(body.notes) : null,
            JSON.stringify(safePhotos),
            JSON.stringify(Array.isArray(body.damageMarkers) ? body.damageMarkers : []),
            JSON.stringify(packedChecklist),
            safeSignatureUrl,
          );

          const now = new Date();
          if (inspType === 'checkin') {
            // Synchronize Booking -> ACTIVE, Agreement -> ACTIVE (with dual fuel/odo), Vehicle -> RENTED
            if (['PENDING', 'CONFIRMED'].includes(currentBookingStatus)) {
              await tx.rentalBooking.update({
                where: { id: booking.id, tenantId },
                data: {
                  status: 'ACTIVE',
                  ...(targetVehicleId && targetVehicleId !== booking.vehicleId
                    ? { vehicleId: targetVehicleId }
                    : {}),
                  updatedAt: now,
                },
              });
            }

            const fuelFieldVal = coerceAgreementFuelField('fuelOut', fuelPct);
            let agrId = booking.agreement?.id ?? null;
            if (booking.agreement) {
              const agrStatusUpper = String(booking.agreement.status ?? '').toUpperCase();
              await tx.rentalAgreement.update({
                where: { id: booking.agreement.id, tenantId },
                data: {
                  ...(targetVehicleId ? { vehicleId: targetVehicleId } : {}),
                  mileageOut: mileage,
                  fuelOut: fuelFieldVal as never,
                  ...(agrStatusUpper === 'DRAFT' || agrStatusUpper === 'CONFIRMED'
                    ? { status: 'ACTIVE', signedAt: booking.agreement.signedAt ?? now, signedBy: booking.agreement.signedBy ?? actorUserId }
                    : {}),
                  updatedAt: now,
                },
              });
            } else {
              const agreementNo = await nextRentalSerial(tx, {
                tenantId,
                series: 'RA',
                prefix: 'RA-',
                table: 'rental_agreements',
                column: 'agreement_no',
                padWidth: 6,
              });
              const createdAgr = await tx.rentalAgreement.create({
                data: {
                  tenantId,
                  agreementNo,
                  bookingId: booking.id,
                  customerId: booking.customerId,
                  vehicleId: targetVehicleId,
                  startDate: booking.pickupDate,
                  endDate: booking.dropoffDate,
                  openBranchId: booking.pickupLocation ?? null,
                  closeBranchId: booking.dropoffLocation ?? null,
                  dailyRate: booking.dailyRate ?? 0,
                  totalAmount: booking.totalAmount ?? 0,
                  currency: booking.currency ?? 'AED',
                  mileageOut: mileage,
                  fuelOut: fuelFieldVal as never,
                  status: 'ACTIVE',
                  signedAt: now,
                  signedBy: actorUserId,
                },
              });
              agrId = createdAgr.id;
            }

            if (agrId) {
              await withSavepoint(
                tx,
                'handover_sync_pickup_cols',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE rental_agreements
                        SET pickup_odometer = $1,
                            mileage_out = $1,
                            pickup_fuel_level = $2
                      WHERE id::text = $3 AND tenant_id::text = $4`,
                    mileage,
                    fuelPct,
                    agrId,
                    tenantId,
                  ),
                0,
              );
            }

            if (targetVehicleId) {
              await withSavepoint(
                tx,
                'handover_veh_rented',
                () =>
                  tx.vehicle.updateMany({
                    where: { id: targetVehicleId, tenantId },
                    data: { status: 'RENTED', updatedAt: now },
                  }),
                { count: 0 },
              );
            }
          } else {
            // RETURN ('checkout'): synchronize Booking -> COMPLETED, Agreement -> COMPLETED + dual return cols, Vehicle -> safe status
            if (currentBookingStatus === 'ACTIVE') {
              await tx.rentalBooking.update({
                where: { id: booking.id, tenantId },
                data: { status: 'COMPLETED', updatedAt: now },
              });
            }

            if (booking.agreement) {
              const agrStatusUpper = String(booking.agreement.status ?? '').toUpperCase();
              const fuelInVal = coerceAgreementFuelField('fuelIn', fuelPct);
              await tx.rentalAgreement.update({
                where: { id: booking.agreement.id, tenantId },
                data: {
                  mileageIn: mileage,
                  fuelIn: fuelInVal as never,
                  ...(agrStatusUpper === 'ACTIVE' ? { status: 'COMPLETED' } : {}),
                  updatedAt: now,
                },
              });

              await withSavepoint(
                tx,
                'handover_sync_return_cols',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE rental_agreements
                        SET return_odometer = $1,
                            mileage_in = $1,
                            return_fuel_level = $2
                      WHERE id::text = $3 AND tenant_id::text = $4`,
                    mileage,
                    fuelPct,
                    booking.agreement!.id,
                    tenantId,
                  ),
                0,
              );
            }

            if (targetVehicleId) {
              await withSavepoint(
                tx,
                'handover_veh_release',
                async () => {
                  const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                    tenantId,
                    vehicleId: targetVehicleId,
                    excludeAgreementId: booking.agreement?.id ?? null,
                    excludeBookingId: booking.id,
                  });
                  await tx.vehicle.updateMany({
                    where: { id: targetVehicleId, tenantId, status: { in: ['RENTED', 'RESERVED'] } },
                    data: { status: safeStatus, updatedAt: now },
                  });
                },
                undefined,
              );
            }
          }

          const [created] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT vi.*, rb.booking_ref, ra.id AS agreement_id, ra.agreement_no,
                    rc.full_name AS customer_name,
                    COALESCE(ra.vehicle_id, rb.vehicle_id) AS vehicle_id,
                    COALESCE(v.plate_number, v.license_plate, v.registration_no) AS vehicle_no,
                    CONCAT_WS(' ', v.make, v.model) AS vehicle_name
             ${TENANT_SAFE_JOINS}
              WHERE vi.id = $1 AND vi.tenant_id::text = $2
              LIMIT 1`,
            id,
            tenantId,
          );

          return NextResponse.json(
            mapInspectionToHandoverRow(
              created ?? {
                id,
                booking_id: bookingId,
                type: inspType,
                checklist_items: packedChecklist,
                fuel_level: fuelPct,
                mileage,
              },
            ),
            { status: 201 },
          );
        },
      );
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('POST /api/rental/handover error:', err);
      return NextResponse.json({ error: 'Failed to create inspection record' }, { status: 500 });
    }
  });
}

/* ─── PATCH ─── */
export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'handover',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      // Load existing inspection & parent booking status before allowing mutation
      const [existing] = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          booking_id: string;
          type: string | null;
          checklist_items: unknown;
          booking_status: string | null;
          agreement_id: string | null;
        }>
      >(
        `SELECT vi.id, vi.booking_id, vi.type, vi.checklist_items,
                rb.status AS booking_status, ra.id AS agreement_id
           FROM vehicle_inspections vi
           JOIN rental_bookings rb
             ON rb.id = vi.booking_id
            AND rb.tenant_id::text = vi.tenant_id::text
           LEFT JOIN rental_agreements ra
             ON ra.booking_id = rb.id
            AND ra.tenant_id::text = vi.tenant_id::text
            AND ra.deleted_at IS NULL
          WHERE vi.id = $1
            AND vi.tenant_id::text = $2
          LIMIT 1`,
        id,
        tenantId,
      );
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const parentStatus = String(existing.booking_status ?? '').toUpperCase();
      if (parentStatus === 'COMPLETED' || parentStatus === 'CANCELLED') {
        return NextResponse.json(
          {
            error: `Cannot modify inspection checklist for a ${parentStatus} booking`,
            code: 'BOOKING_FINALIZED',
          },
          { status: 409 },
        );
      }

      const isReturn = ['checkout', 'return', 'post_rental'].includes(
        String(existing.type ?? '').toLowerCase(),
      );

      const sets: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      let nextFuelPct: number | undefined;
      let nextMileage: number | undefined;

      if (body.notes !== undefined) {
        sets.push(`notes = $${pi++}`);
        params.push(body.notes === null ? null : String(body.notes));
      }
      if (body.fuelLevel !== undefined || body.fuelOut !== undefined || body.fuelIn !== undefined) {
        const raw = body.fuelLevel ?? body.fuelOut ?? body.fuelIn;
        const numCheck = Number(raw);
        if (
          typeof raw === 'number' ||
          (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()))
        ) {
          if (!Number.isFinite(numCheck) || numCheck < 0 || numCheck > 100) {
            return NextResponse.json(
              { error: 'fuelLevel must be between 0 and 100' },
              { status: 400 },
            );
          }
        }
        const resolved = resolveInputFuelPct(body, isReturn ? 'return' : 'pickup', 'PCT');
        if (resolved == null) {
          return NextResponse.json(
            { error: 'fuelLevel must be between 0 and 100' },
            { status: 400 },
          );
        }
        nextFuelPct = resolved;
        sets.push(`fuel_level = $${pi++}`);
        params.push(resolved);
      }
      if (body.odometerReading !== undefined || body.mileage !== undefined) {
        const rawOdo = Number(body.odometerReading ?? body.mileage ?? 0);
        if (!Number.isFinite(rawOdo) || rawOdo < 0) {
          return NextResponse.json(
            { error: 'odometerReading must be zero or more' },
            { status: 400 },
          );
        }
        nextMileage = Math.round(rawOdo);
        sets.push(`mileage = $${pi++}`);
        params.push(nextMileage);
      }
      if (body.checklistItems !== undefined) {
        const prevChecklist = parseJsonSafe<Record<string, unknown>>(existing.checklist_items, {});
        const existingHandoverNo =
          prevChecklist && typeof prevChecklist === 'object' && !Array.isArray(prevChecklist) && typeof prevChecklist._handoverNo === 'string'
            ? prevChecklist._handoverNo
            : null;
        const nextChecklistPayload = existingHandoverNo
          ? packChecklistItems(body.checklistItems, existingHandoverNo)
          : body.checklistItems;
        sets.push(`checklist_items = $${pi++}::jsonb`);
        params.push(JSON.stringify(nextChecklistPayload));
      }
      if (body.signatureUrl !== undefined) {
        const safeSig = validateSafeDocumentOrSignatureUrl(body.signatureUrl, {
          fieldName: 'signatureUrl',
        });
        sets.push(`signature_url = $${pi++}`);
        params.push(safeSig);
      }
      if (Array.isArray(body.photos)) {
        const safePhotos: string[] = [];
        for (const photo of body.photos) {
          const validated = validateSafeDocumentOrSignatureUrl(photo, { fieldName: 'photos' });
          if (validated) safePhotos.push(validated);
        }
        sets.push(`photos = $${pi++}`);
        params.push(JSON.stringify(safePhotos));
      }

      if (sets.length > 0) {
        params.push(id, tenantId);
        await tx.$executeRawUnsafe(
          `UPDATE vehicle_inspections
              SET ${sets.join(', ')}
            WHERE id = $${pi}
              AND tenant_id::text = $${pi + 1}`,
          ...params,
        );
      }

      if (existing.agreement_id && (nextMileage !== undefined || nextFuelPct !== undefined)) {
        await withSavepoint(
          tx,
          'handover_patch_sync_agr',
          async () => {
            const agrData: Record<string, unknown> = {};
            if (isReturn) {
              if (nextMileage !== undefined) agrData.mileageIn = nextMileage;
              if (nextFuelPct !== undefined) {
                agrData.fuelIn = coerceAgreementFuelField('fuelIn', nextFuelPct);
              }
            } else {
              if (nextMileage !== undefined) agrData.mileageOut = nextMileage;
              if (nextFuelPct !== undefined) {
                agrData.fuelOut = coerceAgreementFuelField('fuelOut', nextFuelPct);
              }
            }
            if (Object.keys(agrData).length > 0) {
              await tx.rentalAgreement.update({
                where: { id: existing.agreement_id!, tenantId },
                data: agrData as Prisma.RentalAgreementUncheckedUpdateInput,
              });
            }
            if (isReturn) {
              await tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET return_odometer = COALESCE($1, return_odometer),
                        mileage_in = COALESCE($1, mileage_in),
                        return_fuel_level = COALESCE($2, return_fuel_level)
                  WHERE id::text = $3 AND tenant_id::text = $4`,
                nextMileage ?? null,
                nextFuelPct ?? null,
                existing.agreement_id,
                tenantId,
              );
            } else {
              await tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET pickup_odometer = COALESCE($1, pickup_odometer),
                        mileage_out = COALESCE($1, mileage_out),
                        pickup_fuel_level = COALESCE($2, pickup_fuel_level)
                  WHERE id::text = $3 AND tenant_id::text = $4`,
                nextMileage ?? null,
                nextFuelPct ?? null,
                existing.agreement_id,
                tenantId,
              );
            }
          },
          undefined,
        );
      }

      const [updated] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT vi.*, rb.booking_ref, ra.id AS agreement_id, ra.agreement_no,
                rc.full_name AS customer_name,
                COALESCE(ra.vehicle_id, rb.vehicle_id) AS vehicle_id,
                COALESCE(v.plate_number, v.license_plate, v.registration_no) AS vehicle_no,
                CONCAT_WS(' ', v.make, v.model) AS vehicle_name
         ${TENANT_SAFE_JOINS}
          WHERE vi.id = $1 AND vi.tenant_id::text = $2
          LIMIT 1`,
        id,
        tenantId,
      );

      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(mapInspectionToHandoverRow(updated));
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('PATCH /api/rental/handover error:', err);
      return NextResponse.json({ error: 'Failed to update inspection record' }, { status: 500 });
    }
  });
}
