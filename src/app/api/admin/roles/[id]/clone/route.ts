import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { recordRoleVersion } from '@/lib/role-versioning';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'create', 'roles');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const source = await prisma.role.findUnique({
    where: { id },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!source) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

  const scopedTenantId = resolveTenantBoundary(auth.ctx, source.tenantId ?? auth.ctx.tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;
  if (!auth.ctx.isSuperAdmin && source.tenantId === null && !source.isSystem) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? `${source.name} Copy`).trim();
  const code = String(body.code ?? `${source.code}_COPY`).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const tenantId = auth.ctx.isSuperAdmin
    ? (body.tenantId === undefined ? source.tenantId : body.tenantId || null)
    : auth.ctx.tenantId;

  if (tenantId) {
    const boundary = resolveTenantBoundary(auth.ctx, tenantId);
    if (boundary instanceof NextResponse) return boundary;
  }

  const role = await prisma.role.create({
    data: {
      name,
      code,
      description: body.description ?? `Cloned from ${source.name}`,
      tenantId,
      isSystem: false,
      permissions: source.permissions.length
        ? { create: source.permissions.map(p => ({ permissionId: p.permissionId })) }
        : undefined,
    },
    include: { _count: { select: { permissions: true, userTenants: true } } },
  });

  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId: role.tenantId ?? auth.ctx.tenantId,
    entityType: 'Role',
    entityId: role.id,
    entityName: role.name,
    action: 'CREATE',
    before: { sourceRoleId: source.id, sourceCode: source.code },
    after: role,
    summary: `Cloned role ${source.code} to ${role.code}.`,
  });
  await recordRoleVersion({
    req,
    ctx: auth.ctx,
    roleId: role.id,
    tenantId: role.tenantId ?? auth.ctx.tenantId,
    changeType: 'CLONE',
    summary: `Cloned role ${source.code} to ${role.code}.`,
  });

  return NextResponse.json(role, { status: 201 });
}
