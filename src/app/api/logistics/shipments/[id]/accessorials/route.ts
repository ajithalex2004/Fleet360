import { NextRequest, NextResponse } from 'next/server';
import { addShipmentAccessorialCharge, type LogisticsShipmentAccessorialInput } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const { id } = await params;
    const body = await req.json() as Omit<LogisticsShipmentAccessorialInput, 'tenantId' | 'shipmentOrderId'> & { tenantId?: string };
    if (body.tenantId && body.tenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const tenantId = body.tenantId && ctx.isSuperAdmin ? body.tenantId : ctx.tenantId;
    const charge = await addShipmentAccessorialCharge({
      ...body,
      tenantId,
      shipmentOrderId: id,
      actorUserId: body.actorUserId ?? ctx.userId ?? 'logistics-api',
    });
    return NextResponse.json({ charge }, { status: 201 });
  } catch (error) {
    console.error('[logistics/shipments/[id]/accessorials POST]', error);
    return logisticsErrorResponse(error, 'Failed to add shipment accessorial');
  }
}
