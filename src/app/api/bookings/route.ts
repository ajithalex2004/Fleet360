export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { runDispatch } from '@/lib/dispatch/engine';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withApprovalStart } from '@/lib/workflow/approvals';

function mapBookingToDispatchServiceType(serviceType: string): string | null {
  const upper = (serviceType || '').toUpperCase();
  if (['PASSENGER', 'EXECUTIVE', 'STAFF_TRANSPORT', 'RENTAL', 'CHAUFFEUR'].includes(upper)) return 'PASSENGER';
  if (['LOGISTICS', 'FREIGHT', 'CARGO'].includes(upper)) return 'FREIGHT';
  if (['DELIVERY', 'PARCEL'].includes(upper)) return 'DELIVERY';
  if (['AMBULANCE', 'EMS'].includes(upper)) return 'AMBULANCE';
  if (['TECHNICIAN', 'MAINTENANCE'].includes(upper)) return 'TECHNICIAN';
  return null;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp          = req.nextUrl.searchParams;
      const serviceType = sp.get('serviceType');
      const status      = sp.get('status');
      const limit       = Math.min(parseInt(sp.get('limit') ?? '200', 10), 500);

      const where: Record<string, unknown> = { tenantId };
      if (serviceType) where.serviceType = serviceType;
      if (status)      where.status      = status;

      const bookings = await tx.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return NextResponse.json(bookings);
    } catch (e) {
      console.error('Error fetching bookings:', e);
      return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let createdId: string | null = null;
  let dispatchJobToTrigger: string | null = null;
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw) as Record<string, unknown>;

      // Extract only valid Prisma Booking columns and fold any extra portal/dispatch
      // metadata into notes JSON so Prisma never fails with Unknown argument.
      const KNOWN_KEYS = new Set([
        'id',
        'bookingRef',
        'serviceType',
        'requestorId',
        'requestorName',
        'requestorEmail',
        'startDate',
        'endDate',
        'vehicleCategory',
        'vehicleId',
        'driverId',
        'status',
        'notes',
        'approvedBy',
        'approvedAt',
      ]);

      const extraFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (!KNOWN_KEYS.has(k) && v !== undefined) {
          extraFields[k] = v;
        }
      }

      let finalNotes: string | null = typeof body.notes === 'string' ? body.notes : null;
      if (Object.keys(extraFields).length > 0) {
        let parsedNotes: Record<string, unknown> = {};
        if (finalNotes) {
          try {
            const parsed = JSON.parse(finalNotes);
            if (typeof parsed === 'object' && parsed !== null) {
              parsedNotes = parsed as Record<string, unknown>;
            } else {
              parsedNotes = { rawNotes: finalNotes };
            }
          } catch {
            parsedNotes = { rawNotes: finalNotes };
          }
        }
        finalNotes = JSON.stringify({ ...parsedNotes, ...extraFields });
      } else if (body.notes && typeof body.notes === 'object') {
        finalNotes = JSON.stringify(body.notes);
      }

      const now = new Date();
      const startDate = body.startDate ? new Date(String(body.startDate)) : now;
      const endDate   = body.endDate   ? new Date(String(body.endDate))   : new Date(startDate.getTime() + 4 * 3600_000);
      const bookingRef = typeof body.bookingRef === 'string' && body.bookingRef.trim()
        ? body.bookingRef.trim()
        : `BK-${Date.now().toString(36).toUpperCase()}`;

      const requestedDriverId = body.driverId ? String(body.driverId) : null;

      const createData: Prisma.BookingUncheckedCreateInput = {
        tenantId,
        bookingRef,
        serviceType: String(body.serviceType || 'RENTAL'),
        requestorId: (typeof body.requestorId === 'string' ? body.requestorId : null) ?? req.headers.get('x-user-id'),
        requestorName: String(body.requestorName || 'Corporate Requestor'),
        requestorEmail: String(body.requestorEmail || 'bookings@company.ae'),
        startDate,
        endDate,
        vehicleCategory: body.vehicleCategory ? String(body.vehicleCategory) : null,
        vehicleId: body.vehicleId ? String(body.vehicleId) : null,
        status: body.status ? String(body.status) : 'PENDING',
        notes: finalNotes,
        approvedBy: body.approvedBy ? String(body.approvedBy) : null,
        approvedAt: body.approvedAt ? new Date(String(body.approvedAt)) : null,
      };

      const booking = await tx.booking.create({ data: createData });
      if (booking.status === 'PENDING') createdId = booking.id;

      // If booking is created directly in CONFIRMED or APPROVED status, create a dispatch job
      if (booking.status === 'CONFIRMED' || booking.status === 'APPROVED') {
        const dispatchSvc = mapBookingToDispatchServiceType(booking.serviceType);
        if (dispatchSvc) {
          await ensureDispatchSchema();
          let metaObj: Record<string, unknown> = {};
          if (booking.notes) {
            try { metaObj = JSON.parse(booking.notes); } catch {}
          }
          const originLat = metaObj.pickupLat ?? metaObj.originLat ?? null;
          const originLng = metaObj.pickupLng ?? metaObj.originLng ?? null;
          const destLat   = metaObj.dropoffLat ?? metaObj.destLat ?? null;
          const destLng   = metaObj.dropoffLng ?? metaObj.destLng ?? null;
          const originAddr = metaObj.pickupLocation ?? metaObj.origin ?? metaObj.originAddress ?? null;
          const destAddr   = metaObj.dropoffLocation ?? metaObj.destination ?? metaObj.destinationAddress ?? null;
          const paxCount   = Number(metaObj.passengers ?? metaObj.passengerCount ?? 1) || 1;

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
              $1, $2, $3, 'NORMAL', 'PENDING',
              $4, $5, $6, $7,
              $4, $5, $6, $7,
              $8, $9,
              $10::timestamptz, $11,
              $12, $13, $12, $13,
              $14::jsonb, $14::jsonb
            )
            RETURNING id
          `,
            tenantId,
            booking.id,
            dispatchSvc,
            originLat != null ? Number(originLat) : null,
            originLng != null ? Number(originLng) : null,
            destLat   != null ? Number(destLat)   : null,
            destLng   != null ? Number(destLng)   : null,
            originAddr ? String(originAddr) : null,
            destAddr   ? String(destAddr)   : null,
            booking.startDate.toISOString(),
            paxCount,
            requestedDriverId,
            booking.vehicleId ?? null,
            JSON.stringify({ ...metaObj, bookingRef: booking.bookingRef, passengerCount: paxCount }),
          ).catch(() => [] as { id: string }[]);

          if (dj?.id && !requestedDriverId) {
            dispatchJobToTrigger = dj.id;
          }
        }
      }

      return NextResponse.json(booking, { status: 201 });
    } catch (e) {
      console.error('Error creating booking:', e);
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }
  });

  if (dispatchJobToTrigger) {
    runDispatch(dispatchJobToTrigger, baseUrl).catch(() => {});
  }

  return createdId
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'booking', referenceId: createdId })
    : response;
}
