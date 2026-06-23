import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { recordRoleVersion } from '@/lib/role-versioning';

async function canAccessRole(roleId: string, tenantId: string, isSuperAdmin: boolean): Promise<boolean> {
  if (isSuperAdmin) return true;
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
    },
    select: { id: true },
  });
  return !!role;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminPermission(req, 'view', 'roles');
  if (authResult instanceof NextResponse) return authResult;
  const auth = authResult.ctx;
  const { id } = await params;
  if (!(await canAccessRole(id, auth.tenantId, auth.isSuperAdmin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = await prisma.role.findUnique({
    where: { id },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(role);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAdminPermission(req, 'edit', 'roles');
    if (authResult instanceof NextResponse) return authResult;
    const auth = authResult.ctx;
    const { id } = await params;
    if (!(await canAccessRole(id, auth.tenantId, auth.isSuperAdmin))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { permissions, ...data } = await req.json();
    const before = await prisma.role.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (before.isSystem && data.isSystem === false) {
      const approval = await requireDangerApproval(req, auth, 'role.system-flag.remove', {
        tenantId: before.tenantId ?? auth.tenantId,
        targetType: 'Role',
        targetId: id,
        summary: `Remove system flag from role ${before.code}.`,
      });
      if (approval) return approval;
    }
    if (!auth.isSuperAdmin) {
      delete data.tenantId;
      delete data.isSystem;
    }

    const role = await prisma.role.update({
      where: { id },
      data,
    });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: role.tenantId ?? auth.tenantId,
      entityType: 'Role',
      entityId: role.id,
      entityName: role.name,
      action: 'UPDATE',
      before,
      after: role,
      summary: `Updated role ${role.code}.`,
    });
    await recordRoleVersion({
      req,
      ctx: auth,
      roleId: role.id,
      tenantId: role.tenantId ?? auth.tenantId,
      changeType: 'UPDATE',
      summary: `Updated role ${role.code}.`,
    });
    return NextResponse.json(role);
  } catch (e: any) {
    console.error('PATCH /api/admin/roles/[id] error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireAdminPermission(req, 'delete', 'roles');
    if (authResult instanceof NextResponse) return authResult;
    const auth = authResult.ctx;
    const { id } = await params;
    if (!(await canAccessRole(id, auth.tenantId, auth.isSuperAdmin))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!auth.isSuperAdmin) {
      const role = await prisma.role.findUnique({ where: { id }, select: { isSystem: true, tenantId: true } });
      if (!role || role.isSystem || role.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    const approval = await requireDangerApproval(req, auth, 'role.delete', {
      tenantId: auth.tenantId,
      targetType: 'Role',
      targetId: id,
      summary: `Delete role ${id}.`,
    });
    if (approval) return approval;

    const before = await prisma.role.findUnique({ where: { id } });

    await prisma.role.delete({ where: { id } });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: before?.tenantId ?? auth.tenantId,
      entityType: 'Role',
      entityId: id,
      entityName: before?.name,
      action: 'DELETE',
      before,
      summary: `Deleted role ${before?.code ?? id}.`,
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/admin/roles/[id] error:', e);
    if (e?.code === 'P2003' || e?.code === 'P2014') {
      return NextResponse.json(
        { error: 'This role is assigned to users. Remove those assignments first before deleting.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed to delete role' }, { status: 500 });
  }
}
