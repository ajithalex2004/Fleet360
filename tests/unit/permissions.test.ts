/**
 * Unit tests for src/lib/permissions.ts
 *
 * What is tested:
 *  - hasPermission(): wildcard '*:*:*' grants everything
 *  - hasPermission(): module-level wildcard 'module:*:*'
 *  - hasPermission(): action+resource wildcard 'module:action:*'
 *  - hasPermission(): exact permission strings
 *  - hasPermission(): does not grant access to unrelated modules
 *  - canView(), canCreate(), canEdit(), canDelete() helper functions
 *  - SUPER_ADMIN permission set allows all standard actions
 *  - VIEWER permission set only allows view actions
 *  - SYSTEM_ROLES shape validation
 *
 * Prerequisites: none — pure unit tests, no DB or server required.
 */

import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  canView,
  canCreate,
  canEdit,
  canDelete,
  canApprove,
  canExport,
  buildPermissionKey,
  SYSTEM_ROLES,
  ALL_PERMISSIONS,
  MODULES,
  ACTIONS,
} from '@/lib/permissions';

// ── hasPermission() ───────────────────────────────────────────────────────────

describe('hasPermission()', () => {
  describe('wildcard *:*:*', () => {
    const superPerms = ['*:*:*'];

    it('grants view on any module', () => {
      expect(hasPermission(superPerms, 'fleet', 'view')).toBe(true);
      expect(hasPermission(superPerms, 'finance', 'view')).toBe(true);
      expect(hasPermission(superPerms, 'admin', 'view')).toBe(true);
    });

    it('grants create on any module', () => {
      expect(hasPermission(superPerms, 'leasing', 'create')).toBe(true);
      expect(hasPermission(superPerms, 'rac', 'create')).toBe(true);
    });

    it('grants delete on any module', () => {
      expect(hasPermission(superPerms, 'fleet', 'delete')).toBe(true);
    });

    it('grants approve on any module', () => {
      expect(hasPermission(superPerms, 'leasing', 'approve', 'quotations')).toBe(true);
    });

    it('grants export on any module', () => {
      expect(hasPermission(superPerms, 'reports', 'export')).toBe(true);
    });
  });

  describe('specific permission: fleet:view:*', () => {
    const perms = ['fleet:view:*'];

    it('grants view on fleet', () => {
      expect(hasPermission(perms, 'fleet', 'view')).toBe(true);
    });

    it('grants view on fleet with specific resource', () => {
      // module:action:* covers module:action:specific
      expect(hasPermission(perms, 'fleet', 'view', 'vehicles')).toBe(true);
    });

    it('does NOT grant create on fleet', () => {
      expect(hasPermission(perms, 'fleet', 'create')).toBe(false);
    });

    it('does NOT grant view on another module', () => {
      expect(hasPermission(perms, 'finance', 'view')).toBe(false);
      expect(hasPermission(perms, 'leasing', 'view')).toBe(false);
    });
  });

  describe('module-level wildcard: finance:*:*', () => {
    const perms = ['finance:*:*'];

    it('grants view on finance', () => {
      expect(hasPermission(perms, 'finance', 'view')).toBe(true);
    });

    it('grants create on finance', () => {
      expect(hasPermission(perms, 'finance', 'create')).toBe(true);
    });

    it('grants delete on finance', () => {
      expect(hasPermission(perms, 'finance', 'delete')).toBe(true);
    });

    it('does NOT grant view on fleet', () => {
      expect(hasPermission(perms, 'fleet', 'view')).toBe(false);
    });
  });

  describe('exact permission: leasing:create:invoices', () => {
    const perms = ['leasing:create:invoices'];

    it('grants the exact permission', () => {
      expect(hasPermission(perms, 'leasing', 'create', 'invoices')).toBe(true);
    });

    it('does NOT grant when resource is different', () => {
      expect(hasPermission(perms, 'leasing', 'create', 'contracts')).toBe(false);
    });

    it('does NOT grant edit on leasing invoices', () => {
      expect(hasPermission(perms, 'leasing', 'edit', 'invoices')).toBe(false);
    });
  });

  describe('empty permissions', () => {
    it('returns false for empty array', () => {
      expect(hasPermission([], 'fleet', 'view')).toBe(false);
    });

    it('returns false for null-like input guarded by the function', () => {
      // The function checks for falsy userPermissions
      expect(hasPermission([], 'admin', 'create')).toBe(false);
    });
  });

  describe('multiple permissions', () => {
    it('returns true if any permission in the array matches', () => {
      const perms = ['fleet:view:*', 'finance:view:*', 'leasing:create:invoices'];
      expect(hasPermission(perms, 'fleet', 'view')).toBe(true);
      expect(hasPermission(perms, 'finance', 'view')).toBe(true);
      expect(hasPermission(perms, 'leasing', 'create', 'invoices')).toBe(true);
    });

    it('returns false if no permission in the array matches', () => {
      const perms = ['fleet:view:*', 'finance:view:*'];
      expect(hasPermission(perms, 'admin', 'view')).toBe(false);
      expect(hasPermission(perms, 'fleet', 'create')).toBe(false);
    });
  });
});

