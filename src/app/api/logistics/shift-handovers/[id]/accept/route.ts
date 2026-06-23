import { NextRequest, NextResponse } from 'next/server';
import { acceptLogisticsShiftHandover } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const handover = await acceptLogisticsShiftHandover({
      tenantId: resolved.tenantId,
      id: params.id,
      actorUserId: resolved.ctx.userId ?? null,
    });
    if (!handover) return NextResponse.json({ error: 'Shift handover not found' }, { status: 404 });
    return NextResponse.json({ handover });
  } catch (error) {
    console.error('[logistics/shift-handovers accept POST]', error);
    return logisticsErrorResponse(error, 'Failed to accept logistics shift handover');
  }
}
