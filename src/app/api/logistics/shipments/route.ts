import { NextRequest, NextResponse } from 'next/server';
import {
  backfillLegacyLogisticsBookings,
  createLegacyBookingForShipment,
  createShipmentOrder,
  fetchShipmentById,
  listShipmentOrders,
  shipmentToBookingView,
  type LogisticsShipmentCreateInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
    if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }

    const tenantId = requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
    const status = req.nextUrl.searchParams.get('status');
    const search = req.nextUrl.searchParams.get('search');
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? 100);
    const view = req.nextUrl.searchParams.get('view');

    if (req.nextUrl.searchParams.get('autoBackfill') !== 'false') {
      await backfillLegacyLogisticsBookings({
        tenantId,
        actorUserId: ctx.userId || 'logistics-shipment-api',
        limit,
      });
    }

    const shipments = await listShipmentOrders({ tenantId, status, search, limit });
    if (view === 'booking') {
      return NextResponse.json(shipments.map(s => s.legacyBookingView));
    }

    return NextResponse.json({ shipments });
  } catch (error) {
    console.error('[logistics/shipments GET]', error);
    return NextResponse.json({ error: 'Failed to fetch logistics shipments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as LogisticsShipmentCreateInput & {
      writeLegacyBooking?: boolean;
      tenantId?: string;
    };

    if (body.tenantId && body.tenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }

    const tenantId = body.tenantId && ctx.isSuperAdmin ? body.tenantId : ctx.tenantId;
    const created = await createShipmentOrder({
      ...body,
      tenantId,
      createdBy: body.createdBy ?? ctx.userId ?? 'api',
    });

    if (!created) {
      return NextResponse.json({ error: 'Shipment creation failed' }, { status: 500 });
    }

    let refreshed = created;
    if (body.writeLegacyBooking !== false) {
      await createLegacyBookingForShipment({ shipment: created, actorUserId: ctx.userId || 'api' });
      refreshed = await fetchShipmentById(created.id, tenantId) ?? created;
    }

    return NextResponse.json({
      shipment: refreshed,
      legacyBookingView: shipmentToBookingView(refreshed),
    }, { status: 201 });
  } catch (error) {
    console.error('[logistics/shipments POST]', error);
    return logisticsErrorResponse(error, 'Failed to create logistics shipment');
  }
}
