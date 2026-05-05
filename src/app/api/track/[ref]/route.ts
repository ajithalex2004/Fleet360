import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/track/[ref]
 * Public endpoint — no auth required.
 * Returns safe shipment tracking data for the given booking reference.
 * Deliberately omits internal IDs, pricing, and staff notes.
 */

// 10-stage lifecycle labels
const STATUS_LABEL: Record<string, string> = {
  PENDING:           'Booking Received',
  APPROVED:          'Booking Confirmed',
  CONFIRMED:         'Booking Confirmed',
  ASSIGNED:          'Driver Assigned',
  DISPATCHED:        'Shipment Dispatched',
  ENROUTE_PICKUP:    'Driver En-route to Pickup',
  LOADED:            'Cargo Loaded',
  ENROUTE_DELIVERY:  'Out for Delivery',
  ACTIVE:            'Out for Delivery',
  DELIVERED:         'Delivered',
  POD_SUBMITTED:     'Delivery Confirmed',
  CLOSED:            'Trip Completed',
  CANCELLED:         'Cancelled',
};

const STATUS_ORDER = [
  'PENDING', 'APPROVED', 'ASSIGNED', 'DISPATCHED',
  'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY',
  'DELIVERED', 'POD_SUBMITTED', 'CLOSED',
];

// Map legacy → canonical for progress calculation
const CANONICAL: Record<string, string> = {
  CONFIRMED: 'APPROVED',
  ACTIVE:    'ENROUTE_DELIVERY',
  COMPLETED: 'CLOSED',
};

export async function GET(
  _req: Request,
  { params }: { params: { ref: string } }
) {
  const ref = (params.ref ?? '').toUpperCase().trim();
  if (!ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 });

  try {
    // Fetch booking (case-insensitive search on booking_ref)
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      booking_ref: string | null;
      status: string | null;
      requestor_name: string | null;
      start_date: Date | null;
      end_date: Date | null;
      notes: string | null;
      created_at: Date | null;
    }>>(
      `SELECT id, booking_ref, status, requestor_name, start_date, end_date, notes, created_at
       FROM bookings
       WHERE deleted_at IS NULL
         AND service_type = 'LOGISTICS'
         AND UPPER(booking_ref) = $1
       LIMIT 1`,
      ref
    ).catch(() => []);

    if (!rows.length) {
      return NextResponse.json({ error: 'Tracking reference not found.' }, { status: 404 });
    }

    const booking = rows[0];
    const status  = booking.status ?? 'PENDING';

    // Parse notes for display fields
    let parsedNotes: Record<string, unknown> = {};
    try { parsedNotes = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }

    // Build sanitised public fields
    const origin       = parsedNotes.origin       as string | undefined ?? null;
    const destination  = parsedNotes.destination  as string | undefined ?? null;
    const shipmentType = parsedNotes.shipmentType as string | undefined ?? null;
    const driverName   = parsedNotes.driverName   as string | undefined ?? null;
    const vehiclePlate = parsedNotes.vehiclePlate as string | undefined ?? null;
    const weightKg     = parsedNotes.weightKg     as number | undefined ?? null;
    const cargo        = parsedNotes.cargo        as string | undefined ?? null;

    // Fetch status history (public-safe fields only)
    await prisma.$queryRawUnsafe(
      `CREATE TABLE IF NOT EXISTS trip_status_history (
         id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         booking_id  UUID NOT NULL,
         from_status TEXT,
         to_status   TEXT NOT NULL,
         changed_by  TEXT,
         note        TEXT,
         changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    ).catch(() => {});

    const history = await prisma.$queryRawUnsafe<Array<{
      to_status: string;
      note: string | null;
      changed_at: Date;
    }>>(
      `SELECT to_status, note, changed_at
       FROM trip_status_history
       WHERE booking_id = $1
       ORDER BY changed_at ASC`,
      booking.id
    ).catch(() => []);

    // Build timeline: merge history events with status lifecycle
    const canonical = CANONICAL[status] ?? status;
    const currentIdx = STATUS_ORDER.indexOf(canonical);

    // If history is empty, synthesise "Booking Received" from created_at
    const timelineEvents: Array<{
      status: string;
      label: string;
      timestamp: string | null;
      completed: boolean;
      isCurrent: boolean;
      note: string | null;
    }> = [];

    // Create a map of history entries keyed by status
    const historyMap: Record<string, { ts: Date; note: string | null }> = {};
    for (const h of history) {
      const canon = CANONICAL[h.to_status] ?? h.to_status;
      historyMap[canon] = { ts: h.changed_at instanceof Date ? h.changed_at : new Date(h.changed_at), note: h.note };
    }
    // Booking received = created_at
    if (booking.created_at && !historyMap['PENDING']) {
      historyMap['PENDING'] = { ts: booking.created_at instanceof Date ? booking.created_at : new Date(booking.created_at), note: null };
    }

    for (const s of STATUS_ORDER) {
      const idx  = STATUS_ORDER.indexOf(s);
      const hist = historyMap[s];
      const isCurrent = s === canonical || (currentIdx === -1 && idx === 0);
      const completed = idx < currentIdx || (hist != null && !isCurrent);

      timelineEvents.push({
        status:    s,
        label:     STATUS_LABEL[s] ?? s,
        timestamp: hist ? hist.ts.toISOString() : null,
        completed: completed || (s === canonical),
        isCurrent,
        note:      hist?.note ?? null,
      });
    }

    // POD data for delivered/closed trips
    const pod = (parsedNotes.pod as Record<string, unknown> | undefined) ?? null;
    const podData = pod ? {
      deliveredAt: pod.submittedAt as string | undefined ?? null,
      note:        pod.note        as string | undefined ?? null,
      hasSignature: !!(pod.signature),
      gps:          pod.gps        as { lat: number; lng: number } | undefined ?? null,
    } : null;

    // Progress percentage (0-100)
    const progress = status === 'CANCELLED' ? 0
      : status === 'CLOSED' ? 100
      : Math.round(((currentIdx + 1) / STATUS_ORDER.length) * 100);

    return NextResponse.json({
      bookingRef:   booking.booking_ref,
      status:       canonical,
      statusLabel:  STATUS_LABEL[status] ?? status,
      progress,
      isCancelled:  status === 'CANCELLED',
      isDelivered:  ['DELIVERED','POD_SUBMITTED','CLOSED'].includes(status),
      customerName: booking.requestor_name,
      origin,
      destination,
      shipmentType,
      driverName:   ['ASSIGNED','DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','DELIVERED'].includes(status) ? driverName : null,
      vehiclePlate: ['DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','DELIVERED'].includes(status) ? vehiclePlate : null,
      weightKg,
      cargo,
      scheduledDate:  booking.start_date ? (booking.start_date instanceof Date ? booking.start_date : new Date(booking.start_date)).toISOString() : null,
      estimatedDelivery: booking.end_date ? (booking.end_date instanceof Date ? booking.end_date : new Date(booking.end_date)).toISOString() : null,
      createdAt:    booking.created_at ? (booking.created_at instanceof Date ? booking.created_at : new Date(booking.created_at)).toISOString() : null,
      timeline:     timelineEvents,
      pod:          podData,
    });
  } catch (err) {
    console.error('[track GET]', err);
    return NextResponse.json({ error: 'Unable to retrieve tracking information.' }, { status: 500 });
  }
}
