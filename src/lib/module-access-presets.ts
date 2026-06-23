import { ALL_PERMISSIONS, MODULES, type Action } from '@/lib/permissions';

const MODULE_ALIASES: Record<string, string> = {
  driver: 'drivers',
  drivers: 'drivers',
  'driver-mgmt': 'drivers',
  bus_ops: 'bus_ops',
  'bus-ops': 'bus_ops',
  staff: 'bus_ops',
  school_bus: 'bus_ops',
  'school-bus': 'bus_ops',
  rental: 'rac',
  rac: 'rac',
  booking: 'rac',
  rent_a_car: 'rac',
  incident: 'compliance',
  incidents: 'compliance',
  compliance: 'compliance',
};

export type ModuleAccessPreset = 'admin' | 'manager' | 'operator' | 'viewer';

export const MODULE_ACCESS_PRESETS: Array<{
  key: ModuleAccessPreset;
  label: string;
  description: string;
  actions: Action[];
}> = [
  {
    key: 'admin',
    label: 'Admin',
    description: 'Full module permissions including destructive/configuration actions.',
    actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'],
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'Operational lead permissions: manage work, approvals, and exports.',
    actions: ['view', 'create', 'edit', 'approve', 'export'],
  },
  {
    key: 'operator',
    label: 'Operator',
    description: 'Day-to-day execution permissions without approval or delete rights.',
    actions: ['view', 'create', 'edit'],
  },
  {
    key: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to the module.',
    actions: ['view'],
  },
];

export function normalizeModuleKey(key: string): string {
  return MODULE_ALIASES[key] ?? key;
}

function normalizePreset(value: unknown): ModuleAccessPreset | null {
  if (value === false || value == null) return null;
  if (value === true) return 'viewer';
  const role = typeof value === 'string'
    ? value
    : typeof value === 'object' && 'role' in value
      ? String((value as { role?: unknown }).role ?? '')
      : '';
  const key = role.toLowerCase();
  return MODULE_ACCESS_PRESETS.some(p => p.key === key) ? key as ModuleAccessPreset : 'viewer';
}

export function permissionKeysForModulePreset(module: string, preset: ModuleAccessPreset): string[] {
  const canonical = normalizeModuleKey(module);
  const allowedActions = new Set(MODULE_ACCESS_PRESETS.find(p => p.key === preset)?.actions ?? ['view']);
  return ALL_PERMISSIONS
    .filter(p => p.module === canonical && allowedActions.has(p.action))
    .map(p => `${p.module}:${p.action}:${p.resource ?? '*'}`);
}

export function normalizeModuleAccessRecord(moduleAccess: unknown) {
  if (!moduleAccess || typeof moduleAccess !== 'object' || Array.isArray(moduleAccess)) return moduleAccess;
  const normalized: Record<string, { role: ModuleAccessPreset; permissions: string[] }> = {};
  for (const [key, value] of Object.entries(moduleAccess as Record<string, unknown>)) {
    const module = normalizeModuleKey(key);
    if (!(MODULES as readonly string[]).includes(module)) continue;
    const role = normalizePreset(value);
    if (!role) continue;
    normalized[module] = {
      role,
      permissions: permissionKeysForModulePreset(module, role),
    };
  }
  return normalized;
}

export function moduleAccessPermissionKeys(moduleAccess: unknown): string[] {
  const normalized = normalizeModuleAccessRecord(moduleAccess);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return [];
  return Object.values(normalized as Record<string, { permissions?: string[] }>)
    .flatMap(v => Array.isArray(v.permissions) ? v.permissions : []);
}
