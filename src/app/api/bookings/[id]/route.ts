export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { runDispatch } from '@/lib/dispatch/engine';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { approvalGate, approvalInProgress, withdrawApproval } from '@/lib/workflow/approvals';

function mapBookingToDispatchServiceType(serviceType: string): string | null {
  const upper = (serviceType || '').toUpperCase();
  if (['PASSENGER', 'EXECUTIVE', 'STAFF_TRANSPORT', 'RENTAL', 'CHAUFFEUR'].includes(upper)) return 'PASSENGER';
  if (['LOGISTICS', 'FREIGHT', 'CARGO'].includes(upper)) return 'FREIGHT';
  if (['DELIVERY', 'PARCEL'].includes(upper)) return 'DELIVERY';
  if (['AMBULANCE', 'EMS'].includes(upper)) return 'AMBULANCE';
  if (['TECHNICIAN', 'MAINTENANCE'].includes(upper)) return 'TECHNICIAN';
  return null;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const booking = await tx.booking.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!booking) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(booking);
    } catch (e) {
      console.error('Error fetching booking:', e);
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.booking.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const booking = await tx.booking.update({
        where: { id: params.id },
        data: body,
      });
      return NextResponse.json(booking);
    } catch (e) {
      console.error('Error updating booking:', e);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
  });
}

