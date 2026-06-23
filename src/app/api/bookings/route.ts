import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  backfillLegacyLogisticsBookings,
  createShipmentOrder,
  legacyBookingToShipmentInput,
  listShipmentOrders,
} from '@/lib/logistics/domain';
import { getTenantContextOrNull } from '@/lib/tenant-session';

function logisticsTenantContext(req: NextRequest) {
  const ctx = getTenantContextOrNull(req);
  if (ctx) return ctx;
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? 'logistics-adapter';
  return tenantId ? { tenantId, userId, plan: req.headers.get('x-tenant-plan') ?? 'UNKNOWN' } : null;
}

export async function GET(req: NextRequest) {
  try {
    const sp          = req.nextUrl.searchParams;
    const serviceType = sp.get('serviceType');
    const status      = sp.get('status');
    const limit       = Math.min(parseInt(sp.get('limit') ?? '200', 10), 500);
    const tenantCtx    = logisticsTenantContext(req);

    if (serviceType === 'LOGISTICS' && tenantCtx) {
      if (sp.get('autoBackfill') !== 'false') {
        await backfillLegacyLogisticsBookings({
          tenantId: tenantCtx.tenantId,
          actorUserId: tenantCtx.userId,
          limit,
        });
      }

      const shipments = await listShipmentOrders({
        tenantId: tenantCtx.tenantId,
        status,
        search: sp.get('search'),
        limit,
      });

      return NextResponse.json(shipments.map(row => row.legacyBookingView), {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
          'X-Fleet360-Adapter': 'logistics-shipment-domain',
        },
      });
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (serviceType) where.serviceType = serviceType;
    if (status)      where.status      = status;

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const adapterTenantId = req.headers.get('x-tenant-id') ?? body.tenantId ?? null;
    const actorUserId = req.headers.get('x-user-id') ?? body.createdBy ?? null;
    const bookingData = { ...body };
    delete bookingData.tenantId;
    delete bookingData.writeNativeShipment;

    const booking = await prisma.booking.create({ data: bookingData });

    if (booking.serviceType === 'LOGISTICS' && adapterTenantId && body.writeNativeShipment !== false) {
      await createShipmentOrder(legacyBookingToShipmentInput({
        tenantId: adapterTenantId,
        booking,
        actorUserId,
      })).catch(error => {
        console.error('[bookings POST] logistics shipment mirror failed:', error);
      });
    }

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error('Error creating booking:', error);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
