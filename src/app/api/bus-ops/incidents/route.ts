import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';
import { listIncidentWorkOrderLinks, maybeCreateIncidentWorkOrder } from '@/lib/incident-work-orders';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_incidents');
    const status   = searchParams.get('status');
    const severity = searchParams.get('severity');
    const ids = await tenantScopedIds('trip_incidents', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);
    const incidents = await prisma.tripIncident.findMany({
      where: {
        id: { in: ids },
        ...(status   ? { status }   : {}),
        ...(severity ? { severity } : {}),
      },
      orderBy: { incidentDate: 'desc' },
    });
    const workOrderLinks = await listIncidentWorkOrderLinks(incidents.map(incident => incident.id), ctx.tenantId);
    return NextResponse.json(incidents.map(incident => {
      const link = workOrderLinks.get(incident.id);
      return link
        ? {
            ...incident,
            workOrderId: link.workOrderId,
            workOrderNo: link.workOrderNo,
            workOrderStatus: link.status,
            workOrderPriority: link.priority,
          }
        : incident;
    }));
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_incidents');
    const body = await req.json();
    const count = await prisma.tripIncident.count();
    const incidentNo = body.incidentNo ?? `INC-${String(count + 1).padStart(5, '0')}`;
    const incident = await prisma.tripIncident.create({ data: { ...body, incidentNo } });
    await attachTenantToEntity('trip_incidents', incident.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripIncident',
      entityId: incident.id,
      action: 'CREATE',
      after: incident,
      summary: `Created trip incident ${incident.incidentNo ?? incident.id}`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_ATTENDANCE_EXCEPTION',
      referenceType: 'TripIncident',
      referenceId: incident.id,
      referenceNumber: incident.incidentNo ?? incident.id,
      contextData: {
        status: incident.status ?? null,
        severity: incident.severity ?? null,
        scheduleId: incident.scheduleId ?? null,
        routeId: incident.routeId ?? null,
        incidentType: incident.incidentType ?? null,
        action: 'create',
      },
      force: true,
    });
    const workOrder = await maybeCreateIncidentWorkOrder({
      req,
      ctx,
      incident,
      createWorkOrder: typeof body.createWorkOrder === 'boolean' ? body.createWorkOrder : undefined,
      sourceModule: 'BUS_OPS',
    });
    return NextResponse.json({ ...incident, workflow, workOrder }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
