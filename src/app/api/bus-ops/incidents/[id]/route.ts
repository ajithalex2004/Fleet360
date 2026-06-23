import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { listIncidentWorkOrderLinks, maybeCreateIncidentWorkOrder } from '@/lib/incident-work-orders';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_incidents', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const incident = await prisma.tripIncident.findUnique({ where: { id } });
    if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const links = await listIncidentWorkOrderLinks([incident.id], ctx.tenantId);
    const link = links.get(incident.id);
    return NextResponse.json(link
      ? {
          ...incident,
          workOrderId: link.workOrderId,
          workOrderNo: link.workOrderNo,
          workOrderStatus: link.status,
          workOrderPriority: link.priority,
        }
      : incident);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_incidents', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.tripIncident.findUnique({ where: { id } });
    const transition = assertStatusTransition('tripIncident', before?.status, body.status);
    if (transition) return transition;
    if (body.status === 'RESOLVED' && !body.resolvedAt) body.resolvedAt = new Date();
    delete body.tenantId;
    const incident = await prisma.tripIncident.update({ where: { id }, data: { ...body, updatedAt: new Date() } });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripIncident',
      entityId: id,
      action: body.status !== undefined && body.status !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: incident,
      summary: `Updated trip incident ${incident.incidentNo ?? id}`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_ATTENDANCE_EXCEPTION',
      referenceType: 'TripIncident',
      referenceId: id,
      referenceNumber: incident.incidentNo ?? id,
      contextData: {
        previousStatus: before?.status ?? null,
        status: incident.status ?? null,
        severity: incident.severity ?? null,
        scheduleId: incident.scheduleId ?? null,
        routeId: incident.routeId ?? null,
        action: body.status !== undefined && body.status !== before?.status ? 'status_change' : 'update',
      },
      force: body.status !== undefined && body.status !== before?.status,
    });
    const workOrder = await maybeCreateIncidentWorkOrder({
      req,
      ctx,
      incident,
      createWorkOrder: typeof body.createWorkOrder === 'boolean' ? body.createWorkOrder : undefined,
      sourceModule: 'BUS_OPS',
    });
    return NextResponse.json({ ...incident, workflow, workOrder });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('trip_incidents', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.tripIncident.findUnique({ where: { id } });
    await prisma.tripIncident.delete({ where: { id } });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripIncident',
      entityId: id,
      action: 'DELETE',
      before,
      after: null,
      summary: `Deleted trip incident ${before?.incidentNo ?? id}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
