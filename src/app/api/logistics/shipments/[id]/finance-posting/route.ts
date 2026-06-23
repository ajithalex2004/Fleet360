import { NextRequest, NextResponse } from 'next/server';
import { postFreightSettlementToFinance } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

function resolveTenant(req: NextRequest, ctx: NonNullable<ReturnType<typeof requestContext>>, bodyTenantId?: string | null) {
  const requestedTenantId = bodyTenantId ?? req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json().catch(() => ({})) as { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const result = await postFreightSettlementToFinance({
      tenantId,
      shipmentOrderId: id,
      actorUserId: ctx.userId || 'logistics-finance-posting-api',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[logistics/shipments/[id]/finance-posting POST]', error);
    return logisticsErrorResponse(error, 'Failed to post logistics settlement to Finance');
  }
}
