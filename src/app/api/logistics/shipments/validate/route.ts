import { NextRequest, NextResponse } from 'next/server';
import { validateShipmentTimeline, type LogisticsShipmentCreateInput } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function POST(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const body = await req.json() as Partial<LogisticsShipmentCreateInput>;
    const validation = validateShipmentTimeline(body);
    return NextResponse.json(validation, { status: validation.ok ? 200 : 422 });
  } catch (error) {
    console.error('[logistics/shipments/validate POST]', error);
    return logisticsErrorResponse(error, 'Failed to validate logistics shipment');
  }
}
