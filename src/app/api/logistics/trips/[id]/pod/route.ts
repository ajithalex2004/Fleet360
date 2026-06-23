import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertGovernedShipmentWrite,
  ensureShipmentForLegacyBooking,
  LogisticsValidationError,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

/**
 * ePOD API — stores Proof of Delivery data against a logistics booking.
 * Uses the booking's `notes` JSON field as the store (adds a `pod` key).
 * Also transitions booking status → POD_SUBMITTED.
 */

type PodPayload = {
  recipientName: string;
  recipientSignature: string;
  photos?: string[];
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  deliveryNote?: string;
  submittedBy?: string;
  tenantId?: string;
};

function assertPodPayload(body: Partial<PodPayload>) {
  const issues: string[] = [];
  if (!String(body.recipientName ?? '').trim()) issues.push('POD recipient name is required.');
  if (!String(body.recipientSignature ?? '').trim()) issues.push('POD recipient signature is required.');

  if (body.photos != null) {
    if (!Array.isArray(body.photos)) {
      issues.push('POD photos must be an array.');
    } else if (body.photos.length > 10) {
      issues.push('POD photo upload is limited to 10 images.');
    } else if (body.photos.some(photo => typeof photo !== 'string' || !photo.trim())) {
      issues.push('POD photos must contain valid image data.');
    }
  }

  const hasLat = body.gpsLat != null;
  const hasLng = body.gpsLng != null;
  if (hasLat !== hasLng) issues.push('POD GPS latitude and longitude must be submitted together.');
  if (hasLat && (!Number.isFinite(Number(body.gpsLat)) || Number(body.gpsLat) < -90 || Number(body.gpsLat) > 90)) {
    issues.push('POD GPS latitude must be between -90 and 90.');
  }
  if (hasLng && (!Number.isFinite(Number(body.gpsLng)) || Number(body.gpsLng) < -180 || Number(body.gpsLng) > 180)) {
    issues.push('POD GPS longitude must be between -180 and 180.');
  }
  if (body.gpsAccuracy != null && (!Number.isFinite(Number(body.gpsAccuracy)) || Number(body.gpsAccuracy) < 0)) {
    issues.push('POD GPS accuracy cannot be negative.');
  }
  if (String(body.deliveryNote ?? '').length > 2000) {
    issues.push('POD delivery note cannot exceed 2000 characters.');
  }

  if (issues.length > 0) throw new LogisticsValidationError(issues);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json() as PodPayload;
    assertPodPayload(body);
    const tenantId = req.headers.get('x-tenant-id') ?? body.tenantId ?? null;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    if (tenantId) {
      const shipment = await ensureShipmentForLegacyBooking({
        tenantId,
        bookingId: id,
        actorUserId: body.submittedBy ?? req.headers.get('x-user-id') ?? null,
      });
      if (shipment) {
        await assertGovernedShipmentWrite({
          tenantId,
          shipmentOrderId: shipment.id,
          action: 'POD submission',
        });
      }
    }

    let notesObj: Record<string, unknown> = {};
    try { notesObj = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }
    if (booking.status === 'POD_SUBMITTED' || notesObj.pod) {
      throw new LogisticsValidationError(['POD has already been submitted for this trip.']);
    }

    // Attach POD data
    notesObj.pod = {
      recipientName:      body.recipientName,
      recipientSignature: body.recipientSignature,
      photos:             body.photos ?? [],
      gps:                body.gpsLat != null ? { lat: body.gpsLat, lng: body.gpsLng, accuracy: body.gpsAccuracy } : null,
      deliveryNote:       body.deliveryNote ?? '',
      submittedBy:        body.submittedBy ?? 'Driver',
      submittedAt:        new Date().toISOString(),
    };

    // Update booking — set notes + transition to POD_SUBMITTED
    await prisma.booking.update({
      where: { id },
      data:  { notes: JSON.stringify(notesObj), status: 'POD_SUBMITTED' },
    });

    // Record in status history (best-effort)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS trip_status_history (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        booking_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
        changed_by TEXT, note TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).catch(() => {});

    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_status_history (booking_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)`,
      id, booking.status ?? 'DELIVERED', 'POD_SUBMITTED', body.submittedBy ?? 'Driver', 'ePOD submitted'
    ).catch(() => {});

    return NextResponse.json({ success: true, podSubmittedAt: notesObj.pod && typeof notesObj.pod === 'object' ? (notesObj.pod as Record<string, unknown>).submittedAt : null });
  } catch (err) {
    console.error('[pod POST]', err);
    return logisticsErrorResponse(err, 'Failed to save POD');
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: params.id } });
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let notesObj: Record<string, unknown> = {};
    try { notesObj = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }
    return NextResponse.json({ pod: notesObj.pod ?? null, bookingRef: booking.bookingRef, status: booking.status });
  } catch (err) {
    console.error('[pod GET]', err);
    return NextResponse.json({ error: 'Failed to fetch POD' }, { status: 500 });
  }
}
