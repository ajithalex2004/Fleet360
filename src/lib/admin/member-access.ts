/**
 * Module access as the admin screens present it, shared by the Module
 * Access dialog (/api/admin/tenants/[id]/users/[userId]/access) and the New
 * User form (/api/admin/tenants/[id]/members). The rules themselves live in
 * src/lib/authz/access-mask.ts.
 */
import { MODULES as MODULE_DEFS, resolveModuleKey } from '@/lib/modules';
import type { AccessLevel, AccessMask } from '@/lib/authz/access-mask';

export interface AccessModuleRow {
  key: string;
  label: string;
  enabledForTenant: boolean;
  /** The access levels the role grants in this module. */
  roleAccess: AccessLevel[];
}

const MODULE_LABEL = new Map(MODULE_DEFS.map((m) => [m.key as string, m.shortName ?? m.name]));

/**
 * The modules to offer: the company's modules plus any the role holds.
 * Admin access follows the role (Tenant Administrator), not module access,
 * so it is not offered.
 */
export function accessModuleRows(
  tenantModules: readonly string[],
  roleAccess: Record<string, AccessLevel[]>,
): AccessModuleRow[] {
  const enabled = new Set(tenantModules.map((m) => resolveModuleKey(m) ?? m));
  const keys = new Set([...enabled, ...Object.keys(roleAccess)]);
  keys.delete('admin');
  return [...keys]
    .filter((k) => MODULE_LABEL.has(k))
    .map((key) => ({
      key,
      label: MODULE_LABEL.get(key)!,
      enabledForTenant: enabled.has(key),
      roleAccess: roleAccess[key] ?? [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * What to store for a requested mask: levels the role does not grant are
 * dropped, and a module left with all of the role's access is not stored
 * (it follows the role). Nothing narrowed: null.
 */
export function narrowToRole(
  requested: AccessMask | null,
  roleAccess: Record<string, AccessLevel[]>,
): AccessMask | null {
  if (!requested) return null;
  let mask: AccessMask | null = null;
  for (const [key, levels] of Object.entries(requested)) {
    if (key === 'admin') continue;
    const granted = roleAccess[key] ?? [];
    if (granted.length === 0) continue; // nothing to narrow
    const kept = levels.filter((l) => granted.includes(l));
    if (kept.length < granted.length) (mask ??= {})[key] = kept;
  }
  return mask;
}
