import { NextRequest, NextResponse } from 'next/server';
import { listLogisticsChangeHistory } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const history = await listLogisticsChangeHistory({
      tenantId: resolved.tenantId,
      entityType: req.nextUrl.searchParams.get('entityType'),
      entityId: req.nextUrl.searchParams.get('entityId'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ history });
  } catch (error) {
    console.error('[logistics/change-history GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch logistics change history');
  }
}
