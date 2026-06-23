import { NextRequest, NextResponse } from 'next/server';
import { archiveCarrierVehicle, updateCarrierVehicle, type LogisticsCarrierVehicleInput } from '@/lib/logistics/domain';
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
  { params }: { params: Promise<{ id: string; vehicleId: string }> },
) {
  try {
    const { id, vehicleId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json().catch(() => ({})) as Partial<LogisticsCarrierVehicleInput> & { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const vehicle = await updateCarrierVehicle({
      tenantId,
      carrierId: id,
      vehicleId,
      patch: body,
      actorUserId: ctx.userId || 'carrier-fleet-review',
    });

    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('[logistics/carriers/[id]/vehicles/[vehicleId] PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update carrier vehicle');
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; vehicleId: string }> },
) {
  try {
    const { id, vehicleId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const vehicle = await archiveCarrierVehicle({
      tenantId,
      carrierId: id,
      vehicleId,
      actorUserId: ctx.userId || 'carrier-fleet-archive',
    });

    return NextResponse.json({ vehicle, archived: true });
  } catch (error) {
    console.error('[logistics/carriers/[id]/vehicles/[vehicleId] DELETE]', error);
    return logisticsErrorResponse(error, 'Failed to archive carrier vehicle');
  }
}
