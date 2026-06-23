import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('staff_transport_requests', id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.staffTransportRequest.findUnique({ where: { id } });
    const transition = assertStatusTransition('transportRequest', before?.status, body.status);
    if (transition) return transition;
    const data = { ...body };
    delete data.staffMember;
    delete data.tenantId;
    if (data.status === 'APPROVED' && !data.approvedAt) data.approvedAt = new Date();
    const request = await prisma.staffTransportRequest.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: { staffMember: true },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TransportRequest',
      entityId: id,
      action: body.status !== undefined && body.status !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: request,
      summary: `Updated transport request ${request.requestNo ?? id}`,
    });
    const workflowEvents = [];
    if (body.status !== undefined && body.status !== before?.status) {
      workflowEvents.push(await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'STAFF_TRANSPORT_REQUEST',
        referenceType: 'TransportRequest',
        referenceId: id,
        referenceNumber: request.requestNo ?? id,
        contextData: {
          requestId: id,
          previousStatus: before?.status ?? null,
          status: request.status,
          assignedRouteId: null,
        },
      }));
    }
    return NextResponse.json({ ...request, workflowEvents });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('staff_transport_requests', id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.staffTransportRequest.findUnique({ where: { id } });
    await prisma.staffTransportRequest.delete({ where: { id } });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TransportRequest',
      entityId: id,
      action: 'DELETE',
      before,
      after: null,
      summary: `Deleted transport request ${before?.requestNo ?? id}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
