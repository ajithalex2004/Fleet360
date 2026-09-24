/**
 * Which role an SSO sign-in grants when it creates a tenant membership
 * (JIT provisioning, or an existing user joining a tenant through its SSO).
 *
 *   1. The tenant's configured default role (tenant_sso_configs.default_role_id),
 *      if it still exists, belongs to the tenant or the platform catalogue,
 *      and is not SUPER_ADMIN.
 *   2. Otherwise read-only access: the tenant's own VIEWER role, else the
 *      platform VIEWER role.
 *   3. Otherwise null, and the sign-in is refused (/login?sso=no-role).
 *
 * It never falls back to TENANT_ADMIN or to an arbitrary tenant role: an
 * SSO user only gets more than read-only access when a tenant admin chose
 * that role as the SSO default.
 */

export interface ProvisioningRole {
  id: string;
  code: string;
}

/** Looks up one role matching `where` (a Prisma RoleWhereInput). */
export type RoleFinder = (where: Record<string, unknown>) => Promise<ProvisioningRole | null>;

export const SSO_FALLBACK_ROLE_CODE = 'VIEWER';

export async function pickProvisioningRole(
  tenantId: string,
  preferredRoleId: string | null,
  findRole: RoleFinder,
): Promise<ProvisioningRole | null> {
  if (preferredRoleId) {
    const preferred = await findRole({
      id: preferredRoleId,
      // Never provision a platform SUPER_ADMIN through a tenant's SSO, even
      // if a config saved before the role-grant check points at that role.
      code: { not: 'SUPER_ADMIN' },
      OR: [{ tenantId }, { tenantId: null }],
    });
    if (preferred) return preferred;
  }

  const tenantViewer = await findRole({ tenantId, code: SSO_FALLBACK_ROLE_CODE });
  if (tenantViewer) return tenantViewer;

  return findRole({ tenantId: null, code: SSO_FALLBACK_ROLE_CODE });
}
