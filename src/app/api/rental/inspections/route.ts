export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import {
  resolveInputFuelPct,
  resolveStoredFuelPct,
} from '@/lib/rental/fuel-odometer';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

interface DmmfFieldMeta {
  name: string;
  type?: string;
  isList?: boolean;
}

function getVehicleInspectionField(fieldName: string): DmmfFieldMeta | undefined {
  const models = Prisma.dmmf?.datamodel?.models as
    | ReadonlyArray<{ name: string; fields?: ReadonlyArray<DmmfFieldMeta> }>
    | undefined;
  if (!models || models.length === 0) return undefined;
  return models
    .find((m) => m.name === 'VehicleInspection')
    ?.fields?.find((f: DmmfFieldMeta) => f.name === fieldName);
}

function hasVehicleInspectionField(fieldName: string): boolean {
  const models = Prisma.dmmf?.datamodel?.models as
    | ReadonlyArray<{ name: string; fields?: ReadonlyArray<DmmfFieldMeta> }>
    | undefined;
  if (!models || models.length === 0) return true;
  const model = models.find((m) => m.name === 'VehicleInspection');
  if (!model?.fields) return true;
  return model.fields.some((f: DmmfFieldMeta) => f.name === fieldName);
}

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

const ALLOWED_INSPECTION_TYPES = new Set([
  'checkin',
  'checkout',
  'pickup',
  'return',
  'pre_rental',
  'post_rental',
]);

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
    'inspections',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const bookingId = searchParams.get('bookingId');
      const inspections = await tx.vehicleInspection.findMany({
        where: { tenantId, ...(bookingId ? { bookingId } : {}) },
        include: { booking: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const normalized = inspections.map((insp) => {
        const canonicalFuel = resolveStoredFuelPct(null, insp.fuelLevel);
        return canonicalFuel != null ? { ...insp, fuelLevel: canonicalFuel } : insp;
      });
      return NextResponse.json(normalized);
    } catch {
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

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
    'inspections',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const bodyRaw = await req.json();
    const cleaned = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    const bookingId =
      typeof cleaned.bookingId === 'string'
        ? cleaned.bookingId.trim()
        : typeof cleaned.booking_id === 'string'
          ? cleaned.booking_id.trim()
          : '';
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }

    const vehicleId =
      typeof cleaned.vehicleId === 'string' && cleaned.vehicleId.trim()
        ? cleaned.vehicleId.trim()
        : typeof cleaned.vehicle_id === 'string' && cleaned.vehicle_id.trim()
          ? cleaned.vehicle_id.trim()
          : null;

    const rawType =
      typeof cleaned.type === 'string' && cleaned.type.trim()
        ? cleaned.type.trim().toLowerCase()
        : 'checkin';
    if (!ALLOWED_INSPECTION_TYPES.has(rawType)) {
      return NextResponse.json({ error: 'Invalid inspection type' }, { status: 400 });
    }

    const isReturnInspection =
      rawType === 'checkout' || rawType === 'return' || rawType === 'post_rental';

    let mileage: number | null | undefined = undefined;
    const rawMileageInput = cleaned.mileage ?? cleaned.odometerReading;
    if (rawMileageInput !== undefined && rawMileageInput !== null && rawMileageInput !== '') {
      const parsedMileage = Number(rawMileageInput);
      if (!Number.isFinite(parsedMileage) || parsedMileage < 0) {
        return NextResponse.json({ error: 'mileage must be zero or more' }, { status: 400 });
      }
      mileage = Math.round(parsedMileage);
    }

    let fuelLevel: number | null | undefined = undefined;
    const rawFuel =
      cleaned.fuelLevel ??
      cleaned.fuel_level ??
      cleaned.fuelOut ??
      cleaned.fuelIn ??
      cleaned.pickupFuelLevel ??
      cleaned.returnFuelLevel;
    if (rawFuel !== undefined && rawFuel !== null && rawFuel !== '') {
      const numericCheck = Number(rawFuel);
      if (
        typeof rawFuel === 'number' ||
        (typeof rawFuel === 'string' && /^-?\d+(\.\d+)?$/.test(rawFuel.trim()))
      ) {
        if (!Number.isFinite(numericCheck) || numericCheck < 0 || numericCheck > 100) {
          return NextResponse.json(
            { error: 'fuelLevel must be between 0 and 100' },
            { status: 400 },
          );
        }
      }
      const resolvedPct = resolveInputFuelPct(
        cleaned,
        isReturnInspection ? 'return' : 'pickup',
        'PCT',
      );
      if (resolvedPct === null) {
        return NextResponse.json(
          { error: 'fuelLevel must be between 0 and 100' },
          { status: 400 },
        );
      }
      fuelLevel = resolvedPct;
    }

    if (cleaned.signatureUrl !== undefined) {
      validateSafeDocumentOrSignatureUrl(cleaned.signatureUrl, { fieldName: 'signatureUrl' });
    }
    if (cleaned.signatureB64 !== undefined) {
      validateSafeDocumentOrSignatureUrl(cleaned.signatureB64, { fieldName: 'signatureB64' });
    }
    if (cleaned.signatureDataUrl !== undefined) {
      validateSafeDocumentOrSignatureUrl(cleaned.signatureDataUrl, {
        fieldName: 'signatureDataUrl',
      });
    }
    const rawPhotosInput = Array.isArray(cleaned.photos)
      ? cleaned.photos
      : Array.isArray(cleaned.photoUrls)
        ? cleaned.photoUrls
        : undefined;
    if (rawPhotosInput) {
      for (const photo of rawPhotosInput) {
        validateSafeDocumentOrSignatureUrl(photo, { fieldName: 'photos' });
      }
    }

    const actorUserId = req.headers.get('x-user-id')?.trim();
    const inspector =
      actorUserId ||
      (typeof cleaned.inspector === 'string' && cleaned.inspector.trim()
        ? cleaned.inspector.trim()
        : null);

    const conditionGrade =
      typeof cleaned.conditionGrade === 'string' && cleaned.conditionGrade.trim()
        ? cleaned.conditionGrade.trim()
        : cleaned.conditionGrade === null
          ? null
          : undefined;

    const baseNotes = typeof cleaned.notes === 'string' ? cleaned.notes.trim() : '';
    const conditionNote = conditionGrade ? `[Condition: ${conditionGrade}]` : '';
    const notes = [baseNotes, conditionNote].filter(Boolean).join(' ') || null;

    const photosList = rawPhotosInput
      ? rawPhotosInput
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          .map((p) => p.trim())
      : undefined;

    const rawSig = cleaned.signatureUrl ?? cleaned.signatureB64 ?? cleaned.signatureDataUrl;
    const signatureUrl =
      typeof rawSig === 'string' && rawSig.trim()
        ? rawSig.trim()
        : rawSig === null
          ? null
          : undefined;

    const rawDamageMarkers = cleaned.damageMarkers;
    const rawChecklistItems = cleaned.checklistItems ?? cleaned.checklist;

    const extraInspectionFields: Record<string, unknown> = {};
    if (photosList !== undefined && hasVehicleInspectionField('photos')) {
      const photosField = getVehicleInspectionField('photos');
      extraInspectionFields.photos =
        photosField?.type === 'String' && !photosField.isList
          ? JSON.stringify(photosList)
          : photosList;
    }
    if (
      rawDamageMarkers !== undefined &&
      rawDamageMarkers !== null &&
      hasVehicleInspectionField('damageMarkers')
    ) {
      const dmField = getVehicleInspectionField('damageMarkers');
      extraInspectionFields.damageMarkers =
        dmField?.type === 'String' && !dmField.isList
          ? typeof rawDamageMarkers === 'string'
            ? rawDamageMarkers
            : JSON.stringify(rawDamageMarkers)
          : rawDamageMarkers;
    }
    if (
      rawChecklistItems !== undefined &&
      rawChecklistItems !== null &&
      hasVehicleInspectionField('checklistItems')
    ) {
      const clField = getVehicleInspectionField('checklistItems');
      extraInspectionFields.checklistItems =
        clField?.type === 'String' && !clField.isList
          ? typeof rawChecklistItems === 'string'
            ? rawChecklistItems
            : JSON.stringify(rawChecklistItems)
          : rawChecklistItems;
    }
    if (signatureUrl !== undefined && hasVehicleInspectionField('signatureUrl')) {
      extraInspectionFields.signatureUrl = signatureUrl;
    }
    if (conditionGrade !== undefined && hasVehicleInspectionField('conditionGrade')) {
      extraInspectionFields.conditionGrade = conditionGrade;
    }

    const createData: Prisma.VehicleInspectionUncheckedCreateInput = {
      tenantId,
      bookingId,
      type: rawType,
      ...(mileage !== undefined ? { mileage } : {}),
      ...(fuelLevel !== undefined ? { fuelLevel } : {}),
      damages:
        cleaned.damages !== undefined && cleaned.damages !== null
          ? typeof cleaned.damages === 'string'
            ? cleaned.damages
            : JSON.stringify(cleaned.damages)
          : null,
      inspector,
      notes,
      ...extraInspectionFields,
    } as Prisma.VehicleInspectionUncheckedCreateInput;

    const inspection = await withTenantRls(prisma, tenantId, async (tx) => {
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        bookingId,
        vehicleId,
      });

      if (typeof (tx as { rentalBooking?: { findFirst?: unknown } }).rentalBooking?.findFirst === 'function') {
        const booking = await tx.rentalBooking.findFirst({
          where: { id: bookingId, tenantId, deletedAt: null },
          select: { status: true },
        });
        if (booking && String(booking.status ?? '').toUpperCase() === 'CANCELLED') {
          return { cancelled: true as const };
        }
      }

      const created = await tx.vehicleInspection.create({ data: createData });

      // Synchronize linked RentalAgreement dual odometer & canonical 0-100% fuel columns
      if (mileage !== undefined || fuelLevel !== undefined) {
        await withSavepoint(
          tx,
          'insp_post_sync_agr',
          async () => {
            if (typeof tx.rentalAgreement?.findFirst === 'function') {
              const agr = await tx.rentalAgreement.findFirst({
                where: { bookingId, tenantId },
                select: { id: true },
              });
              if (agr) {
                const agrUpdate: Record<string, unknown> = {};
                if (isReturnInspection) {
                  if (mileage !== undefined) agrUpdate.mileageIn = mileage;
                  if (fuelLevel !== undefined) {
                    agrUpdate.fuelIn = coerceAgreementFuelField('fuelIn', fuelLevel ?? null);
                  }
                } else {
                  if (mileage !== undefined) agrUpdate.mileageOut = mileage;
                  if (fuelLevel !== undefined) {
                    agrUpdate.fuelOut = coerceAgreementFuelField('fuelOut', fuelLevel ?? null);
                  }
                }
                if (Object.keys(agrUpdate).length > 0 && typeof tx.rentalAgreement?.update === 'function') {
                  await tx.rentalAgreement.update({
                    where: { id: agr.id, tenantId },
                    data: agrUpdate as Prisma.RentalAgreementUncheckedUpdateInput,
                  });
                }
                if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
                  if (isReturnInspection) {
                    await tx.$executeRawUnsafe(
                      `UPDATE rental_agreements
                          SET return_odometer = COALESCE($1, return_odometer),
                              mileage_in = COALESCE($1, mileage_in),
                              return_fuel_level = COALESCE($2, return_fuel_level)
                        WHERE id::text = $3 AND tenant_id::text = $4`,
                      mileage ?? null,
                      fuelLevel ?? null,
                      agr.id,
                      tenantId,
                    );
                  } else {
                    await tx.$executeRawUnsafe(
                      `UPDATE rental_agreements
                          SET pickup_odometer = COALESCE($1, pickup_odometer),
                              mileage_out = COALESCE($1, mileage_out),
                              pickup_fuel_level = COALESCE($2, pickup_fuel_level)
                        WHERE id::text = $3 AND tenant_id::text = $4`,
                      mileage ?? null,
                      fuelLevel ?? null,
                      agr.id,
                      tenantId,
                    );
                  }
                }
              }
            }
          },
          undefined,
        );
      }

      return { cancelled: false as const, created };
    });

    if (inspection.cancelled) {
      return NextResponse.json(
        { error: 'Cannot record inspection for a cancelled booking' },
        { status: 409 },
      );
    }

    return NextResponse.json(inspection.created, { status: 201 });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
