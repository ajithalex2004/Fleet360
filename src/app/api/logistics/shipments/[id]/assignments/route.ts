import { NextRequest, NextResponse } from 'next/server';
import { createAdminApprovalRequest } from '@/lib/admin-approvals';
import {
  createShipmentAssignment,
  fetchShipmentById,
  getCarrierAwardComplianceBlockers,
  listShipmentAssignments,
  type LogisticsAssignmentInput,
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

    const shipment = await fetchShipmentById(params.id, tenantId);
    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

    const assignments = await listShipmentAssignments({
      tenantId,
      shipmentOrderId: params.id,
      status: req.nextUrl.searchParams.get('status'),
    });

    return NextResponse.json({ shipment, assignments });
  } catch (error) {
    console.error('[logistics/shipments/[id]/assignments GET]', error);
    return NextResponse.json({ error: 'Failed to fetch shipment assignments' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json() as Partial<LogisticsAssignmentInput> & {
      tenantId?: string;
      overrideCompliance?: boolean;
      overrideReason?: string | null;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const shipment = await fetchShipmentById(params.id, tenantId);
    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    if (!body.carrierId && !body.driverId && !body.vehicleId) {
      return NextResponse.json(
        { error: 'At least one of carrierId, driverId, or vehicleId is required' },
        { status: 400 },
      );
    }

    if (body.overrideCompliance && body.carrierId) {
      if (!ctx.isSuperAdmin) {
        return NextResponse.json({ error: 'Only Super Admin can request a compliance override.' }, { status: 403 });
      }
      if (!String(body.overrideReason ?? '').trim()) {
        return NextResponse.json({ error: 'Override reason is required.' }, { status: 400 });
      }
      const blockers = await getCarrierAwardComplianceBlockers({
        tenantId,
        carrierId: body.carrierId,
        vehicleId: body.vehicleId ?? null,
        driverId: body.driverId ?? null,
        requireVehicle: (body.status ?? 'ASSIGNED') !== 'PLANNED',
      });
      if (blockers.length > 0) {
        const approvalId = await createAdminApprovalRequest({
          req,
          ctx: {
            userId: ctx.userId || 'logistics-assignment-api',
            tenantId,
            role: ctx.role,
            isSuperAdmin: true,
            isTenantAdmin: ctx.role === 'TENANT_ADMIN',
          },
          action: 'logistics.compliance_override.assignment',
          tenantId,
          targetType: 'LogisticsShipmentOrder',
          targetId: params.id,
          summary: `Override compliance blockers to assign shipment ${shipment.shipment_no ?? params.id}.`,
          requiredApprovals: 1,
          payload: {
            before: {
              shipmentStatus: shipment.status,
              carrierId: shipment.assigned_carrier_id ?? null,
              driverId: shipment.assigned_driver_id ?? null,
              vehicleId: shipment.assigned_vehicle_id ?? null,
            },
            after: {
              shipmentStatus: body.status ?? 'ASSIGNED',
              carrierId: body.carrierId ?? null,
              driverId: body.driverId ?? null,
              vehicleId: body.vehicleId ?? null,
            },
            operation: {
              tenantId,
              shipmentOrderId: params.id,
              carrierId: body.carrierId ?? null,
              driverId: body.driverId ?? null,
              vehicleId: body.vehicleId ?? null,
              assignmentType: body.assignmentType ?? null,
              status: body.status ?? 'ASSIGNED',
              costAmount: body.costAmount ?? null,
              currency: body.currency ?? 'AED',
              metadata: body.metadata ?? {},
              overrideReason: body.overrideReason ?? null,
            },
            blockers,
            preview: { blockerCount: blockers.length, shipmentNo: shipment.shipment_no ?? params.id },
          },
        });
        return NextResponse.json({
          error: 'Approval required',
          code: 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED',
          message: 'Compliance override was queued for approval. The assignment will execute after approval.',
          blockers,
          approvalRequest: { id: approvalId, status: 'PENDING', requiredApprovals: 1 },
        }, { status: 428 });
      }
    }

    const assignment = await createShipmentAssignment({
      tenantId,
      shipmentOrderId: params.id,
      carrierId: body.carrierId ?? null,
      driverId: body.driverId ?? null,
      vehicleId: body.vehicleId ?? null,
      assignmentType: body.assignmentType ?? null,
      status: body.status ?? 'ASSIGNED',
      costAmount: body.costAmount ?? null,
      currency: body.currency ?? 'AED',
      metadata: {
        ...(body.metadata ?? {}),
        assignedBy: ctx.userId || null,
        actorRole: ctx.role,
        overrideCompliance: Boolean(body.overrideCompliance),
        overrideReason: body.overrideReason ?? null,
        source: body.metadata?.source ?? 'manual-assignment-api',
      },
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    console.error('[logistics/shipments/[id]/assignments POST]', error);
    return logisticsErrorResponse(error, 'Failed to create shipment assignment');
  }
}
