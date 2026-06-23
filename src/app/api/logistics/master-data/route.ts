import { NextRequest, NextResponse } from 'next/server';
import {
  deleteLogisticsMasterData,
  listLogisticsMasterData,
  upsertLogisticsMasterData,
  type LogisticsMasterDataInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse, resolveLogisticsTenant } from '@/lib/logistics/api-context';

export async function GET(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const data = await listLogisticsMasterData({
      tenantId: resolved.tenantId,
      type: req.nextUrl.searchParams.get('type'),
      status: req.nextUrl.searchParams.get('status'),
      search: req.nextUrl.searchParams.get('search'),
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[logistics/master-data GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch logistics master data');
  }
}

export async function POST(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const body = await req.json() as LogisticsMasterDataInput & { tenantId?: string };
    if (body.tenantId && body.tenantId !== resolved.ctx.tenantId && !resolved.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const item = await upsertLogisticsMasterData({
      ...body,
      tenantId: body.tenantId && resolved.ctx.isSuperAdmin ? body.tenantId : resolved.tenantId,
      actorUserId: body.actorUserId ?? resolved.ctx.userId ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error('[logistics/master-data POST]', error);
    return logisticsErrorResponse(error, 'Failed to save logistics master data');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const resolved = resolveLogisticsTenant(req);
    if (resolved.error) return resolved.error;
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Master data id is required' }, { status: 400 });
    await deleteLogisticsMasterData({
      tenantId: resolved.tenantId,
      id,
      actorUserId: resolved.ctx.userId ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[logistics/master-data DELETE]', error);
    return logisticsErrorResponse(error, 'Failed to remove logistics master data');
  }
}
