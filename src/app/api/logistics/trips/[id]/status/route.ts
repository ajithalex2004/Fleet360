import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createAdminApprovalRequest } from '@/lib/admin-approvals';
import { notifyTripStatusChange } from '@/lib/logistics-notifications';
import {
  assertGovernedShipmentWrite,
  ensureShipmentForLegacyBooking,
  getCarrierAwardComplianceBlockers,
  syncShipmentStatusFromBooking,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

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
    const { status: toStatus, changedBy, note, vehicleId, driverId, driverName, vehiclePlate, tenantId: bodyTenantId, overrideCompliance, overrideReason } =
      await req.json() as {
        status: string;
        changedBy?: string;
        note?: string;
        vehicleId?: string;
        driverId?: string;
        driverName?: string;
        vehiclePlate?: string;
        tenantId?: string;
        overrideCompliance?: boolean;
        overrideReason?: string | null;
      };
    const tenantId = req.headers.get('x-tenant-id') ?? bodyTenantId ?? null;
    const role = req.headers.get('x-user-role') ?? '';
    const userId = req.headers.get('x-user-id') ?? changedBy ?? 'logistics-status-api';

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

    if (tenantId) {
      const shipment = await ensureShipmentForLegacyBooking({
        tenantId,
        bookingId: id,
        actorUserId: changedBy ?? req.headers.get('x-user-id') ?? null,
      });
      if (shipment) {
        await assertGovernedShipmentWrite({
          tenantId,
          shipmentOrderId: shipment.id,
          action: 'Trip status transition',
          allowClosed: toStatus === 'CLOSED',
        });
      }
      if (shipment && ['DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY'].includes(toStatus)) {
        const carrierId = shipment.assigned_carrier_id ?? null;
        if (carrierId) {
          const blockers = await getCarrierAwardComplianceBlockers({
            tenantId,
            carrierId,
            vehicleId: vehicleId ?? shipment.assigned_vehicle_id ?? null,
            driverId: driverId ?? shipment.assigned_driver_id ?? null,
            requireVehicle: true,
          });
          if (blockers.length > 0 && overrideCompliance) {
            if (role !== 'SUPER_ADMIN') {
              return NextResponse.json({ error: 'Only Super Admin can request a compliance override.' }, { status: 403 });
            }
            if (!String(overrideReason ?? '').trim()) {
              return NextResponse.json({ error: 'Override reason is required.' }, { status: 400 });
            }
            const approvalId = await createAdminApprovalRequest({
              req,
              ctx: {
                userId,
                tenantId,
                role,
                isSuperAdmin: true,
                isTenantAdmin: false,
              },
              action: 'logistics.compliance_override.dispatch',
              tenantId,
              targetType: 'LogisticsTripStatus',
              targetId: id,
              summary: `Override compliance blockers to move ${booking.bookingRef ?? id.slice(0, 8)} to ${toStatus}.`,
              requiredApprovals: 1,
              payload: {
                before: {
                  bookingStatus: fromStatus,
                  shipmentStatus: shipment.status,
                  carrierId,
                  vehicleId: shipment.assigned_vehicle_id ?? null,
                  driverId: shipment.assigned_driver_id ?? null,
                },
                after: {
                  bookingStatus: toStatus,
                  shipmentStatus: toStatus,
                  vehicleId: vehicleId ?? shipment.assigned_vehicle_id ?? null,
                  driverId: driverId ?? shipment.assigned_driver_id ?? null,
                },
                operation: {
                  tenantId,
                  bookingId: id,
                  status: toStatus,
                  changedBy,
                  note,
                  vehicleId,
                  driverId,
                  driverName,
                  vehiclePlate,
                  overrideReason,
                },
                blockers,
                preview: { blockerCount: blockers.length, bookingRef: booking.bookingRef ?? id.slice(0, 8) },
              },
            });
            return NextResponse.json({
              error: 'Approval required',
              code: 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED',
              message: 'Compliance override was queued for approval. Dispatch will execute after approval.',
              blockers,
              approvalRequest: { id: approvalId, status: 'PENDING', requiredApprovals: 1 },
            }, { status: 428 });
          }
          if (blockers.length > 0) {
            return NextResponse.json(
              {
                error: 'Carrier compliance blocks shipment dispatch',
                code: 'LOGISTICS_COMPLIANCE_BLOCKED',
                blockers,
              },
              { status: 409 },
            );
          }
        }
      }
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

    if (tenantId) {
      await syncShipmentStatusFromBooking({
        tenantId,
        bookingId: id,
        status: toStatus,
        actorUserId: changedBy ?? req.headers.get('x-user-id') ?? null,
        note,
        metadata: { vehicleId, driverId, driverName, vehiclePlate },
      }).catch(error => {
        console.error('[logistics/trips/status PATCH] shipment sync failed:', error);
      });
    }

    return NextResponse.json({ success: true, booking: updated });
  } catch (err) {
    console.error('[logistics/trips/status PATCH]', err);
    return logisticsErrorResponse(err, 'Failed to update status');
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
