import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

export const CANONICAL_ROLES = {
  SUPER_ADMIN: {
    name: 'Super Administrator',
    description: 'Full platform access - all tenants, all modules, all actions',
    aliases: ['SUPER_ADMIN', 'Super Admin', 'Super Administrator'],
  },
  TENANT_ADMIN: {
    name: 'Tenant Administrator',
    description: 'Full access within their tenant - all modules except platform admin',
    aliases: ['TENANT_ADMIN', 'Tenant Admin', 'Tenant_Admin', 'Tenant Administrator'],
  },
} as const;

type CanonicalRoleCode = keyof typeof CANONICAL_ROLES;
type PrismaLike = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

type RoleSummary = {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  isSystem: boolean | null;
  description: string | null;
  createdAt: Date | null;
  _count: { userTenants: number; permissions: number };
};

export type RoleCanonicalizationResult = {
  scanned: number;
  updated: number;
  merged: number;
  reassignedUsers: number;
  copiedPermissions: number;
  deletedDuplicates: number;
  changes: Array<{
    tenantId: string | null;
    code: CanonicalRoleCode;
    keptRoleId: string;
    duplicateRoleIds: string[];
    beforeName?: string;
    afterName: string;
  }>;
};

function compactRoleToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function canonicalRoleCode(input: { code?: string | null; name?: string | null }): CanonicalRoleCode | null {
  const codeToken = compactRoleToken(input.code);
  const nameToken = compactRoleToken(input.name);

  for (const [code, meta] of Object.entries(CANONICAL_ROLES) as Array<[CanonicalRoleCode, typeof CANONICAL_ROLES[CanonicalRoleCode]]>) {
    const tokens = [code, meta.name, ...meta.aliases].map(compactRoleToken);
    if (tokens.includes(codeToken) || tokens.includes(nameToken)) return code;
  }

  return null;
}

export function canonicalRoleLabel(code: string, fallbackName?: string | null): string {
  const canonical = canonicalRoleCode({ code, name: fallbackName });
  return canonical ? CANONICAL_ROLES[canonical].name : (fallbackName || code);
}

function rankRole(role: RoleSummary): number {
  let score = 0;
  if (role.code === canonicalRoleCode(role)) score += 1000;
  if (role.isSystem) score += 500;
  score += role._count.userTenants * 10;
  score += role._count.permissions;
  return score;
}

function roleSort(a: RoleSummary, b: RoleSummary): number {
  const scoreDelta = rankRole(b) - rankRole(a);
  if (scoreDelta !== 0) return scoreDelta;
  const aTime = a.createdAt?.getTime() ?? 0;
  const bTime = b.createdAt?.getTime() ?? 0;
  return aTime - bTime || a.id.localeCompare(b.id);
}

export async function normalizeCanonicalRoles(client: PrismaLike = defaultPrisma): Promise<RoleCanonicalizationResult> {
  const result: RoleCanonicalizationResult = {
    scanned: 0,
    updated: 0,
    merged: 0,
    reassignedUsers: 0,
    copiedPermissions: 0,
    deletedDuplicates: 0,
    changes: [],
  };

  const roles = await client.role.findMany({
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      isSystem: true,
      description: true,
      createdAt: true,
      _count: { select: { userTenants: true, permissions: true } },
    },
  });
  result.scanned = roles.length;

  const groups = new Map<string, { code: CanonicalRoleCode; tenantId: string | null; roles: RoleSummary[] }>();
  for (const role of roles) {
    const code = canonicalRoleCode(role);
    if (!code) continue;
    const key = `${role.tenantId ?? 'platform'}:${code}`;
    const group = groups.get(key) ?? { code, tenantId: role.tenantId, roles: [] };
    group.roles.push(role);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const canonical = CANONICAL_ROLES[group.code];
    const sorted = [...group.roles].sort(roleSort);
    const keeper = sorted[0];
    const duplicates = sorted.slice(1);
    const needsUpdate =
      keeper.code !== group.code ||
      keeper.name !== canonical.name ||
      keeper.description !== canonical.description ||
      keeper.isSystem !== true;

    if (needsUpdate) {
      await client.role.update({
        where: { id: keeper.id },
        data: {
          code: group.code,
          name: canonical.name,
          description: canonical.description,
          isSystem: true,
        },
      });
      result.updated += 1;
    }

    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map(role => role.id);
      const duplicatePermissions = await client.rolePermission.findMany({
        where: { roleId: { in: duplicateIds } },
        select: { permissionId: true },
      });
      const permissionIds = [...new Set(duplicatePermissions.map(row => row.permissionId))];

      if (permissionIds.length > 0) {
        await client.rolePermission.createMany({
          data: permissionIds.map(permissionId => ({ roleId: keeper.id, permissionId })),
          skipDuplicates: true,
        });
        result.copiedPermissions += permissionIds.length;
      }

      const reassigned = await client.userTenant.updateMany({
        where: { roleId: { in: duplicateIds } },
        data: { roleId: keeper.id },
      });
      result.reassignedUsers += reassigned.count;

      const deleted = await client.role.deleteMany({ where: { id: { in: duplicateIds } } });
      result.deletedDuplicates += deleted.count;
      result.merged += duplicateIds.length;
    }

    if (needsUpdate || duplicates.length > 0) {
      result.changes.push({
        tenantId: group.tenantId,
        code: group.code,
        keptRoleId: keeper.id,
        duplicateRoleIds: duplicates.map(role => role.id),
        beforeName: keeper.name,
        afterName: canonical.name,
      });
    }
  }

  return result;
}