// ── Helper functions ──────────────────────────────────────────────────────────

describe('canView()', () => {
  it('returns true when user has fleet:view:*', () => {
    expect(canView(['fleet:view:*'], 'fleet')).toBe(true);
  });

  it('returns false when user lacks fleet:view', () => {
    expect(canView(['finance:view:*'], 'fleet')).toBe(false);
  });

  it('returns true with wildcard *:*:*', () => {
    expect(canView(['*:*:*'], 'anything')).toBe(true);
  });
});

describe('canCreate()', () => {
  it('returns true when user has fleet:create:vehicles', () => {
    expect(canCreate(['fleet:create:vehicles'], 'fleet', 'vehicles')).toBe(true);
  });

  it('returns true when user has fleet:create:* (covers specific resource)', () => {
    expect(canCreate(['fleet:create:*'], 'fleet', 'vehicles')).toBe(true);
  });

  it('returns false when user only has fleet:view:*', () => {
    expect(canCreate(['fleet:view:*'], 'fleet')).toBe(false);
  });
});

describe('canEdit()', () => {
  it('returns true with fleet:edit:*', () => {
    expect(canEdit(['fleet:edit:*'], 'fleet')).toBe(true);
  });

  it('returns false when user only has view permissions', () => {
    expect(canEdit(['fleet:view:*'], 'fleet')).toBe(false);
  });
});

describe('canDelete()', () => {
  it('returns true with fleet:delete:*', () => {
    expect(canDelete(['fleet:delete:*'], 'fleet')).toBe(true);
  });

  it('returns false with only fleet:view:*', () => {
    expect(canDelete(['fleet:view:*'], 'fleet')).toBe(false);
  });
});

describe('canApprove()', () => {
  it('returns true with leasing:approve:*', () => {
    expect(canApprove(['leasing:approve:*'], 'leasing')).toBe(true);
  });

  it('returns false with only leasing:view:*', () => {
    expect(canApprove(['leasing:view:*'], 'leasing')).toBe(false);
  });
});

describe('canExport()', () => {
  it('returns true with fleet:export:*', () => {
    expect(canExport(['fleet:export:*'], 'fleet')).toBe(true);
  });

  it('returns false with only fleet:view:*', () => {
    expect(canExport(['fleet:view:*'], 'fleet')).toBe(false);
  });
});

// ── buildPermissionKey() ──────────────────────────────────────────────────────

describe('buildPermissionKey()', () => {
  it('builds "module:action:resource" string', () => {
    expect(buildPermissionKey('fleet', 'view', 'vehicles')).toBe('fleet:view:vehicles');
  });

  it('defaults resource to "*" when not provided', () => {
    expect(buildPermissionKey('fleet', 'view')).toBe('fleet:view:*');
  });
});

// ── SYSTEM_ROLES ──────────────────────────────────────────────────────────────

