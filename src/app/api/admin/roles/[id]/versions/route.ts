import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { ensureRoleVersionTable, recordRoleVersion, rollbackRoleToVersion } from '@/lib/role-versioning';

async function loadRoleForAccess(roleId: string) {
  return prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, tenantId: true, isSystem: true, code: true, name: true },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'view', 'roles');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const role = await loadRoleForAccess(id);
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  if (role.tenantId) {
    const scoped = resolveTenantBoundary(auth.ctx, role.tenantId);
    if (scoped instanceof NextResponse) return scoped;
  } else if (!auth.ctx.isSuperAdmin && !role.isSystem) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await ensureRoleVersionTable();
  let versions = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id::text, role_id, tenant_id, version_number, change_type,
            actor_user_id, actor_role, snapshot_json, summary, created_at::text
      FROM role_versions
     WHERE role_id = $1
      ORDER BY version_number DESC
      LIMIT 100`,
    id,
  );

  if (versions.length === 0) {
    await recordRoleVersion({
      req,
      ctx: auth.ctx,
      roleId: id,
      tenantId: role.tenantId ?? auth.ctx.tenantId,
      changeType: 'BASELINE',
      summary: `Captured baseline for role ${role.code}.`,
    });
    versions = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id::text, role_id, tenant_id, version_number, change_type,
              actor_user_id, actor_role, snapshot_json, summary, created_at::text
        FROM role_versions
       WHERE role_id = $1
        ORDER BY version_number DESC
        LIMIT 100`,
      id,
    );
  }

  return NextResponse.json({ role, versions });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'edit', 'roles');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const role = await loadRoleForAccess(id);
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  if (!auth.ctx.isSuperAdmin && (role.isSystem || role.tenantId !== auth.ctx.tenantId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.action !== 'rollback' || !body.versionId) {
    return NextResponse.json({ error: 'action=rollback and versionId are required' }, { status: 400 });
  }

  const approval = await requireDangerApproval(req, auth.ctx, 'role.version.rollback', {
    tenantId: role.tenantId ?? auth.ctx.tenantId,
    targetType: 'Role',
    targetId: id,
    summary: `Rollback role ${role.code} to version ${body.versionId}.`,
  });
  if (approval) return approval;

  const result = await rollbackRoleToVersion({
    req,
    ctx: auth.ctx,
    roleId: id,
    versionId: String(body.versionId),
  });
  if (!result) return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
