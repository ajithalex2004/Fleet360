import { NextRequest, NextResponse } from 'next/server';
import {
  listLogisticsFieldOpsWorklist,
  recordLogisticsFieldOpsEvent,
  type LogisticsFieldOpsEventInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const worklist = await listLogisticsFieldOpsWorklist({
      tenantId: resolved.tenantId,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json(worklist);
  } catch (error) {
    console.error('[logistics/field-ops GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch field operations worklist');
  }
}

export async function POST(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const body = await req.json() as LogisticsFieldOpsEventInput & { tenantId?: string };
    if (body.tenantId && body.tenantId !== resolved.ctx.tenantId && !resolved.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const result = await recordLogisticsFieldOpsEvent({
      ...body,
      tenantId: body.tenantId && resolved.ctx.isSuperAdmin ? body.tenantId : resolved.tenantId,
      actorUserId: body.actorUserId ?? resolved.ctx.userId ?? null,
    });
    return NextResponse.json({ result });
  } catch (error) {
    console.error('[logistics/field-ops POST]', error);
    return logisticsErrorResponse(error, 'Failed to record field operations event');
  }
}
