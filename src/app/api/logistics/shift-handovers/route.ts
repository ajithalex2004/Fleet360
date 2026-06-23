import { NextRequest, NextResponse } from 'next/server';
import {
  createLogisticsShiftHandover,
  getLogisticsShiftHandoverSummary,
  listLogisticsShiftHandovers,
  type LogisticsShiftHandoverInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    if (req.nextUrl.searchParams.get('summary') === 'true') {
      return NextResponse.json(await getLogisticsShiftHandoverSummary({
        tenantId: resolved.tenantId,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 200),
      }));
    }
    const handovers = await listLogisticsShiftHandovers({
      tenantId: resolved.tenantId,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    });
    return NextResponse.json({ handovers });
  } catch (error) {
    console.error('[logistics/shift-handovers GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch logistics shift handovers');
  }
}

export async function POST(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const body = await req.json() as LogisticsShiftHandoverInput & { tenantId?: string };
    if (body.tenantId && body.tenantId !== resolved.ctx.tenantId && !resolved.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const handover = await createLogisticsShiftHandover({
      ...body,
      tenantId: body.tenantId && resolved.ctx.isSuperAdmin ? body.tenantId : resolved.tenantId,
      actorUserId: body.actorUserId ?? resolved.ctx.userId ?? null,
    });
    return NextResponse.json({ handover }, { status: 201 });
  } catch (error) {
    console.error('[logistics/shift-handovers POST]', error);
    return logisticsErrorResponse(error, 'Failed to create logistics shift handover');
  }
}
