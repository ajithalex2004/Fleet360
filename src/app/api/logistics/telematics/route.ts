import { NextRequest, NextResponse } from 'next/server';
import {
  listTelematicsEvents,
  recordTelematicsEvent,
  type LogisticsTelematicsEventInput,
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

function resolveTenant(ctx: NonNullable<ReturnType<typeof requestContext>>, requestedTenantId?: string | null) {
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(ctx, req.nextUrl.searchParams.get('tenantId'));
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    const events = await listTelematicsEvents({
      tenantId,
      shipmentOrderId: req.nextUrl.searchParams.get('shipmentOrderId'),
      vehicleId: req.nextUrl.searchParams.get('vehicleId'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ events });
  } catch (error) {
    console.error('[logistics/telematics GET]', error);
    return NextResponse.json({ error: 'Failed to fetch telematics events' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json() as LogisticsTelematicsEventInput & { tenantId?: string };
    const tenantId = resolveTenant(ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    const event = await recordTelematicsEvent({ ...body, tenantId });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error('[logistics/telematics POST]', error);
    return logisticsErrorResponse(error, 'Failed to ingest telematics event');
  }
}
