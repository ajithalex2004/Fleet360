import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('staff_members');
    const department = searchParams.get('department');
    const routeId    = searchParams.get('routeId');
    const active     = searchParams.get('active');

    const ids = await tenantScopedIds('staff_members', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);

    const staff = await prisma.staffMember.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(department ? { department } : {}),
        ...(routeId    ? { defaultRouteId: routeId } : {}),
        ...(active === 'true' ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(staff);
  } catch (error) {
    console.error('Error fetching staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('staff_members');
    const body = await req.json();
    const staffMember = await prisma.staffMember.create({ data: body });
    await attachTenantToEntity('staff_members', staffMember.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'StaffMember',
      entityId: staffMember.id,
      action: 'CREATE',
      after: staffMember,
      summary: `Created staff member ${staffMember.name ?? staffMember.employeeId ?? staffMember.id}`,
    });
    return NextResponse.json(staffMember, { status: 201 });
  } catch (error) {
    console.error('Error creating staff member:', error);
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 });
  }
}
