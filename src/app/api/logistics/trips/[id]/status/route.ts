import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyTripStatusChange } from '@/lib/logistics-notifications';

/**
 * Trip Status Transition API
 * PATCH /api/logistics/trips/[id]/status
 *
 * Validates state machine transitions, persists the new status,
 * writes a row to trip_status_history (auto-created if absent),
 * and returns the updated booking.
 */

// ── 10-stage lifecycle + terminal states ─────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  // New lifecycle
  PENDING:          ['APPROVED', 'CANCELLED'],
  APPROVED:         ['ASSIGNED', 'CANCELLED'],
  ASSIGNED:         ['DISPATCHED', 'CANCELLED'],
  DISPATCHED:       ['ENROUTE_PICKUP', 'CANCELLED'],
  ENROUTE_PICKUP:   ['LOADED'],
  LOADED:           ['ENROUTE_DELIVERY'],
  ENROUTE_DELIVERY: ['DELIVERED'],
  DELIVERED:        ['POD_SUBMITTED'],
  POD_SUBMITTED:    ['CLOSED'],
  CLOSED:           [],
  CANCELLED:        [],
  // Backward-compat with legacy statuses
  CONFIRMED:        ['ASSIGNED', 'ACTIVE', 'CANCELLED'],
  ACTIVE:           ['DELIVERED', 'COMPLETED', 'ENROUTE_DELIVERY'],
  COMPLETED:        ['CLOSED'],
};

// Ensure the history table exists (idempotent)
async function ensureHistoryTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS trip_status_history (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id  TEXT NOT NULL,
      from_status TEXT,
      to_status   TEXT NOT NULL,
      changed_by  TEXT,
      note        TEXT,
      changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => { /* table may already exist or DB doesn't support */ });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { status: toStatus, changedBy, note, vehicleId, driverId, driverName, vehiclePlate } =
      await req.json() as {
        status: string;
        changedBy?: string;
        note?: string;
        vehicleId?: string;
        driverId?: string;
        driverName?: string;
        vehiclePlate?: string;
      };

    // Fetch current booking
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const fromStatus = booking.status ?? 'PENDING';
    const allowed    = VALID_TRANSITIONS[fromStatus] ?? [];

    if (!allowed.includes(toStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from ${fromStatus} to ${toStatus}` },
        { status: 422 }
      );
    }

    // Build patch data
    const patchData: Record<string, unknown> = { status: toStatus };

    // When assigning, merge vehicle/driver into notes JSON
    if (vehicleId) patchData.vehicleId = vehicleId;

    if (driverId || driverName || vehiclePlate) {
      let notesObj: Record<string, unknown> = {};
      try { notesObj = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }
      if (driverId)     notesObj.driverId     = driverId;
      if (driverName)   notesObj.driverName   = driverName;
      if (vehiclePlate) notesObj.vehiclePlate = vehiclePlate;
      patchData.notes = JSON.stringify(notesObj);
    }

    // Update booking
    const updated = await prisma.booking.update({
      where: { id },
      data: patchData,
    });

    // Fire-and-forget status notifications (WhatsApp + email)
    try {
      let parsedNotes: Record<string, unknown> = {};
      try { parsedNotes = JSON.parse(updated.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }

      // Look up driver phone if we have a driverId
      let resolvedDriverPhone: string | null = null;
      const resolvedDriverId = (driverId ?? parsedNotes.driverId) as string | undefined;
      if (resolvedDriverId) {
        const driverRow = await prisma.$queryRawUnsafe<Array<{ phone: string | null }>>(
          `SELECT phone FROM drivers WHERE id = $1 LIMIT 1`, resolvedDriverId
        ).catch(() => []);
        resolvedDriverPhone = driverRow[0]?.phone ?? null;
      }

      notifyTripStatusChange({
        bookingRef:       updated.bookingRef ?? id.slice(0, 8),
        toStatus,
        customerPhone:    (parsedNotes.customerPhone as string | undefined) ?? null,
        customerEmail:    updated.requestorEmail ?? (parsedNotes.requestorEmail as string | undefined) ?? null,
        driverPhone:      resolvedDriverPhone,
        driverName:       (driverName ?? parsedNotes.driverName) as string | undefined ?? null,
        vehiclePlate:     (vehiclePlate ?? parsedNotes.vehiclePlate) as string | undefined ?? null,
        operationsPhone:  process.env.OPERATIONS_PHONE ?? null,
        operationsEmail:  process.env.OPERATIONS_EMAIL ?? null,
      });
    } catch { /* never block on notification errors */ }

    // Record history (best-effort)
    await ensureHistoryTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_status_history (booking_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      id, fromStatus, toStatus, changedBy ?? 'system', note ?? null
    ).catch(() => { /* silent — don't fail the whole request if history write fails */ });

    return NextResponse.json({ success: true, booking: updated });
  } catch (err) {
    console.error('[logistics/trips/status PATCH]', err);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureHistoryTable();
    const history = await prisma.$queryRawUnsafe<Array<{
      id: string; booking_id: string; from_status: string | null;
      to_status: string; changed_by: string | null; note: string | null; changed_at: Date;
    }>>(
      `SELECT * FROM trip_status_history WHERE booking_id = $1 ORDER BY changed_at ASC`,
      params.id
    ).catch(() => [] as Array<{
      id: string; booking_id: string; from_status: string | null;
      to_status: string; changed_by: string | null; note: string | null; changed_at: Date;
    }>);

    return NextResponse.json(history.map(h => ({
      ...h,
      changed_at: h.changed_at instanceof Date ? h.changed_at.toISOString() : h.changed_at,
    })));
  } catch (err) {
    console.error('[logistics/trips/status GET]', err);
    return NextResponse.json([]);
  }
}
