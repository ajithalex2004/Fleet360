import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLogisticsOperationsPulse } from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const pulse = await getLogisticsOperationsPulse({ tenantId: resolved.tenantId });
    return NextResponse.json(pulse);
  } catch (error) {
    console.error('[logistics/operations-pulse GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch logistics operations pulse');
  }
}
