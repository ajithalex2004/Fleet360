import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { entityBelongsToTenant, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('staff_members', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const member = await prisma.staffMember.findUnique({
      where: { id },
      include: { transportRequests: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(member);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('staff_members', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.staffMember.findUnique({ where: { id } });
    const data = { ...body };
    delete data.transportRequests;
    delete data.tenantId;
    const member = await prisma.staffMember.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'StaffMember',
      entityId: id,
      action: 'UPDATE',
      before,
      after: member,
      summary: `Updated staff member ${member.name ?? member.employeeId ?? id}`,
    });
    return NextResponse.json(member);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('staff_members', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.staffMember.findUnique({ where: { id } });
    const member = await prisma.staffMember.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'StaffMember',
      entityId: id,
      action: 'DELETE',
      before,
      after: member,
      summary: `Deleted staff member ${member.name ?? member.employeeId ?? id}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
