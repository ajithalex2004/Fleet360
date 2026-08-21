/**
 * Guards the bus-ops:admin:* permission rows that gate the Planning
 * Engine surfaces.
 *
 * CBA rule-sets and Headway rules shipped with no RBAC gate on either
 * the page or the API — any authenticated user in a tenant could read
 * and rewrite union pay rules, hours-of-service limits, and the
 * published timetable. These rows close that, and this file pins the
 * two properties that make the fix work:
 *
 *   1. The 'admin' action is NOT satisfied by the broad
 *      `bus-ops:view:*` / `bus-ops:*:*` wildcard grants. hasPermission()
 *      does a 3-tier match, so a same-action wildcard would silently
 *      defeat a resource-specific row. 'admin' has no wildcard row
 *      anywhere, which is the entire reason it was chosen over 'edit'.
 *      If someone later adds `bus-ops:admin:*` to a role, this fails.
 *
 *   2. The roles that are supposed to reach these screens actually do.
 *      Both TRANSPORT_* roles derive their permissions by filtering
 *      ALL_PERMISSIONS, so a new row is auto-granted — but the operator
 *      filter is an action whitelist that must include 'admin'.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  hasPermission,
  buildPermissionKey,
} from '@/lib/permissions';

/** Resources gated by requireBusOpsAdminAccess(). */
const ADMIN_RESOURCES = [
  'planning-core',
  'route-consolidation',
  'planning-constraints',
  'vehicle-resource-optimization',
  'cba-rules',
  'headway',
] as const;

/** Mirrors how require-admin-access.ts resolves a role to permission keys. */
function permsForRole(code: string): string[] {
  return (SYSTEM_ROLES.find(r => r.code === code)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
}

describe('bus-ops admin permission rows', () => {
  it.each(ADMIN_RESOURCES)('declares a bus-ops:admin row for %s', (resource) => {
    const row = ALL_PERMISSIONS.find(
      p => p.module === 'bus-ops' && p.action === 'admin' && p.resource === resource,
    );
    expect(row, `missing bus-ops:admin:${resource} in ALL_PERMISSIONS`).toBeDefined();
    expect(row?.label).toBeTruthy();
  });

  it('has no bus-ops:admin:* wildcard row', () => {
    // A wildcard row would make every admin resource grantable in one
    // shot and defeat the per-resource gating the guard relies on.
    const wildcard = ALL_PERMISSIONS.find(
      p => p.module === 'bus-ops' && p.action === 'admin' && p.resource === '*',
    );
    expect(wildcard).toBeUndefined();
  });
});

describe("'admin' action is not satisfied by broader bus-ops grants", () => {
  it.each(ADMIN_RESOURCES)('bus-ops:view:* does NOT grant admin on %s', (resource) => {
    expect(hasPermission(['bus-ops:view:*'], 'bus-ops', 'admin', resource)).toBe(false);
  });

  it.each(ADMIN_RESOURCES)('bus-ops:edit:* does NOT grant admin on %s', (resource) => {
    expect(hasPermission(['bus-ops:edit:*'], 'bus-ops', 'admin', resource)).toBe(false);
  });

  it('a resource-specific view grant does not leak into admin', () => {
    expect(hasPermission(['bus-ops:view:cba-rules'], 'bus-ops', 'admin', 'cba-rules')).toBe(false);
    expect(hasPermission(['bus-ops:view:headway'],   'bus-ops', 'admin', 'headway')).toBe(false);
  });

  it('the exact admin grant does work', () => {
    expect(hasPermission(['bus-ops:admin:cba-rules'], 'bus-ops', 'admin', 'cba-rules')).toBe(true);
    expect(hasPermission(['bus-ops:admin:headway'],   'bus-ops', 'admin', 'headway')).toBe(true);
  });

  it('admin on one resource does not grant admin on another', () => {
    expect(hasPermission(['bus-ops:admin:cba-rules'], 'bus-ops', 'admin', 'headway')).toBe(false);
    expect(hasPermission(['bus-ops:admin:headway'], 'bus-ops', 'admin', 'cba-rules')).toBe(false);
  });
});

describe('role coverage for the Planning Engine surfaces', () => {
  const ALLOWED = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TRANSPORT_MANAGER', 'TRANSPORT_OPERATOR'];
  // Roles with no business reason to rewrite union pay rules or the
  // published timetable.
  const DENIED = ['VIEWER', 'FLEET_MANAGER', 'FINANCE_MANAGER', 'LEASING_OPERATOR', 'RAC_OPERATOR'];

  for (const role of ALLOWED) {
    it.each(ADMIN_RESOURCES)(`${role} can reach %s`, (resource) => {
      expect(hasPermission(permsForRole(role), 'bus-ops', 'admin', resource)).toBe(true);
    });
  }

  for (const role of DENIED) {
    it(`${role} is denied every admin resource`, () => {
      const perms = permsForRole(role);
      for (const resource of ADMIN_RESOURCES) {
        expect(
          hasPermission(perms, 'bus-ops', 'admin', resource),
          `${role} unexpectedly has bus-ops:admin:${resource}`,
        ).toBe(false);
      }
    });
  }

  it('TRANSPORT_OPERATORs action whitelist still includes admin', () => {
    // Regression guard: the operator's permissions are built by filtering
    // on an action whitelist. Dropping 'admin' from it would silently
    // remove all six surfaces without any test failing elsewhere.
    const perms = permsForRole('TRANSPORT_OPERATOR');
    expect(perms.some(p => p.startsWith('bus-ops:admin:'))).toBe(true);
  });
});
