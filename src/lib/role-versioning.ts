import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AdminContext } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';

export async function ensureRoleVersionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS role_versions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_id         TEXT NOT NULL,
      tenant_id       TEXT,
      version_number  INTEGER NOT NULL,
      change_type     TEXT NOT NULL,
      actor_user_id   TEXT,
      actor_role      TEXT,
      snapshot_json   JSONB NOT NULL,
      summary         TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(role_id, version_number)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_role_versions_role
    ON role_versions(role_id, version_number DESC)
  `).catch(() => {});
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? Number(nested) : nested);
}

export async function getRoleSnapshot(roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      permissions: { include: { permission: true }, orderBy: { permissionId: 'asc' } },
      _count: { select: { userTenants: true, permissions: true } },
    },
  });
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    description: role.description,
    tenantId: role.tenantId,
    isSystem: !!role.isSystem,
    permissions: role.permissions.map(rp => ({
      id: rp.permission.id,
      module: rp.permission.module,
      action: rp.permission.action,
      resource: rp.permission.resource ?? '*',
      label: rp.permission.label,
    })),
    counts: role._count,
  };
}

export async function recordRoleVersion(args: {
  req?: NextRequest;
  ctx: AdminContext;
  roleId: string;
  tenantId?: string | null;
  changeType: string;
  summary?: string;
}) {
  const snapshot = await getRoleSnapshot(args.roleId);
  if (!snapshot) return null;
  await ensureRoleVersionTable();
  const [{ next_version } = { next_version: 1 }] = await prisma.$queryRawUnsafe<Array<{ next_version: number }>>(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
       FROM role_versions
      WHERE role_id = $1`,
    args.roleId,
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; version_number: number }>>(
    `INSERT INTO role_versions
       (role_id, tenant_id, version_number, change_type, actor_user_id, actor_role, snapshot_json, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING id::text, version_number`,
    args.roleId,
    args.tenantId ?? snapshot.tenantId ?? args.ctx.tenantId ?? null,
    Number(next_version),
    args.changeType,
    args.ctx.userId,
    args.ctx.role,
    safeJson(snapshot),
    args.summary ?? null,
  );
  return rows[0] ?? null;
}

export async function rollbackRoleToVersion(args: {
  req: NextRequest;
  ctx: AdminContext;
  roleId: string;
  versionId: string;
}) {
  await ensureRoleVersionTable();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    role_id: string;
    tenant_id: string | null;
    version_number: number;
    snapshot_json: any;
  }>>(
    `SELECT id::text, role_id, tenant_id, version_number, snapshot_json
       FROM role_versions
      WHERE id = $1::uuid AND role_id = $2
      LIMIT 1`,
    args.versionId,
    args.roleId,
  );
  const version = rows[0];
  if (!version) return null;
  const snapshot = version.snapshot_json;
  const before = await getRoleSnapshot(args.roleId);

  await prisma.$transaction([
    prisma.role.update({
      where: { id: args.roleId },
      data: {
        name: snapshot.name,
        code: snapshot.code,
        description: snapshot.description ?? null,
        isSystem: !!snapshot.isSystem,
      },
    }),
    prisma.rolePermission.deleteMany({ where: { roleId: args.roleId } }),
    prisma.rolePermission.createMany({
      data: (snapshot.permissions ?? []).map((p: { id: string }) => ({ roleId: args.roleId, permissionId: p.id })),
      skipDuplicates: true,
    }),
  ]);

  const newVersion = await recordRoleVersion({
    req: args.req,
    ctx: args.ctx,
    roleId: args.roleId,
    tenantId: version.tenant_id,
    changeType: 'ROLLBACK',
    summary: `Rolled back role to version ${version.version_number}.`,
  });
  const after = await getRoleSnapshot(args.roleId);
  await recordAdminChange({
    req: args.req,
    ctx: args.ctx,
    tenantId: version.tenant_id ?? args.ctx.tenantId,
    entityType: 'Role',
    entityId: args.roleId,
    entityName: after?.name,
    action: 'ROLLBACK',
    before,
    after,
    summary: `Rolled back role to version ${version.version_number}.`,
  });
  return { version, newVersion, role: after };
}

