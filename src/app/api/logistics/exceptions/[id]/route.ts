import { NextRequest, NextResponse } from 'next/server';
import { updateShipmentExceptionLifecycle } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;

    const body = await req.json() as {
      action?: string;
      assignedTo?: string | null;
      note?: string | null;
    };
    if (!body.action) {
      return NextResponse.json({ error: 'Exception lifecycle action is required' }, { status: 400 });
    }

    const exception = await updateShipmentExceptionLifecycle({
      tenantId: resolved.tenantId,
      exceptionId: params.id,
      action: body.action,
      assignedTo: body.assignedTo ?? null,
      note: body.note ?? null,
      actorUserId: resolved.ctx.userId || 'logistics-control-tower',
    });

    return NextResponse.json({ exception });
  } catch (error) {
    console.error('[logistics/exceptions/[id] PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update shipment exception');
  }
}
