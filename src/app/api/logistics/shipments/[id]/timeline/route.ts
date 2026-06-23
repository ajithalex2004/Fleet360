import { NextRequest, NextResponse } from 'next/server';
import { listShipmentExecutionTimeline } from '@/lib/logistics/domain';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, role, isSuperAdmin };
}

function resolveTenant(req: NextRequest, ctx: NonNullable<ReturnType<typeof requestContext>>) {
  const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const timeline = await listShipmentExecutionTimeline({
      tenantId,
      shipmentOrderId: params.id,
    });
    if (!timeline) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

    return NextResponse.json(timeline);
  } catch (error) {
    console.error('[logistics/shipments/[id]/timeline GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load shipment timeline' },
      { status: 500 },
    );
  }
}
