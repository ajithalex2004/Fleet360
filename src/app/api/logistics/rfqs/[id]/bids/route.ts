import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFreightRfqById,
  listCarrierBids,
  submitCarrierBid,
  type LogisticsCarrierBidInput,
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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const rfq = await fetchFreightRfqById(params.id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

    const bids = await listCarrierBids({
      tenantId,
      rfqId: params.id,
      carrierId: req.nextUrl.searchParams.get('carrierId'),
      status: req.nextUrl.searchParams.get('status'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });

    return NextResponse.json({ rfq, bids });
  } catch (error) {
    console.error('[logistics/rfqs/[id]/bids GET]', error);
    return NextResponse.json({ error: 'Failed to fetch carrier bids' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as Partial<LogisticsCarrierBidInput> & { tenantId?: string };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const rfq = await fetchFreightRfqById(params.id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    if (!body.carrierId) return NextResponse.json({ error: 'carrierId is required' }, { status: 400 });
    if (body.amount == null || Number(body.amount) <= 0) {
      return NextResponse.json({ error: 'A positive bid amount is required' }, { status: 400 });
    }

    const bid = await submitCarrierBid({
      tenantId,
      shipmentOrderId: rfq.shipmentOrderId,
      rfqId: params.id,
      carrierId: body.carrierId,
      bidNo: body.bidNo ?? null,
      amount: Number(body.amount),
      currency: body.currency ?? 'AED',
      transitTimeHours: body.transitTimeHours ?? null,
      validityUntil: body.validityUntil ?? null,
      status: body.status ?? 'SUBMITTED',
      chargeBreakdown: body.chargeBreakdown ?? {},
      notes: body.notes ?? null,
    });

    return NextResponse.json({ bid }, { status: 201 });
  } catch (error) {
    console.error('[logistics/rfqs/[id]/bids POST]', error);
    const message = error instanceof Error ? error.message : 'Failed to submit carrier bid';
    if (message.includes('disabled')) return NextResponse.json({ error: message }, { status: 409 });
    return logisticsErrorResponse(error, 'Failed to submit carrier bid');
  }
}
