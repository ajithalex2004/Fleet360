import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('staff_transport_requests');
    const status = searchParams.get('status');
    const ids = await tenantScopedIds('staff_transport_requests', ctx.tenantId);
    if (ids.length === 0) return NextResponse.json([]);
    const requests = await prisma.staffTransportRequest.findMany({
      where: { id: { in: ids }, ...(status ? { status } : {}) },
      include: { staffMember: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(requests);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('staff_transport_requests');
    const body = await req.json();
    if (body.staffMemberId && !(await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM staff_members WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      body.staffMemberId,
      ctx.tenantId,
    )).length) {
      return NextResponse.json({ error: 'Staff member not found for tenant' }, { status: 404 });
    }
    const count = await prisma.staffTransportRequest.count();
    const requestNo = body.requestNo ?? `REQ-${String(count + 1).padStart(5, '0')}`;
    const request = await prisma.staffTransportRequest.create({
      data: { ...body, requestNo },
      include: { staffMember: true },
    });
    await attachTenantToEntity('staff_transport_requests', request.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TransportRequest',
      entityId: request.id,
      action: 'CREATE',
      after: request,
      summary: `Created transport request ${request.requestNo ?? request.id}`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_TRANSPORT_REQUEST',
      referenceType: 'TransportRequest',
      referenceId: request.id,
      referenceNumber: request.requestNo ?? request.id,
      contextData: {
        requestId: request.id,
        requestNo: request.requestNo,
        staffMemberId: request.staffMemberId ?? null,
        pickupLocation: request.pickupLocation ?? null,
        dropoffLocation: request.dropLocation ?? null,
        status: request.status ?? 'PENDING',
      },
    });
    return NextResponse.json({ ...request, workflow }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
