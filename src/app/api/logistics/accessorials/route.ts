import { NextRequest, NextResponse } from 'next/server';
import {
  listAccessorialCatalog,
  upsertAccessorialCatalog,
  type LogisticsAccessorialCatalogInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, role, isSuperAdmin };
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
    const accessorials = await listAccessorialCatalog({
      tenantId,
      status: req.nextUrl.searchParams.get('status'),
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ accessorials });
  } catch (error) {
    console.error('[logistics/accessorials GET]', error);
    return NextResponse.json({ error: 'Failed to fetch accessorial catalog' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json() as LogisticsAccessorialCatalogInput & { tenantId?: string };
    const tenantId = resolveTenant(ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    const accessorial = await upsertAccessorialCatalog({ ...body, tenantId });
    return NextResponse.json({ accessorial }, { status: 201 });
  } catch (error) {
    console.error('[logistics/accessorials POST]', error);
    return logisticsErrorResponse(error, 'Failed to save accessorial catalog item');
  }
}
