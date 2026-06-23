import { NextRequest, NextResponse } from 'next/server';
import { getCustomerShipmentPortal } from '@/lib/logistics/domain';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, role, isSuperAdmin };
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
    const tracking = await getCustomerShipmentPortal({
      tenantId,
      shipmentNo: req.nextUrl.searchParams.get('shipmentNo'),
      customerId: req.nextUrl.searchParams.get('customerId'),
      trackingToken: req.nextUrl.searchParams.get('trackingToken'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    });
    return NextResponse.json(tracking);
  } catch (error) {
    console.error('[logistics/customer-tracking GET]', error);
    return NextResponse.json({ error: 'Failed to fetch customer tracking portal' }, { status: 500 });
  }
}