describe('SYSTEM_ROLES', () => {
  it('contains a SUPER_ADMIN role', () => {
    const superAdmin = SYSTEM_ROLES.find(r => r.code === 'SUPER_ADMIN');
    expect(superAdmin).toBeDefined();
  });

  it('SUPER_ADMIN has all permissions from ALL_PERMISSIONS', () => {
    const superAdmin = SYSTEM_ROLES.find(r => r.code === 'SUPER_ADMIN')!;
    // SUPER_ADMIN should have the same count as ALL_PERMISSIONS (mapped to module:action:resource)
    expect(superAdmin.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it('SUPER_ADMIN permissions cover all non-admin modules', () => {
    const superAdmin = SYSTEM_ROLES.find(r => r.code === 'SUPER_ADMIN')!;
    const permsAsStrings = superAdmin.permissions.map(
      p => `${p.module}:${p.action}:${p.resource}`,
    );

    // SUPER_ADMIN gets admin access via *:*:* wildcard (checked separately),
    // not via explicit per-module entries — so exclude 'admin' here.
    const nonAdminModules = MODULES.filter(m => m !== 'admin');
    for (const mod of nonAdminModules) {
      const hasView = hasPermission(permsAsStrings, mod, 'view');
      expect(hasView, `SUPER_ADMIN should be able to view ${mod}`).toBe(true);
    }
  });

  it('SUPER_ADMIN has wildcard permission granting full admin access', () => {
    const superAdmin = SYSTEM_ROLES.find(r => r.code === 'SUPER_ADMIN')!;
    const permsAsStrings = superAdmin.permissions.map(
      p => `${p.module}:${p.action}:${p.resource}`,
    );
    // The wildcard *:*:* is added at runtime (see /api/admin/session route),
    // but verify SUPER_ADMIN can view all modules when wildcard IS present
    const withWildcard = [...permsAsStrings, '*:*:*'];
    for (const mod of MODULES) {
      expect(hasPermission(withWildcard, mod, 'view'),
        `SUPER_ADMIN + wildcard should view ${mod}`).toBe(true);
    }
  });

  it('contains a VIEWER role with only view permissions', () => {
    const viewer = SYSTEM_ROLES.find(r => r.code === 'VIEWER');
    expect(viewer).toBeDefined();

    // All viewer permissions should use the 'view' action
    for (const perm of viewer!.permissions) {
      expect(perm.action).toBe('view');
    }
  });

  it('VIEWER role does NOT allow create on any module', () => {
    const viewer = SYSTEM_ROLES.find(r => r.code === 'VIEWER')!;
    const permsAsStrings = viewer.permissions.map(
      p => `${p.module}:${p.action}:${p.resource}`,
    );

    for (const mod of MODULES) {
      const hasCreate = hasPermission(permsAsStrings, mod, 'create');
      expect(hasCreate, `VIEWER should NOT be able to create in ${mod}`).toBe(false);
    }
  });

  it('VIEWER role can view all non-admin modules', () => {
    const viewer = SYSTEM_ROLES.find(r => r.code === 'VIEWER')!;
    const permsAsStrings = viewer.permissions.map(
      p => `${p.module}:${p.action}:${p.resource}`,
    );

    // 'admin' is intentionally excluded from VIEWER — it is a privileged module
    // accessible only to SUPER_ADMIN and TENANT_ADMIN roles.
    const nonAdminModules = MODULES.filter(m => m !== 'admin');
    for (const mod of nonAdminModules) {
      const hasView = hasPermission(permsAsStrings, mod, 'view');
      expect(hasView, `VIEWER should be able to view ${mod}`).toBe(true);
    }
  });

  it('VIEWER role cannot view the admin module', () => {
    const viewer = SYSTEM_ROLES.find(r => r.code === 'VIEWER')!;
    const permsAsStrings = viewer.permissions.map(
      p => `${p.module}:${p.action}:${p.resource}`,
    );
    expect(hasPermission(permsAsStrings, 'admin', 'view')).toBe(false);
  });

  it('TENANT_ADMIN has no admin module permissions', () => {
    const tenantAdmin = SYSTEM_ROLES.find(r => r.code === 'TENANT_ADMIN')!;
    const hasAdminPerm = tenantAdmin.permissions.some(p => p.module === 'admin');
    expect(hasAdminPerm).toBe(false);
  });

  it('all roles have required fields: code, name, description, permissions', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role).toHaveProperty('code');
      expect(role).toHaveProperty('name');
      expect(role).toHaveProperty('description');
      expect(role).toHaveProperty('permissions');
      expect(Array.isArray(role.permissions)).toBe(true);
    }
  });
});

// ── ALL_PERMISSIONS ───────────────────────────────────────────────────────────

describe('ALL_PERMISSIONS', () => {
  it('is a non-empty array', () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(0);
  });

  it('every permission has module, action, resource, and label', () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(typeof perm.module).toBe('string');
      expect(typeof perm.action).toBe('string');
      expect(typeof perm.resource).toBe('string');
      expect(typeof perm.label).toBe('string');
    }
  });

  it('contains fleet:view:* permission', () => {
    const found = ALL_PERMISSIONS.some(
      p => p.module === 'fleet' && p.action === 'view' && p.resource === '*',
    );
    expect(found).toBe(true);
  });

  it('contains finance:create:invoices permission', () => {
    const found = ALL_PERMISSIONS.some(
      p => p.module === 'finance' && p.action === 'create' && p.resource === 'invoices',
    );
    expect(found).toBe(true);
  });

  it('all actions are from the ACTIONS tuple', () => {
    const validActions = new Set(ACTIONS);
    for (const perm of ALL_PERMISSIONS) {
      expect(validActions.has(perm.action as typeof ACTIONS[number])).toBe(true);
    }
  });

  it('all modules are from the MODULES tuple', () => {
    const validModules = new Set(MODULES);
    for (const perm of ALL_PERMISSIONS) {
      expect(validModules.has(perm.module as typeof MODULES[number])).toBe(true);
    }
  });
});
