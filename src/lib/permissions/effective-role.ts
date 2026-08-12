/**
 * lib/permissions/effective-role.ts
 *
 * Runtime permission resolution for tenant role overrides.
 *
 * A `UserTenant` row points at a `Role`. If that role is a *platform* role
 * (Role.tenantId is null) and the same tenant has a *custom override* of the
 * same code (Role.tenantId = tenantId), the override's permissions should
 * take effect — that's the whole point of letting a tenant customize a
 * platform role without re-creating it.
 *
 * Without this helper, every read of `userTenant.role` would see the
 * platform role's permissions and miss the tenant's customizations.
 *
 * Where it plugs in:
 *   - /api/auth/login     — session sign-time resolution
 *   - /api/auth/session   — session refresh
 *   - /api/admin/session  — admin hub re-derive
 *   - anywhere else that reads userTenant.role.permissions
 *
 * Caching: callers should cache the result per-request (it does 1–2 DB
 * round-trips per call). For a per-tenant API hit, that's 2 SELECTs; for
 * the bulk user list it's batched. The helper does NOT do its own
 * caching — that would lie across role-override changes.
 */

import type { PrismaClient } from '@prisma/client';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Role record (just the fields we care about for resolution). */
export interface EffectiveRoleShape {
  id: string;
  code: string;
  name: string;
  /** True when this is a tenant-specific override (Role.tenantId set). */
  isOverride: boolean;
  /** True when this is a platform role (Role.tenantId is null). */
  isPlatform: boolean;
  /** The id of the source role (always present). */
  sourceRoleId: string;
  /** Permission strings in `module:action:resource` format. */
  permissions: string[];
}

/**
 * Resolved (effective) role for a (user, tenant) pair.
 *
 * Strategy:
 *   1. Look up the UserTenant row's role.
 *   2. If that role's tenantId matches the given tenantId, it's already
 *      a tenant-scoped role (either an override or a tenant-only role) —
 *      use it directly.
 *   3. Otherwise it's a platform role. Check if the same tenant has a
 *      custom role with the same `code`. If yes, return that override's
 *      permissions.
 *   4. If no override exists, return the platform role's permissions
 *      unchanged.
 *
 * SUPER_ADMIN platform role gets `*:*:*` appended on top of the override
 * (matches the existing /api/auth/login semantics).
 *
 * Returns null when the user has no UserTenant row for this tenant.
 */
export async function getEffectiveRole(
  tx: TxClient,
  userId: string,
  tenantId: string,
): Promise<EffectiveRoleShape | null> {
  const ut = await tx.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });
  if (!ut || !ut.isActive) return null;

  const assigned = ut.role;
  if (!assigned) return null;

  // Case 1: the assigned role is already tenant-scoped (override or
  // tenant-only role). Use it directly.
  if (assigned.tenantId === tenantId) {
    return shapeRole(assigned, false, true);
  }

  // Case 2: the assigned role is a platform role. Look for an override.
  if (assigned.tenantId === null) {
    const override = await tx.role.findUnique({
      where: { tenantId_code: { tenantId, code: assigned.code } },
      include: {
        permissions: { include: { permission: true } },
      },
    });
    // Use the override only if it actually belongs to this tenant and is
    // not a system role (customRolePermissions live elsewhere — we read
    // `permissions` which is the join to RolePermission).
    if (override && override.tenantId === tenantId) {
      return shapeRole(override, true, false);
    }
    // No override — return the platform role as-is.
    return shapeRole(assigned, false, true);
  }

  // Case 3: the assigned role belongs to a *different* tenant. That's a
  // data integrity issue; we still return the role so the caller can
  // handle it (and the RLS layer will block any actual data access).
  return shapeRole(assigned, false, true);
}

/** Convenience: return just the permission strings for the effective role. */
export async function getEffectivePermissions(
  tx: TxClient,
  userId: string,
  tenantId: string,
): Promise<string[]> {
  const role = await getEffectiveRole(tx, userId, tenantId);
  if (!role) return [];
  // Match the existing login semantics: a platform SUPER_ADMIN gets the
  // wildcard. A tenant override of SUPER_ADMIN does NOT get the wildcard
  // (matches /api/admin/session line 89-91).
  if (role.code === 'SUPER_ADMIN' && role.isPlatform) {
    return [...role.permissions, '*:*:*'];
  }
  return role.permissions;
}

function shapeRole(
  r: {
    id: string;
    code: string;
    name: string;
    tenantId: string | null;
    permissions: Array<{ permission: { module: string; action: string; resource: string | null } }>;
  },
  isOverride: boolean,
  isPlatform: boolean,
): EffectiveRoleShape {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    isOverride,
    isPlatform,
    sourceRoleId: r.id,
    permissions: r.permissions.map((rp) =>
      `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`,
    ),
  };
}

/**
 * Bulk resolver — for /api/admin/users where you need the effective
 * role for many (user, tenant) pairs. Returns a Map keyed by
 * `${userId}:${tenantId}` → EffectiveRoleShape. Single transaction.
 */
export async function getEffectiveRolesForTenantUsers(
  tx: TxClient,
  tenantId: string,
  userIds: string[],
): Promise<Map<string, EffectiveRoleShape>> {
  const out = new Map<string, EffectiveRoleShape>();
  if (userIds.length === 0) return out;

  const userTenants = await tx.userTenant.findMany({
    where: { tenantId, userId: { in: userIds }, isActive: true },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });

  // Collect candidate platform role codes to look for overrides in bulk.
  const platformRoleIds = userTenants
    .filter((ut) => ut.role.tenantId === null)
    .map((ut) => ut.role.id);
  const platformRoleCodes = new Set(
    userTenants.filter((ut) => ut.role.tenantId === null).map((ut) => ut.role.code),
  );

  const overrides = platformRoleIds.length === 0
    ? []
    : await tx.role.findMany({
        where: { tenantId, code: { in: [...platformRoleCodes] } },
        include: { permissions: { include: { permission: true } } },
      });
  const overrideByCode = new Map(overrides.map((o) => [o.code, o]));

  for (const ut of userTenants) {
    const assigned = ut.role;
    let role: EffectiveRoleShape;
    if (assigned.tenantId === tenantId) {
      role = shapeRole(assigned, false, true);
    } else if (assigned.tenantId === null) {
      const ov = overrideByCode.get(assigned.code);
      role = ov ? shapeRole(ov, true, false) : shapeRole(assigned, false, true);
    } else {
      role = shapeRole(assigned, false, true);
    }
    if (role.code === 'SUPER_ADMIN' && role.isPlatform) {
      role = { ...role, permissions: [...role.permissions, '*:*:*'] };
    }
    out.set(`${ut.userId}:${tenantId}`, role);
  }
  return out;
}
