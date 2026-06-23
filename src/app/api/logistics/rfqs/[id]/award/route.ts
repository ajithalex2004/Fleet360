import { NextRequest, NextResponse } from 'next/server';
import { createAdminApprovalRequest } from '@/lib/admin-approvals';
import {
  awardCarrierBid,
  fetchFreightRfqById,
  getCarrierAwardComplianceBlockers,
  listCarrierBids,
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
      bidId?: string;
      vehicleId?: string | null;
      driverId?: string | null;
      overrideCompliance?: boolean;
      overrideReason?: string | null;
      notes?: string;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.bidId) return NextResponse.json({ error: 'bidId is required' }, { status: 400 });

    const rfq = await fetchFreightRfqById(id, tenantId);
    if (!rfq) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    if (rfq.status === 'AWARDED') {
      return NextResponse.json({ error: 'RFQ is already awarded', rfq }, { status: 409 });
    }

    if (body.overrideCompliance) {
      if (!ctx.isSuperAdmin) {
        return NextResponse.json({ error: 'Only Super Admin can request a compliance override.' }, { status: 403 });
      }
      if (!String(body.overrideReason ?? '').trim()) {
        return NextResponse.json({ error: 'Override reason is required.' }, { status: 400 });
      }
      const bid = (await listCarrierBids({ tenantId, rfqId: id, limit: 200 })).find(row => row.id === body.bidId);
      if (!bid) return NextResponse.json({ error: 'Bid not found for this RFQ' }, { status: 404 });
      const blockers = await getCarrierAwardComplianceBlockers({
        tenantId,
        carrierId: bid.carrierId,
        vehicleId: body.vehicleId ?? null,
        driverId: body.driverId ?? null,
        requireVehicle: true,
      });
      if (blockers.length > 0) {
        const approvalId = await createAdminApprovalRequest({
          req,
          ctx: {
            userId: ctx.userId || 'logistics-award-api',
            tenantId,
            role: ctx.role,
            isSuperAdmin: true,
            isTenantAdmin: ctx.role === 'TENANT_ADMIN',
          },
          action: 'logistics.compliance_override.award',
          tenantId,
          targetType: 'LogisticsCarrierBid',
          targetId: body.bidId,
          summary: `Override compliance blockers to award RFQ ${rfq.rfqNo ?? id}.`,
          requiredApprovals: 1,
          payload: {
            before: {
              rfqStatus: rfq.status,
              bidId: body.bidId,
              carrierId: bid.carrierId,
              shipmentOrderId: bid.shipmentOrderId,
            },
            after: {
              rfqStatus: 'AWARDED',
              shipmentStatus: 'ASSIGNED',
              vehicleId: body.vehicleId ?? null,
              driverId: body.driverId ?? null,
            },
            operation: {
              tenantId,
              rfqId: id,
              bidId: body.bidId,
              vehicleId: body.vehicleId ?? null,
              driverId: body.driverId ?? null,
              notes: body.notes ?? null,
              overrideReason: body.overrideReason ?? null,
            },
            blockers,
            preview: { blockerCount: blockers.length, carrierId: bid.carrierId },
          },
        });
        return NextResponse.json({
          error: 'Approval required',
          code: 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED',
          message: 'Compliance override was queued for approval. The award will execute after approval.',
          blockers,
          approvalRequest: { id: approvalId, status: 'PENDING', requiredApprovals: 1 },
        }, { status: 428 });
      }
    }

    const result = await awardCarrierBid({
      tenantId,
      rfqId: id,
      bidId: body.bidId,
      vehicleId: body.vehicleId ?? null,
      driverId: body.driverId ?? null,
      overrideCompliance: Boolean(body.overrideCompliance),
      overrideReason: body.overrideReason ?? null,
      actorRole: ctx.role,
      actorUserId: ctx.userId || 'rfq-award-api',
      notes: body.notes ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[logistics/rfqs/[id]/award POST]', error);
    const coded = error as Error & { code?: string; blockers?: unknown };
    if (coded.code === 'LOGISTICS_COMPLIANCE_BLOCKED') {
      return NextResponse.json(
        {
          error: coded.message,
          code: coded.code,
          blockers: coded.blockers ?? [],
        },
        { status: 409 },
      );
    }
    return logisticsErrorResponse(error, 'Failed to award carrier bid');
  }
}
