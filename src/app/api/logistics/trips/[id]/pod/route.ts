import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * ePOD API — stores Proof of Delivery data against a logistics booking.
 * Uses the booking's `notes` JSON field as the store (adds a `pod` key).
 * Also transitions booking status → POD_SUBMITTED.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json() as {
      recipientName: string;
      recipientSignature: string;   // base64 data URL
      photos?: string[];            // base64 data URLs
      gpsLat?: number;
      gpsLng?: number;
      gpsAccuracy?: number;
      deliveryNote?: string;
      submittedBy?: string;
    };

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    let notesObj: Record<string, unknown> = {};
    try { notesObj = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }

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
    return NextResponse.json({ error: 'Failed to save POD' }, { status: 500 });
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
