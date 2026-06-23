import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'tenants');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const scoped = resolveTenantBoundary(auth.ctx, id);
    if (scoped instanceof NextResponse) return scoped;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        modules: true,
        roles: { include: { _count: { select: { permissions: true, userTenants: true } } } },
        userTenants: { include: { role: true } },
      },
    });
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(tenant, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'tenants');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const scoped = resolveTenantBoundary(auth.ctx, id);
    if (scoped instanceof NextResponse) return scoped;

    const data = await req.json();
    delete data.modules;
    delete data.userTenants;
    delete data.roles;
    const before = await prisma.tenant.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const approval = await requireDangerApproval(req, auth.ctx, 'tenant.update', {
      tenantId: id,
      targetType: 'Tenant',
      targetId: id,
      summary: `Update tenant ${before.name}.`,
      payload: { before: { name: before.name, plan: before.plan, isActive: before.isActive }, after: data },
      requiredApprovals: auth.ctx.isSuperAdmin ? 2 : 1,
    });
    if (approval) return approval;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: id,
      entityType: 'Tenant',
      entityId: id,
      entityName: tenant.name,
      action: 'UPDATE',
      before,
      after: tenant,
      summary: `Updated tenant ${tenant.name}.`,
    });
    return NextResponse.json(tenant);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'delete', 'tenants');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const before = await prisma.tenant.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const approval = await requireDangerApproval(req, auth.ctx, 'tenant.deactivate', {
      tenantId: id,
      targetType: 'Tenant',
      targetId: id,
      summary: `Deactivate tenant ${before.name}.`,
      payload: { before: { name: before.name, plan: before.plan, isActive: before.isActive }, after: { isActive: false } },
      requiredApprovals: 2,
    });
    if (approval) return approval;
    const tenant = await prisma.tenant.update({ where: { id }, data: { isActive: false } });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: id,
      entityType: 'Tenant',
      entityId: id,
      entityName: tenant.name,
      action: 'DEACTIVATE',
      before,
      after: tenant,
      summary: `Deactivated tenant ${tenant.name}.`,
    });
    return NextResponse.json({ success: true });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
