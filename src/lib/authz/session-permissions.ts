/**
 * The effective permissions of a user in a tenant: what every staff session
 * issuer signs into the session (signSession({ permissions })) and what the
 * login response hands the UI, so the UI hides exactly what the policy
 * denies (src/lib/authz/policy.ts).
 *
 * Which model is authoritative:
 *   - a platform system role (roles.tenant_id NULL, code in SYSTEM_ROLES)
 *     with no tenant override: the code catalogue SYSTEM_ROLES. The
 *     database copy (seeded by POST /api/admin/seed) can lag behind the
 *     code; the code is the versioned policy.
 *   - a tenant override of a system role, or a tenant's own custom role:
 *     that role's grants in role_permissions.
 *   - platform SUPER_ADMIN additionally holds the wildcard '*:*:*'.
 *   - no active membership, or a role belonging to another tenant: nothing.
 */
import { getEffectiveRole, type EffectiveRoleShape } from '@/lib/permissions/effective-role';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

type Tx = Parameters<typeof getEffectiveRole>[0];

const SYSTEM_ROLE_PERMISSIONS = new Map(
  SYSTEM_ROLES.map((r) => [r.code, r.permissions.map((p) => `${p.module}:${p.action}:${p.resource}`)]),
);

/** The code catalogue's permissions for a system role (e.g. the TENANT_ADMIN a new tenant's creator gets). */
export function systemRolePermissions(code: string): string[] {
  return [...(SYSTEM_ROLE_PERMISSIONS.get(code) ?? [])];
}

/** The permissions an already-resolved effective role grants (see the header). */
export function permissionsForEffectiveRole(role: EffectiveRoleShape | null): string[] {
  if (!role) return [];
  const systemRole = role.isPlatform && !role.isOverride ? SYSTEM_ROLE_PERMISSIONS.get(role.code) : undefined;
  const permissions = new Set(systemRole ?? role.permissions);
  if (role.code === 'SUPER_ADMIN' && role.isPlatform && !role.isOverride) permissions.add('*:*:*');
  return [...permissions];
}

export async function resolveSessionPermissions(tx: Tx, userId: string, tenantId: string): Promise<string[]> {
  return permissionsForEffectiveRole(await getEffectiveRole(tx, userId, tenantId));
}

/**
 * For session issuers: the permissions to sign into a new session. Runs in
 * platform context like the membership lookups that establish the tenant
 * (user_tenants and tenant roles are under RLS).
 */
export async function sessionPermissionsFor(userId: string, tenantId: string): Promise<string[]> {
  return withPlatformAdmin(prisma, (tx) => resolveSessionPermissions(tx as never, userId, tenantId));
}
