import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: 'EXL-360-001' },
    include: {
      modules: true,
      userTenants: {
        include: {
          user: true,
          role: {
            include: {
              permissions: {
                include: { permission: true }
              }
            }
          }
        }
      }
    }
  });

  if (!tenant) {
    console.error('Tenant EXL-360-001 not found');
    return;
  }

  const enabledModules = tenant.modules.filter(m => m.isEnabled).map(m => m.module);
  console.log('Tenant:', tenant.name, `(${tenant.code})`);
  console.log('Enabled Modules in DB:', enabledModules);

  const ut = tenant.userTenants[0];
  const user = ut.user;
  const role = ut.role;
  const permissions = role.permissions.map(p => `${p.permission.module}:${p.permission.action}:${p.permission.resource}`);

  console.log('Test User:', user.username, 'Role:', role.code, `(${role.name})`);
  console.log('Total Permissions:', permissions.length);

  // Import canOpenModule from compiled or mock the exact function logic
  const LEGACY_MODULE_ALIASES = {
    rac: 'rental',
    bus_ops: 'bus-ops',
    drivers: 'driver-mgmt',
    staff: 'bus-ops',
    ambulance: 'incidents',
    school_bus: 'school-bus',
    'port-drayage': 'drayage',
    'port_drayage': 'drayage',
    'container-drayage': 'drayage',
  };

  function keysFor(module) {
    const keys = [module];
    for (const [legacy, canonical] of Object.entries(LEGACY_MODULE_ALIASES)) {
      if (canonical === module) keys.push(legacy);
    }
    return keys;
  }

  function holdsAnyPermissionIn(perms, module) {
    if (perms.includes('*:*:*')) return true;
    if (module === 'drayage' && perms.some((p) => p.startsWith('logistics:') || p.startsWith('drayage:'))) return true;
    return keysFor(module).some((m) => perms.some((p) => p.startsWith(`${m}:`)));
  }

  function tenantHas(enabled, module) {
    if (!enabled || enabled.length === 0) return true;
    return keysFor(module).some((m) => enabled.includes(m));
  }

  function canOpenModule(module, viewer) {
    const r = viewer.roleCode ?? '';
    if (r === 'SUPER_ADMIN') return true;
    if (module === 'admin') {
      if (viewer.enabledModules && viewer.enabledModules.length > 0 && !viewer.enabledModules.includes('admin')) {
        return false;
      }
      return r === 'TENANT_ADMIN' || r === 'ADMIN' || r.includes('ADMIN') || holdsAnyPermissionIn(viewer.permissions, 'admin');
    }
    if (module === 'exchange') return r === 'TENANT_ADMIN' || r === 'PARTNER';
    if (module === 'locations') return canOpenModule('fleet', viewer);
    return tenantHas(viewer.enabledModules, module) && holdsAnyPermissionIn(viewer.permissions, module);
  }

  const allModulesToTest = [
    'drayage',
    'fleet',
    'logistics',
    'school-bus',
    'bus-ops',
    'leasing',
    'rental',
    'dispatch',
    'maintenance',
    'driver-mgmt',
    'assets',
    'finance',
    'compliance',
    'sustainability',
    'reports',
    'agents',
    'service-tickets',
    'customer-mgmt',
    'booking-portal',
    'admin'
  ];

  console.log('\n--- NAVIGATION VISIBILITY AUDIT ---');
  const visible = [];
  const hidden = [];

  for (const mod of allModulesToTest) {
    const allowed = canOpenModule(mod, {
      roleCode: role.code,
      enabledModules,
      permissions
    });
    if (allowed) {
      visible.push(mod);
    } else {
      hidden.push(mod);
    }
  }

  console.log('VISIBLE IN MENU (' + visible.length + '):');
  visible.forEach(m => console.log('  [✓] ' + m));

  console.log('\nHIDDEN FROM MENU (' + hidden.length + '):');
  hidden.forEach(m => console.log('  [x] ' + m));

  if (visible.length === 2 && visible.includes('drayage') && visible.includes('fleet')) {
    console.log('\n>>> SUCCESS: EXACTLY AND ONLY 2 MENU ITEMS VISIBLE! <<<');
  } else {
    console.log('\n>>> WARNING: Check visible items above <<<');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (key === 'DATABASE_URL' && process.env[key]?.startsWith('postgresql+psycopg://')) {
      process.env[key] = raw.replace(/^["']|["']$/g, '');
      continue;
    }
    if (!process.env[key]) {
      process.env[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
}
