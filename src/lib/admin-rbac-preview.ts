import { prisma } from '@/lib/prisma';

export interface PermissionShape {
  id: string;
  module: string;
  action: string;
  resource: string | null;
  label: string | null;
  description: string | null;
}

export interface RbacAffectedUser {
  id: string;
  email: string;
  username: string;
  name: string;
  department: string | null;
  tenantId: string;
}

export interface PermissionModuleDelta {
  module: string;
  added: number;
  removed: number;
}

export interface RolePermissionPreview {
  roleId: string;
  roleName: string;
  roleCode: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  affectedUsers: number;
  affectedUserSample: RbacAffectedUser[];
  currentPermissionCount: number;
  proposedPermissionCount: number;
  added: PermissionShape[];
  removed: PermissionShape[];
  moduleDelta: PermissionModuleDelta[];
}

const DANGEROUS_ACTIONS = new Set(['delete', 'approve']);
const SENSITIVE_MODULES = new Set(['admin', 'finance', 'billing', 'security', 'compliance']);

export async function previewRolePermissionChange(
  roleId: string,
  proposedPermissionIds: string[],
): Promise<RolePermissionPreview | null> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, code: true },
  });
  if (!role) return null;

  const requestedIds = Array.from(new Set(proposedPermissionIds.map(v => v.trim()).filter(Boolean)));
  const [currentRows, affectedUsers, affectedUserRows] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    }),
    prisma.userTenant.count({ where: { roleId, isActive: true } }),
    prisma.userTenant.findMany({
      where: { roleId, isActive: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    }),
  ]);

  const currentIds = new Set(currentRows.map(rp => rp.permissionId));
  const nextIds = new Set(requestedIds);
  const addedIds = requestedIds.filter(permissionId => !currentIds.has(permissionId));
  const removedIds = [...currentIds].filter(permissionId => !nextIds.has(permissionId));
  const changedPermissionRows = await prisma.permission.findMany({
    where: { id: { in: [...addedIds, ...removedIds] } },
  });
  const byId = new Map(changedPermissionRows.map(p => [p.id, p]));
  const added = addedIds.map(permissionId => byId.get(permissionId)).filter((p): p is PermissionShape => !!p);
  const removed = removedIds.map(permissionId => byId.get(permissionId)).filter((p): p is PermissionShape => !!p);
  const moduleDelta = summarizeModuleDelta(added, removed);
  const riskReasons = buildRiskReasons(added, removed, affectedUsers);
  const riskLevel = riskReasons.some(reason => reason.startsWith('High impact'))
    ? 'high'
    : riskReasons.length > 0
      ? 'medium'
      : 'low';

  return {
    roleId,
    roleName: role.name,
    roleCode: role.code,
    riskLevel,
    riskReasons,
    affectedUsers,
    affectedUserSample: affectedUserRows.map(row => ({
      id: row.user.id,
      email: row.user.email,
      username: row.user.username,
      name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || row.user.username,
      department: row.user.department ?? null,
      tenantId: row.tenantId,
    })),
    currentPermissionCount: currentIds.size,
    proposedPermissionCount: nextIds.size,
    added,
    removed,
    moduleDelta,
  };
}

function summarizeModuleDelta(added: PermissionShape[], removed: PermissionShape[]) {
  const modules = new Map<string, PermissionModuleDelta>();
  for (const perm of added) {
    const entry = modules.get(perm.module) ?? { module: perm.module, added: 0, removed: 0 };
    entry.added++;
    modules.set(perm.module, entry);
  }
  for (const perm of removed) {
    const entry = modules.get(perm.module) ?? { module: perm.module, added: 0, removed: 0 };
    entry.removed++;
    modules.set(perm.module, entry);
  }
  return [...modules.values()].sort((a, b) => a.module.localeCompare(b.module));
}

function buildRiskReasons(added: PermissionShape[], removed: PermissionShape[], affectedUsers: number) {
  const reasons: string[] = [];
  const dangerousAdds = added.filter(p => DANGEROUS_ACTIONS.has(p.action));
  const sensitiveChanges = [...added, ...removed].filter(p => SENSITIVE_MODULES.has(p.module));
  if (affectedUsers >= 10 && (added.length > 0 || removed.length > 0)) {
    reasons.push(`High impact: ${affectedUsers} active users inherit this role.`);
  }
  if (dangerousAdds.length > 0) {
    reasons.push(`High impact: grants ${dangerousAdds.length} destructive or approval permission(s).`);
  }
  if (sensitiveChanges.length > 0) {
    reasons.push(`Sensitive scope: changes ${sensitiveChanges.length} admin/finance/security/compliance permission(s).`);
  }
  if (removed.length > added.length && removed.length > 0) {
    reasons.push(`Access reduction: removes ${removed.length} permission(s).`);
  }
  return reasons;
}
