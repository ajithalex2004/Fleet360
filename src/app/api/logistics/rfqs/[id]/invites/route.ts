import { NextRequest, NextResponse } from 'next/server';
import { createCarrierPortalInvite, fetchFreightRfqById, listCarrierPortalInvites } from '@/lib/logistics/domain';
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      tenantId?: string;
      carrierId?: string;
      expiresAt?: string | null;
      expiresInHours?: number | null;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.carrierId) return NextResponse.json({ error: 'carrierId is required' }, { status: 400 });

    const rfq = await fetchFreightRfqById(id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    if (!['OPEN', 'DRAFT'].includes(rfq.status)) {
      return NextResponse.json({ error: `RFQ is ${rfq.status}; invites are only allowed for open/draft RFQs` }, { status: 409 });
    }

    const expiresAt = body.expiresAt
      ?? (body.expiresInHours
        ? new Date(Date.now() + Number(body.expiresInHours) * 60 * 60 * 1000).toISOString()
        : null);
    const invite = await createCarrierPortalInvite({
      tenantId,
      rfqId: id,
      carrierId: body.carrierId,
      expiresAt,
      createdBy: ctx.userId || 'logistics-rfq-invite-api',
      metadata: { source: 'marketplace-rfq-invite-api' },
    });

    const origin = req.nextUrl.origin;
    return NextResponse.json({
      invite: invite ? {
        ...invite,
        portalUrl: `${origin}${invite.portalPath}`,
      } : null,
    }, { status: 201 });
  } catch (error) {
    console.error('[logistics/rfqs/[id]/invites POST]', error);
    return logisticsErrorResponse(error, 'Failed to create carrier invite');
  }
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

    const rfq = await fetchFreightRfqById(id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

    const invites = await listCarrierPortalInvites({
      tenantId,
      rfqId: id,
      carrierId: req.nextUrl.searchParams.get('carrierId'),
      includeExpired: req.nextUrl.searchParams.get('includeExpired') === 'true',
    });

    return NextResponse.json({ rfq, invites });
  } catch (error) {
    console.error('[logistics/rfqs/[id]/invites GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch carrier invites');
  }
}
