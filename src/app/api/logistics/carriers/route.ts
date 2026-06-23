import { NextRequest, NextResponse } from 'next/server';
import { createCarrier, listCarriers, type LogisticsCarrierInput } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
    if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }

    const tenantId = requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
    const carriers = await listCarriers({
      tenantId,
      status: req.nextUrl.searchParams.get('status'),
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });

    return NextResponse.json({ carriers });
  } catch (error) {
    console.error('[logistics/carriers GET]', error);
    return NextResponse.json({ error: 'Failed to fetch logistics carriers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as LogisticsCarrierInput & { tenantId?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Carrier name is required' }, { status: 400 });
    }
    if (body.tenantId && body.tenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }

    const tenantId = body.tenantId && ctx.isSuperAdmin ? body.tenantId : ctx.tenantId;
    const carrier = await createCarrier({ ...body, tenantId });
    return NextResponse.json({ carrier }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carriers POST]', error);
    return logisticsErrorResponse(error, 'Failed to create logistics carrier');
  }
}
