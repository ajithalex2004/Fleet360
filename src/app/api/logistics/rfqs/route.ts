import { NextRequest, NextResponse } from 'next/server';
import {
  createFreightRfq,
  listFreightRfqs,
  type LogisticsFreightRfqInput,
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

    const rfqs = await listFreightRfqs({
      tenantId,
      shipmentOrderId: req.nextUrl.searchParams.get('shipmentOrderId'),
      status: req.nextUrl.searchParams.get('status'),
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });

    return NextResponse.json({ rfqs });
  } catch (error) {
    console.error('[logistics/rfqs GET]', error);
    return NextResponse.json({ error: 'Failed to fetch logistics RFQs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as LogisticsFreightRfqInput & { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.shipmentOrderId) return NextResponse.json({ error: 'shipmentOrderId is required' }, { status: 400 });

    const rfq = await createFreightRfq({
      ...body,
      tenantId,
      status: body.status ?? 'OPEN',
    });

    return NextResponse.json({ rfq }, { status: 201 });
  } catch (error) {
    console.error('[logistics/rfqs POST]', error);
    const message = error instanceof Error ? error.message : 'Failed to create logistics RFQ';
    if (message.includes('RFQ is disabled')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return logisticsErrorResponse(error, 'Failed to create logistics RFQ');
  }
}
