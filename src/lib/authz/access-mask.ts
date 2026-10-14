/**
 * Per-company module access: an optional mask on a user's membership
 * (user_tenants.module_access) that narrows what their role grants in that
 * company. It never widens it.
 *
 *   effective permissions = role permissions ∩ module access
 *
 * The mask names modules and, for each, the access the user keeps:
 *
 *   { "logistics": ["view"], "fleet": ["view", "create", "edit"], "finance": [] }
 *
 *   view    view, export
 *   create  create
 *   edit    edit, approve, admin
 *   delete  delete
 *
 * A module the mask names keeps only those of the role's permissions whose
 * access is listed ([] removes the module). A module the mask does not name
 * follows the role unchanged, so a module added to the role later is not
 * silently withheld. No mask (null) means the role applies as is.
 *
 * Platform administrators are never narrowed. Applied where session
 * permissions are resolved (src/lib/authz/session-permissions.ts), so the
 * menu, page guards, Next.js routes and the Go backend all follow it.
 */
import { MODULES } from '@/lib/permissions';
import { resolveModuleKey } from '@/lib/modules';

export const ACCESS_LEVELS = ['view', 'create', 'edit', 'delete'] as const;
export type AccessLevel = typeof ACCESS_LEVELS[number];
export type AccessMask = Record<string, AccessLevel[]>;

const KNOWN_MODULES: ReadonlySet<string> = new Set(MODULES);

/** The access level a permission action needs. */
export function accessLevelFor(action: string): AccessLevel {
  switch (action) {
    case 'view':
    case 'export':
      return 'view';
    case 'create':
      return 'create';
    case 'delete':
      return 'delete';
    default:
      return 'edit'; // edit, approve, admin
  }
}

/** A permission's module in canonical form (legacy aliases resolved). */
function canonicalModule(module: string): string {
  return module === 'admin' ? 'admin' : (resolveModuleKey(module) ?? module);
}

/**
 * Validates a mask from a request or the database. Returns null for "no
 * mask"; throws on anything malformed so a bad value is never stored or
 * half-applied. Selecting create, edit or delete implies view.
 */
export function parseAccessMask(value: unknown): AccessMask | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Module access must be an object of module → access levels');
  const mask: AccessMask = {};
  for (const [rawModule, rawLevels] of Object.entries(value as Record<string, unknown>)) {
    const key = canonicalModule(rawModule);
    if (!KNOWN_MODULES.has(key)) throw new Error(`Unknown module: ${rawModule}`);
    if (!Array.isArray(rawLevels)) throw new Error(`Access for ${rawModule} must be a list`);
    const levels = new Set<AccessLevel>();
    for (const l of rawLevels) {
      if (!ACCESS_LEVELS.includes(l as AccessLevel)) throw new Error(`Unknown access level for ${rawModule}: ${String(l)}`);
      levels.add(l as AccessLevel);
    }
    if (levels.size > 0) levels.add('view');
    mask[key] = ACCESS_LEVELS.filter((l) => levels.has(l));
  }
  return mask;
}

/** Reads a stored mask, treating a malformed value as "no access" for the modules it names. */
export function storedAccessMask(value: unknown): AccessMask | null {
  try {
    return parseAccessMask(value);
  } catch {
    // Fail closed: keep the module names that are recognisable, with no access.
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const mask: AccessMask = {};
    for (const k of Object.keys(value as object)) mask[canonicalModule(k)] = [];
    return mask;
  }
}

/** The role's permissions narrowed by the mask (module:action:resource strings). */
export function applyAccessMask(permissions: readonly string[], mask: AccessMask | null, roleCode?: string | null): string[] {
  if (!mask || roleCode === 'SUPER_ADMIN') return [...permissions];
  return permissions.filter((p) => {
    if (p === '*:*:*') return true;
    const [mod, action] = p.split(':');
    const allowed = mask[canonicalModule(mod)];
    if (!allowed) return true; // module not named: the role applies
    if (action === '*') return ACCESS_LEVELS.every((l) => allowed.includes(l));
    return allowed.includes(accessLevelFor(action));
  });
}

/** For the Module Access dialog: per module, the access levels the role grants. */
export function roleAccessByModule(permissions: readonly string[]): Record<string, AccessLevel[]> {
  const byModule = new Map<string, Set<AccessLevel>>();
  for (const p of permissions) {
    if (p === '*:*:*') {
      for (const m of KNOWN_MODULES) byModule.set(m, new Set(ACCESS_LEVELS));
      continue;
    }
    const [mod, action] = p.split(':');
    const m = canonicalModule(mod);
    const set = byModule.get(m) ?? new Set<AccessLevel>();
    if (action === '*') ACCESS_LEVELS.forEach((l) => set.add(l));
    else set.add(accessLevelFor(action));
    byModule.set(m, set);
  }
  const out: Record<string, AccessLevel[]> = {};
  for (const [m, set] of byModule) out[m] = ACCESS_LEVELS.filter((l) => set.has(l));
  return out;
}
