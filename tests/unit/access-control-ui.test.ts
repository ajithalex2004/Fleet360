/**
 * tests/unit/access-control-ui.test.ts
 *
 * A Transport Operator in EXL saw the whole platform: the sidebar listed
 * every module, module pages checked only the tenant's modules, and role
 * permissions were only logged (AUTHZ_MODE defaulted to report).
 */
import { describe, it, expect } from 'vitest';
import { canOpenModule, holdsAnyPermissionIn } from '@/lib/nav/module-visibility';
import { systemRolePermissions } from '@/lib/authz/session-permissions';
import { authzMode, decide } from '@/lib/authz/policy';
import { CATALOGUE_VERSION, decodePermissionClaim, encodePermissionClaim } from '@/lib/authz/permission-claim';
import { ALL_PERMISSIONS, MODULES } from '@/lib/permissions';
import { MODULES as REGISTRY } from '@/lib/modules';

const EXL_MODULES = ['rental', 'leasing', 'bus-ops', 'school-bus', 'fleet', 'dispatch', 'driver-mgmt', 'finance', 'admin', 'platform'];
const operator = { roleCode: 'TRANSPORT_OPERATOR', enabledModules: EXL_MODULES, permissions: systemRolePermissions('TRANSPORT_OPERATOR') };

describe('module visibility', () => {
  it('shows a Transport Operator only the transport modules their tenant has', () => {
    for (const m of ['bus-ops', 'school-bus', 'fleet', 'dispatch', 'driver-mgmt', 'locations']) {
      expect(canOpenModule(m, operator), m).toBe(true);
    }
    for (const m of ['rental', 'leasing', 'finance', 'admin', 'exchange', 'ai-platform', 'reports']) {
      expect(canOpenModule(m, operator), m).toBe(false);
    }
  });

  it('hides modules the tenant does not have, even from a Tenant Administrator', () => {
    const admin = { roleCode: 'TENANT_ADMIN', enabledModules: EXL_MODULES, permissions: systemRolePermissions('TENANT_ADMIN') };
    expect(canOpenModule('rental', admin)).toBe(true);
    expect(canOpenModule('admin', admin)).toBe(true);
    expect(canOpenModule('sustainability', admin)).toBe(false);
  });

  it('shows a Super Administrator everything', () => {
    const sa = { roleCode: 'SUPER_ADMIN', enabledModules: [], permissions: [] };
    expect(canOpenModule('sustainability', sa) && canOpenModule('admin', sa)).toBe(true);
  });

  it('counts any permission in a module, including resource-scoped ones', () => {
    expect(holdsAnyPermissionIn(['leasing:view:receivables'], 'leasing')).toBe(true);
    expect(holdsAnyPermissionIn(['leasing:view:receivables'], 'rental')).toBe(false);
  });
});

describe('permission catalogue', () => {
  it('covers every registry module', () => {
    for (const m of REGISTRY) expect(MODULES as readonly string[], m.key).toContain(m.key);
    for (const m of ['customer', 'mobile-apps', 'ai-platform', 'vendors']) {
      expect(ALL_PERMISSIONS.some(p => p.module === m && p.action === 'view'), m).toBe(true);
    }
    expect(systemRolePermissions('TENANT_ADMIN')).toContain('vendors:view:*');
  });

  it('still decodes a session claim signed before modules were appended', () => {
    // 83f16c6e: the 224-permission catalogue before 2026-10-07.
    const current = encodePermissionClaim(['fleet:view:*', 'vendors:view:*']);
    expect(current.v).toBe(CATALOGUE_VERSION);
    const old = { ...current, v: '83f16c6e' };
    expect(decodePermissionClaim(old)).toEqual(['fleet:view:*']);
    expect(decodePermissionClaim({ ...current, v: 'deadbeef' })).toBeNull();
  });
});

describe('server access', () => {
  it('enforces role permissions by default', () => {
    expect(authzMode(undefined)).toBe('enforce');
    const d = decide({ pathname: '/api/rental/bookings', method: 'GET' },
      { role: 'TRANSPORT_OPERATOR', tenantId: 't', permissions: systemRolePermissions('TRANSPORT_OPERATOR') });
    expect(d).toMatchObject({ allow: false, reason: 'missing-permission' });
  });
});