/**
 * PATCH /api/bookings/[id]
 * Partial update — used by the Logistics Dispatch Board to assign vehicle/driver
 * and transition status (e.g. CONFIRMED → ACTIVE).
 * Only whitelisted fields are patched to prevent accidental overwrites.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = stripTenantOwnershipFields(await req.json() as Record<string, unknown>);
  const status = typeof body.status === 'string' ? body.status : null;
  let withdraw = false;
  if (status && status !== 'PENDING') {
    if (status === 'CONFIRMED' || status === 'APPROVED') {
      const gated = await approvalGate({
        headers: req.headers, tenantId, referenceType: 'booking', referenceId: params.id,
        action: 'APPROVE', comments: typeof body.notes === 'string' ? body.notes : '',
      });
      if (gated) return gated;
    } else if (status === 'CANCELLED') {
      withdraw = true;
    } else {
      const busy = await approvalInProgress(tenantId, 'booking', params.id);
      if (busy) return busy;
    }
  }

  let dispatchJobToTrigger: string | null = null;
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.booking.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      // Whitelist patchable fields for dispatch actions (including driverId stored in notes)
      const allowed = ['status', 'vehicleId', 'notes', 'approvedBy', 'approvedAt'];
      const data: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in body) data[key] = body[key];
      }

      const requestedDriverId = typeof body.driverId === 'string' && body.driverId.trim() ? body.driverId.trim() : null;
      if (requestedDriverId && !('notes' in data)) {
        let parsedExisting: Record<string, unknown> = {};
        if (existing.notes) {
          try { parsedExisting = JSON.parse(existing.notes); } catch { parsedExisting = { rawNotes: existing.notes }; }
        }
        data.notes = JSON.stringify({ ...parsedExisting, driverId: requestedDriverId });
      }

      if (!Object.keys(data).length) {
        return NextResponse.json({ error: 'No valid fields to patch.' }, { status: 400 });
      }

      const booking = await tx.booking.update({
        where: { id: params.id },
        data,
      });

      const status = typeof data.status === 'string' ? data.status : undefined;

      // Sync with dispatch_jobs when status transitions to CONFIRMED / APPROVED / ACTIVE / COMPLETED / CANCELLED
      if (status && ['CONFIRMED', 'APPROVED', 'ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
        await ensureDispatchSchema();
        let metaObj: Record<string, unknown> = {};
        if (booking.notes) {
          try { metaObj = JSON.parse(booking.notes); } catch {}
        }
        const effectiveDriverId = requestedDriverId ?? (typeof metaObj.driverId === 'string' ? metaObj.driverId : null);

        const existingJobs = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM dispatch_jobs WHERE booking_id = $1 AND tenant_id = $2 LIMIT 1`,
          booking.id,
          tenantId,
        ).catch(() => [] as { id: string }[]);

        if (existingJobs.length > 0) {
          const mappedDispatchStatus =
            status === 'ACTIVE'    ? 'IN_PROGRESS' :
            status === 'COMPLETED' ? 'COMPLETED' :
            status === 'CANCELLED' ? 'CANCELLED' :
            effectiveDriverId      ? 'ACCEPTED' : 'PENDING';

          await tx.$executeRawUnsafe(
            `UPDATE dispatch_jobs
             SET status              = $3,
                 assigned_driver_id  = COALESCE($4, assigned_driver_id),
                 assigned_vehicle_id = COALESCE($5, assigned_vehicle_id),
                 driver_id           = COALESCE($4, driver_id),
                 vehicle_id          = COALESCE($5, vehicle_id),
                 updated_at          = NOW()
             WHERE id = $1::uuid AND tenant_id = $2`,
            existingJobs[0].id,
            tenantId,
            mappedDispatchStatus,
            effectiveDriverId,
            booking.vehicleId ?? null,
          ).catch(() => {});
        } else if (status === 'CONFIRMED' || status === 'APPROVED' || status === 'ACTIVE') {
          const dispatchSvc = mapBookingToDispatchServiceType(booking.serviceType);
          if (dispatchSvc) {
            const originLat = metaObj.pickupLat ?? metaObj.originLat ?? null;
            const originLng = metaObj.pickupLng ?? metaObj.originLng ?? null;
            const destLat   = metaObj.dropoffLat ?? metaObj.destLat ?? null;
            const destLng   = metaObj.dropoffLng ?? metaObj.destLng ?? null;
            const originAddr = metaObj.pickupLocation ?? metaObj.origin ?? metaObj.originAddress ?? null;
            const destAddr   = metaObj.dropoffLocation ?? metaObj.destination ?? metaObj.destinationAddress ?? null;
            const paxCount   = Number(metaObj.passengers ?? metaObj.passengerCount ?? 1) || 1;
            const initialStatus = status === 'ACTIVE' ? 'IN_PROGRESS' : effectiveDriverId ? 'ACCEPTED' : 'PENDING';

            const [dj] = await tx.$queryRawUnsafe<{ id: string }[]>(`
              INSERT INTO dispatch_jobs (
                tenant_id, booking_id, service_type, priority, status,
                pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
                origin_lat, origin_lng, dest_lat, dest_lng,
                origin_address, destination_address,
                scheduled_pickup, passenger_count,
                assigned_driver_id, assigned_vehicle_id, driver_id, vehicle_id,
                metadata, meta
              ) VALUES (
                $1, $2, $3, 'NORMAL', $4,
                $5, $6, $7, $8,
                $5, $6, $7, $8,
                $9, $10,
                $11::timestamptz, $12,
                $13, $14, $13, $14,
                $15::jsonb, $15::jsonb
              )
              RETURNING id
            `,
              tenantId,
              booking.id,
              dispatchSvc,
              initialStatus,
              originLat != null ? Number(originLat) : null,
              originLng != null ? Number(originLng) : null,
              destLat   != null ? Number(destLat)   : null,
              destLng   != null ? Number(destLng)   : null,
              originAddr ? String(originAddr) : null,
              destAddr   ? String(destAddr)   : null,
              booking.startDate.toISOString(),
              paxCount,
              effectiveDriverId,
              booking.vehicleId ?? null,
              JSON.stringify({ ...metaObj, bookingRef: booking.bookingRef, passengerCount: paxCount }),
            ).catch(() => [] as { id: string }[]);

            if (dj?.id && initialStatus === 'PENDING') {
              dispatchJobToTrigger = dj.id;
            }
          }
        }
      }

      return NextResponse.json(booking);
    } catch (e) {
      console.error('Error patching booking:', e);
      return NextResponse.json({ error: 'Failed to patch' }, { status: 500 });
    }
  });

  if (dispatchJobToTrigger) {
    runDispatch(dispatchJobToTrigger, baseUrl).catch(() => {});
  }
  if (withdraw && response.ok) await withdrawApproval(tenantId, 'booking', params.id, 'the booking was cancelled');
  return response;
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.booking.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      await tx.booking.delete({
        where: { id: params.id },
      });
      return NextResponse.json({ success: true });
    } catch (e) {
      console.error('Error deleting booking:', e);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
  });
}
