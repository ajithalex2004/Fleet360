import { NextRequest, NextResponse } from 'next/server';
import { listShipmentExceptions } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;

    const exceptions = await listShipmentExceptions({
      tenantId: resolved.tenantId,
      shipmentOrderId: req.nextUrl.searchParams.get('shipmentOrderId'),
      status: req.nextUrl.searchParams.get('status'),
      includeResolved: req.nextUrl.searchParams.get('includeResolved') === 'true',
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });

    return NextResponse.json({ exceptions });
  } catch (error) {
    console.error('[logistics/exceptions GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch shipment exceptions');
  }
}
