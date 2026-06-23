import { NextRequest, NextResponse } from 'next/server';
import {
  getCustomerMarketplacePolicy,
  listCustomerMarketplaceSettings,
  upsertCustomerMarketplaceSettings,
  type LogisticsCustomerMarketplaceSettingsInput,
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

function resolveTenant(req: NextRequest, ctx: NonNullable<ReturnType<typeof requestContext>>, bodyTenantId?: string) {
  const requestedTenantId = bodyTenantId ?? req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const customerId = req.nextUrl.searchParams.get('customerId');
    if (customerId) {
      const policy = await getCustomerMarketplacePolicy({
        tenantId,
        customerId,
        customerName: req.nextUrl.searchParams.get('customerName'),
      });
      return NextResponse.json({ policy });
    }

    const settings = await listCustomerMarketplaceSettings({
      tenantId,
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[logistics/customer-marketplace-settings GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch customer marketplace settings' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as Partial<LogisticsCustomerMarketplaceSettingsInput> & { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 });

    const settings = await upsertCustomerMarketplaceSettings({
      ...body,
      tenantId,
      customerId: body.customerId,
      updatedBy: ctx.userId || body.updatedBy || null,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[logistics/customer-marketplace-settings POST]', error);
    return logisticsErrorResponse(error, 'Failed to save customer marketplace settings');
  }
}
