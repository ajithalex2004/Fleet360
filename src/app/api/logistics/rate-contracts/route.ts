import { NextRequest, NextResponse } from 'next/server';
import {
  listRateContracts,
  matchLaneRateContracts,
  upsertRateContract,
  type LogisticsRateContractInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

function resolveTenant(ctx: NonNullable<ReturnType<typeof requestContext>>, requestedTenantId?: string | null) {
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(ctx, req.nextUrl.searchParams.get('tenantId'));
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const view = req.nextUrl.searchParams.get('view');
    if (view === 'match') {
      const origin = req.nextUrl.searchParams.get('origin') ?? '';
      const destination = req.nextUrl.searchParams.get('destination') ?? '';
      if (!origin || !destination) {
        return NextResponse.json({ error: 'origin and destination are required for lane matching' }, { status: 400 });
      }
      const contracts = await matchLaneRateContracts({
        tenantId,
        origin,
        destination,
        vehicleType: req.nextUrl.searchParams.get('vehicleType'),
        customerId: req.nextUrl.searchParams.get('customerId'),
        carrierId: req.nextUrl.searchParams.get('carrierId'),
        serviceLevel: req.nextUrl.searchParams.get('serviceLevel'),
      });
      return NextResponse.json({ contracts });
    }

    const contracts = await listRateContracts({
      tenantId,
      carrierId: req.nextUrl.searchParams.get('carrierId'),
      customerId: req.nextUrl.searchParams.get('customerId'),
      status: req.nextUrl.searchParams.get('status'),
      laneOrigin: req.nextUrl.searchParams.get('laneOrigin'),
      laneDestination: req.nextUrl.searchParams.get('laneDestination'),
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ contracts });
  } catch (error) {
    console.error('[logistics/rate-contracts GET]', error);
    return NextResponse.json({ error: 'Failed to fetch rate contracts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json() as LogisticsRateContractInput & { tenantId?: string };
    const tenantId = resolveTenant(ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const contract = await upsertRateContract({ ...body, tenantId });
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error('[logistics/rate-contracts POST]', error);
    return logisticsErrorResponse(error, 'Failed to save rate contract');
  }
}
