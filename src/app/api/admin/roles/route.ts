import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { recordRoleVersion } from '@/lib/role-versioning';
import { CANONICAL_ROLES, canonicalRoleCode } from '@/lib/role-canonicalization';

function presentRole<T extends { code: string; name: string; description?: string | null }>(role: T): T {
  const canonicalCode = canonicalRoleCode(role);
  if (!canonicalCode) return role;
  const canonical = CANONICAL_ROLES[canonicalCode];
  return {
    ...role,
    code: canonicalCode,
    name: canonical.name,
    description: role.description || canonical.description,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAdminPermission(req, 'view', 'roles');
    if (authResult instanceof NextResponse) return authResult;
    const auth = authResult.ctx;

    const { searchParams } = new URL(req.url);
    const tenantId = auth.isSuperAdmin ? searchParams.get('tenantId') : auth.tenantId;
    // lite=true skips the full permissions include — used by dropdowns that only need name/code/id
    const lite = searchParams.get('lite') === 'true';

    const roles = await prisma.role.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null, isSystem: true }] } : {},
      include: lite
        ? { _count: { select: { permissions: true, userTenants: true } } }
        : {
            _count: { select: { permissions: true, userTenants: true } },
            permissions: { include: { permission: true } },
          },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json(roles.map(presentRole), {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdminPermission(req, 'create', 'roles');
    if (authResult instanceof NextResponse) return authResult;
    const auth = authResult.ctx;

    const body = await req.json();
    const { permissionIds = [], ...roleData } = body;
    const canonicalCode = canonicalRoleCode(roleData);
    if (canonicalCode) {
      roleData.code = canonicalCode;
      roleData.name = CANONICAL_ROLES[canonicalCode].name;
      roleData.description = roleData.description || CANONICAL_ROLES[canonicalCode].description;
    }
    const tenantId = auth.isSuperAdmin ? (roleData.tenantId ?? null) : auth.tenantId;

    const role = await prisma.role.create({
      data: {
        ...roleData,
        tenantId,
        isSystem: auth.isSuperAdmin ? roleData.isSystem : false,
        permissions: permissionIds.length
          ? { create: permissionIds.map((pid: string) => ({ permissionId: pid })) }
          : undefined,
      },
      include: { _count: { select: { permissions: true } } },
    });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: role.tenantId ?? auth.tenantId,
      entityType: 'Role',
      entityId: role.id,
      entityName: role.name,
      action: 'CREATE',
      after: role,
      summary: `Created role ${role.code}.`,
    });
    await recordRoleVersion({
      req,
      ctx: auth,
      roleId: role.id,
      tenantId: role.tenantId ?? auth.tenantId,
      changeType: 'CREATE',
      summary: `Created role ${role.code}.`,
    });
    return NextResponse.json(role, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
