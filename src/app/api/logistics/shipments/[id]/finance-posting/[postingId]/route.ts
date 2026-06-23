import { NextRequest, NextResponse } from 'next/server';
import { reverseLogisticsFinancePosting } from '@/lib/logistics/domain';
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; postingId: string }> },
) {
  try {
    const { id, postingId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json().catch(() => ({})) as {
      tenantId?: string;
      action?: string;
      reason?: string | null;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if ((body.action ?? 'reverse') !== 'reverse') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const posting = await reverseLogisticsFinancePosting({
      tenantId,
      shipmentOrderId: id,
      postingId,
      actorUserId: ctx.userId || 'logistics-finance-reversal-api',
      reason: body.reason ?? null,
    });

    return NextResponse.json({ posting });
  } catch (error) {
    console.error('[logistics/shipments/[id]/finance-posting/[postingId] PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to reverse logistics Finance posting');
  }
}
