import { NextRequest, NextResponse } from 'next/server';
import { updateCarrierCompliance } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

function resolveTenant(req: NextRequest, ctx: NonNullable<ReturnType<typeof requestContext>>, bodyTenantId?: string) {
  const requestedTenantId = bodyTenantId ?? req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      tenantId?: string;
      onboardingStatus?: string | null;
      complianceStatus?: string | null;
      status?: string | null;
      serviceRegions?: unknown;
      capacityProfile?: unknown;
      commissionModel?: string | null;
      commissionRate?: number | null;
      documents?: unknown;
      notes?: string | null;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const carrier = await updateCarrierCompliance({
      tenantId,
      carrierId: params.id,
      onboardingStatus: body.onboardingStatus ?? null,
      complianceStatus: body.complianceStatus ?? null,
      status: body.status ?? null,
      serviceRegions: body.serviceRegions,
      capacityProfile: body.capacityProfile,
      commissionModel: body.commissionModel ?? null,
      commissionRate: body.commissionRate ?? null,
      documents: body.documents,
      notes: body.notes ?? null,
      actorUserId: ctx.userId || 'carrier-compliance-api',
    });

    return NextResponse.json({ carrier });
  } catch (error) {
    console.error('[logistics/carriers/[id]/compliance PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update carrier compliance');
  }
}
