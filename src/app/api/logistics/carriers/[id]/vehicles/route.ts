import { NextRequest, NextResponse } from 'next/server';
import { listCarrierVehicles, upsertCarrierVehicle, type LogisticsCarrierVehicleInput } from '@/lib/logistics/domain';
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const vehicles = await listCarrierVehicles({
      tenantId,
      carrierId: id,
      status: req.nextUrl.searchParams.get('status'),
      availabilityStatus: req.nextUrl.searchParams.get('availabilityStatus'),
      complianceStatus: req.nextUrl.searchParams.get('complianceStatus'),
    });
    return NextResponse.json({ vehicles });
  } catch (error) {
    console.error('[logistics/carriers/[id]/vehicles GET]', error);
    return NextResponse.json({ error: 'Failed to fetch carrier fleet' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as Partial<LogisticsCarrierVehicleInput> & { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.plateNo?.trim()) return NextResponse.json({ error: 'plateNo is required' }, { status: 400 });
    if (!body.vehicleType?.trim()) return NextResponse.json({ error: 'vehicleType is required' }, { status: 400 });

    const vehicle = await upsertCarrierVehicle({
      tenantId,
      carrierId: id,
      ownerDriverId: body.ownerDriverId ?? null,
      vehicleCode: body.vehicleCode ?? null,
      plateNo: body.plateNo,
      registrationNo: body.registrationNo ?? null,
      vehicleType: body.vehicleType,
      make: body.make ?? null,
      model: body.model ?? null,
      year: body.year ?? null,
      color: body.color ?? null,
      capacityTons: body.capacityTons ?? null,
      volumeCbm: body.volumeCbm ?? null,
      palletCapacity: body.palletCapacity ?? null,
      axleCount: body.axleCount ?? null,
      gpsEnabled: body.gpsEnabled ?? false,
      gpsProvider: body.gpsProvider ?? null,
      homeRegion: body.homeRegion ?? null,
      currentRegion: body.currentRegion ?? null,
      availabilityStatus: body.availabilityStatus ?? 'AVAILABLE',
      complianceStatus: body.complianceStatus ?? null,
      status: body.status ?? 'ACTIVE',
      registrationExpiry: body.registrationExpiry ?? null,
      insuranceExpiry: body.insuranceExpiry ?? null,
      permitExpiry: body.permitExpiry ?? null,
      inspectionExpiry: body.inspectionExpiry ?? null,
      metadata: body.metadata ?? {},
      actorUserId: ctx.userId || 'carrier-fleet-api',
    });

    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carriers/[id]/vehicles POST]', error);
    return logisticsErrorResponse(error, 'Failed to save carrier vehicle');
  }
}
