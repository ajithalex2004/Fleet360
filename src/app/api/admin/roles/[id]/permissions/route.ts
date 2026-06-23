import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { recordRoleVersion } from '@/lib/role-versioning';
import { previewRolePermissionChange } from '@/lib/admin-rbac-preview';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'view', 'roles');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  if (!auth.ctx.isSuperAdmin) {
    const role = await prisma.role.findFirst({
      where: { id, OR: [{ tenantId: auth.ctx.tenantId }, { tenantId: null, isSystem: true }] },
      select: { id: true },
    });
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const previewIds = searchParams.get('previewPermissionIds');
  if (previewIds !== null) {
    const preview = await previewRolePermissionChange(id, previewIds.split(','));
    if (!preview) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(preview);
  }

  const rps = await prisma.rolePermission.findMany({
    where: { roleId: id },
    include: { permission: true },
  });
  return NextResponse.json(rps.map(rp => rp.permission));
}

// PUT: replace all permissions for a role
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'roles');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;

    const role = await prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!auth.ctx.isSuperAdmin && (role.isSystem || role.tenantId !== auth.ctx.tenantId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { permissionIds }: { permissionIds: string[] } = await req.json();
    const preview = await previewRolePermissionChange(id, permissionIds);
    if (role.isSystem) {
      const approval = await requireDangerApproval(req, auth.ctx, 'role.permissions.update.system', {
        tenantId: role.tenantId ?? auth.ctx.tenantId,
        targetType: 'Role',
        targetId: id,
        summary: `Update permissions for system role ${role.code}. ${preview?.affectedUsers ?? 0} active user(s) affected.`,
        payload: {
          role: { id: role.id, name: role.name, code: role.code },
          preview,
        },
      });
      if (approval) return approval;
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map(pid => ({ roleId: id, permissionId: pid })),
        skipDuplicates: true,
      }),
    ]);
    const perms = await prisma.rolePermission.findMany({
      where: { roleId: id }, include: { permission: true },
    });
    const permissions = perms.map(rp => rp.permission);
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: role.tenantId ?? auth.ctx.tenantId,
      entityType: 'Role',
      entityId: role.id,
      entityName: role.name,
      action: 'UPDATE',
      before: role.permissions.map(rp => rp.permission),
      after: { permissions, preview },
      summary: `Updated permissions for role ${role.code}. ${preview?.affectedUsers ?? 0} active user(s) affected.`,
    });
    await recordRoleVersion({
      req,
      ctx: auth.ctx,
      roleId: role.id,
      tenantId: role.tenantId ?? auth.ctx.tenantId,
      changeType: 'PERMISSIONS',
      summary: `Updated permissions for role ${role.code}.`,
    });
    return NextResponse.json(permissions);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
