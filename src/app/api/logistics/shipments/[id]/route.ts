import { NextRequest, NextResponse } from 'next/server';
import {
  fetchShipmentById,
  shipmentRowToDetail,
  updateShipmentOrder,
  type LogisticsShipmentUpdateInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;

    const shipment = await fetchShipmentById(params.id, resolved.tenantId);
    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

    return NextResponse.json({ shipment: shipmentRowToDetail(shipment) });
  } catch (error) {
    console.error('[logistics/shipments/[id] GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch logistics shipment');
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;

    const body = await req.json() as Partial<LogisticsShipmentUpdateInput> & { tenantId?: string };
    if (body.tenantId && body.tenantId !== resolved.ctx.tenantId && !resolved.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }

    const tenantId = body.tenantId && resolved.ctx.isSuperAdmin ? body.tenantId : resolved.tenantId;
    const shipment = await updateShipmentOrder({
      ...body,
      tenantId,
      shipmentOrderId: params.id,
      updatedBy: body.updatedBy ?? resolved.ctx.userId ?? null,
    });

    if (!shipment) return NextResponse.json({ error: 'Shipment update failed' }, { status: 500 });

    return NextResponse.json({ shipment: shipmentRowToDetail(shipment) });
  } catch (error) {
    console.error('[logistics/shipments/[id] PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update logistics shipment');
  }
}
