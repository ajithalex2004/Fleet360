/**
 * Who may open a module in the UI: the sidebar shows, and ModuleGuard lets
 * through, the same modules. The server decides independently (the admin
 * route gate and the authorization policy, src/lib/authz/policy.ts); this
 * keeps the UI from offering what the server refuses.
 *
 *   SUPER_ADMIN       every module
 *   'admin'           Tenant Administrators
 *   'exchange'        Tenant Administrators and Exchange partner staff
 *   'locations'       whoever may open Fleet
 *   any other module  the tenant has it (when the tenant has a module list)
 *                     and the role holds at least one permission in it
 */
import { LEGACY_MODULE_ALIASES } from '@/lib/modules';

export interface ModuleViewer {
  roleCode: string | null | undefined;
  /** The tenant's effective modules; empty means no restriction recorded. */
  enabledModules: readonly string[] | null | undefined;
  /** The session's effective permissions, module:action:resource. */
  permissions: readonly string[];
}

const SUPER_ADMIN = 'SUPER_ADMIN';
const TENANT_ADMIN = 'TENANT_ADMIN';
const PARTNER = 'PARTNER';

/** Canonical module key → itself plus its legacy aliases. */
function keysFor(module: string): string[] {
  const keys = [module];
  for (const [legacy, canonical] of Object.entries(LEGACY_MODULE_ALIASES)) {
    if (canonical === module) keys.push(legacy);
  }
  return keys;
}

/** Whether `permissions` hold any action on any resource of `module`. */
export function holdsAnyPermissionIn(permissions: readonly string[], module: string): boolean {
  if (permissions.includes('*:*:*')) return true;
  if ((module === 'drayage' || module === 'logistics') && permissions.some((p) => p.startsWith('logistics:') || p.startsWith('drayage:'))) return true;
  return keysFor(module).some((m) => permissions.some((p) => p.startsWith(`${m}:`)));
}

function tenantHas(enabled: readonly string[] | null | undefined, module: string): boolean {
  if (!enabled || enabled.length === 0) return true;
  if (module === 'logistics' && (enabled.includes('logistics') || enabled.includes('drayage') || enabled.includes('port-drayage') || enabled.includes('container-drayage'))) return true;
  return keysFor(module).some((m) => enabled.includes(m));
}

export function canOpenModule(module: string, viewer: ModuleViewer): boolean {
  const role = viewer.roleCode ?? '';
  if (role === SUPER_ADMIN) return true;
  if (module === 'admin') {
    if (viewer.enabledModules && viewer.enabledModules.length > 0 && !viewer.enabledModules.includes('admin')) {
      return false;
    }
    return role === TENANT_ADMIN || role === SUPER_ADMIN || role === 'ADMIN' || role.includes('ADMIN') || holdsAnyPermissionIn(viewer.permissions, 'admin');
  }
  if (module === 'exchange') return role === TENANT_ADMIN || role === PARTNER;
  if (module === 'locations') return canOpenModule('fleet', viewer);
  return tenantHas(viewer.enabledModules, module) && holdsAnyPermissionIn(viewer.permissions, module);
}
