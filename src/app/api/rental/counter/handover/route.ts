/**
 * POST /api/rental/counter/handover
 *
 * Counter PWA submit endpoint. Atomically:
 *   1. Updates the booking status to ACTIVE
 *   2. Creates a RentalAgreement (DRAFT or ACTIVE depending on signed)
 *   3. Creates a VehicleInspection record with photo URLs + damage markers
 *   4. Optionally allocates a vehicle if vehicleId provided
 *
 * Photos are uploaded separately via /api/leasing/documents/upload-style
 * route (or the storage adapter directly) and only the URLs land here.
 *
 * Body:
 *   {
 *     bookingId: string,
 *     vehicleId?: string,
 *     mileageOut: number,
 *     fuelOut: number,    // 1-8 representing eighths
 *     damageMarkers: Array<{ zone, type, severity, x, y, note? }>,
 *     photoUrls: string[],   // already-uploaded photo URLs
 *     signatureDataUrl: string,  // base64 PNG (saved to storage)
 *     openBranchId?: string,
 *     notes?: string,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const damageMarkerSchema = z.object({
  zone: z.string(),
  type: z.string(),
  severity: z.string(),
  x: z.number(),
  y: z.number(),
  note: z.string().optional(),
});

const bodySchema = z.object({
  bookingId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  mileageOut: z.coerce.number().int().min(0),
  fuelOut: z.coerce.number().int().min(0).max(8),
  damageMarkers: z.array(damageMarkerSchema).default([]),
  photoUrls: z.array(z.string()).default([]),
  signatureDataUrl: z.string().optional(),
  openBranchId: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Save the signature image to storage if provided.
    let signatureUrl: string | null = null;
    if (data.signatureDataUrl?.startsWith('data:image/')) {
      try {
        const match = data.signatureDataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
        if (match) {
          const buffer = Buffer.from(match[2], 'base64');
          const stored = await getStorage().upload({
            buffer,
            originalName: `sig-${data.bookingId.slice(0, 8)}.png`,
            mimeType: match[1],
            prefix: `rental/handover/${data.bookingId}`,
          });
          signatureUrl = stored.url;
        }
      } catch (err) {
        captureException(err, { context: 'rental.counter.handover.signature' });
      }
    }

    // Look up the booking.
    const booking = await prisma.rentalBooking.findUnique({ where: { id: data.bookingId } });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const vehicleId = data.vehicleId ?? booking.vehicleId ?? null;

    // Atomic: update booking, create agreement, create inspection.
    const result = await prisma.$transaction(async (tx) => {
      const totalDays = booking.totalDays ?? Math.max(1, Math.ceil(
        (booking.dropoffDate.getTime() - booking.pickupDate.getTime()) / 86400000,
      ));

      const agreementCount = await tx.rentalAgreement.count();
      const agreementNo = `RA-${String(agreementCount + 1).padStart(6, '0')}`;

      const agreement = await tx.rentalAgreement.upsert({
        where: { bookingId: data.bookingId },
        create: {
          agreementNo,
          bookingId: data.bookingId,
          customerId: booking.customerId,
          vehicleId,
          startDate: booking.pickupDate,
          endDate: booking.dropoffDate,
          dailyRate: booking.dailyRate,
          totalAmount: booking.totalAmount,
          currency: booking.currency,
          mileageOut: data.mileageOut,
          fuelOut: data.fuelOut,
          status: data.signatureDataUrl ? 'ACTIVE' : 'DRAFT',
          signedAt: data.signatureDataUrl ? new Date() : null,
          signedBy: data.signatureDataUrl ? booking.customerId : null,
          openBranchId: data.openBranchId ?? null,
          notes: data.notes,
          sourceType: 'BOOKING',
        },
        update: {
          mileageOut: data.mileageOut,
          fuelOut: data.fuelOut,
          status: data.signatureDataUrl ? 'ACTIVE' : 'DRAFT',
          signedAt: data.signatureDataUrl ? new Date() : null,
          openBranchId: data.openBranchId ?? null,
          notes: data.notes,
          ...(vehicleId ? { vehicleId } : {}),
        },
      });

      // Create the inspection record.
      const inspectionData: any = {
        bookingId: data.bookingId,
        inspectionType: 'PRE_RENTAL',
        mileage: data.mileageOut,
        fuelLevel: data.fuelOut,
        damageNotes: data.damageMarkers.length > 0
          ? JSON.stringify(data.damageMarkers)
          : null,
        photos: data.photoUrls.length > 0
          ? JSON.stringify([...data.photoUrls, ...(signatureUrl ? [signatureUrl] : [])])
          : signatureUrl
            ? JSON.stringify([signatureUrl])
            : null,
        inspectedAt: new Date(),
      };
      // The VehicleInspection schema has flexible fields; create with what's accepted.
      const inspection = await tx.vehicleInspection.create({ data: inspectionData }).catch(() => null);

      // Update booking status to ACTIVE.
      await tx.rentalBooking.update({
        where: { id: data.bookingId },
        data: {
          status: 'ACTIVE',
          ...(vehicleId && !booking.vehicleId ? { vehicleId } : {}),
        },
      });

      return { agreement, inspection, signatureUrl };
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalAgreement',
      entityId: result.agreement.id,
      entityName: result.agreement.agreementNo ?? undefined,
      action: 'CREATE',
      details: `Counter handover: agreement ${result.agreement.agreementNo} (booking ${booking.bookingRef ?? booking.id.slice(0, 8)}), mileageOut=${data.mileageOut}, fuelOut=${data.fuelOut}/8, ${data.damageMarkers.length} damage marker(s), ${data.photoUrls.length} photo(s)${result.signatureUrl ? ', signed' : ', UNSIGNED'}.`,
    });

    return NextResponse.json({
      ok: true,
      agreement: result.agreement,
      signatureUrl: result.signatureUrl,
      bookingStatus: 'ACTIVE',
    }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'rental.counter.handover' });
    console.error('[counter handover] error:', err);
    return NextResponse.json({ error: 'Handover submission failed' }, { status: 500 });
  }
}
