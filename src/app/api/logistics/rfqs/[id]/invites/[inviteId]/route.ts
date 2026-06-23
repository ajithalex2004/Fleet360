import { NextRequest, NextResponse } from 'next/server';
import { fetchFreightRfqById, revokeCarrierPortalInvite } from '@/lib/logistics/domain';
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

async function revoke(req: NextRequest, params: Promise<{ id: string; inviteId: string }>) {
  try {
    const { id, inviteId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as { tenantId?: string; reason?: string | null };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const rfq = await fetchFreightRfqById(id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

    const invite = await revokeCarrierPortalInvite({
      tenantId,
      rfqId: id,
      inviteId,
      actorUserId: ctx.userId || 'logistics-rfq-invite-revoke-api',
      reason: body.reason ?? null,
    });

    return NextResponse.json({ invite });
  } catch (error) {
    console.error('[logistics/rfqs/[id]/invites/[inviteId] revoke]', error);
    return logisticsErrorResponse(error, 'Failed to revoke carrier invite');
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  return revoke(req, params);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  return revoke(req, params);
}
