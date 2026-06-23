import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';

function permissionKey(p: { module: string; action: string; resource: string | null }) {
  return `${p.module}:${p.action}:${p.resource ?? '*'}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'roles');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const leftId = searchParams.get('leftId') ?? '';
  const rightId = searchParams.get('rightId') ?? '';
  if (!leftId || !rightId) {
    return NextResponse.json({ error: 'leftId and rightId are required' }, { status: 400 });
  }

  const roles = await prisma.role.findMany({
    where: { id: { in: [leftId, rightId] } },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { userTenants: true } },
    },
  });
  const left = roles.find(r => r.id === leftId);
  const right = roles.find(r => r.id === rightId);
  if (!left || !right) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

  for (const role of [left, right]) {
    if (role.tenantId) {
      const scoped = resolveTenantBoundary(auth.ctx, role.tenantId);
      if (scoped instanceof NextResponse) return scoped;
    } else if (!auth.ctx.isSuperAdmin && !role.isSystem) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const leftPerms = new Map(left.permissions.map(rp => [permissionKey(rp.permission), rp.permission]));
  const rightPerms = new Map(right.permissions.map(rp => [permissionKey(rp.permission), rp.permission]));
  const added = [...rightPerms.entries()]
    .filter(([key]) => !leftPerms.has(key))
    .map(([key, permission]) => ({ key, permission }));
  const removed = [...leftPerms.entries()]
    .filter(([key]) => !rightPerms.has(key))
    .map(([key, permission]) => ({ key, permission }));

  return NextResponse.json({
    left: { id: left.id, name: left.name, code: left.code, userCount: left._count.userTenants },
    right: { id: right.id, name: right.name, code: right.code, userCount: right._count.userTenants },
    added,
    removed,
    unchanged: [...leftPerms.keys()].filter(key => rightPerms.has(key)).length,
    affectedUsers: {
      leftRoleUsers: left._count.userTenants,
      rightRoleUsers: right._count.userTenants,
    },
  });
}

