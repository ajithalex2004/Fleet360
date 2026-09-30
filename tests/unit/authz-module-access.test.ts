/**
 * tests/unit/authz-module-access.test.ts
 *
 * loadModuleAccess (src/lib/authz/module-access.ts): the per-module check
 * for shared endpoints whose module is only in the request (branch staff,
 * the shared document upload, workflow triggers).
 *
 * Covered:
 *  - enforce: a role with the module's permission passes; one without gets 403
 *  - "any of": a RAC role passes a check for ['leasing', 'rental']
 *  - report: a missing permission is logged but the request continues
 *  - off, and SUPER_ADMIN: no check, no permission lookup
 *  - branch-staff module values map to leasing / rental / either
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({ perms: [] as string[], lookups: 0 }));
vi.mock('@/lib/authz/session-permissions', async (orig) => ({
  ...(await orig<typeof import('@/lib/authz/session-permissions')>()),
  sessionPermissionsFor: async () => { state.lookups += 1; return state.perms; },
}));

import { loadModuleAccess, branchStaffModules } from '@/lib/authz/module-access';
import { systemRolePermissions } from '@/lib/authz/session-permissions';

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const headers = (role: string) => new Headers({ 'x-user-id': 'u1', 'x-user-role': role });

beforeEach(() => { state.perms = []; state.lookups = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('loadModuleAccess', () => {
  it('enforce: allows a role holding the module permission and refuses one without', async () => {
    vi.stubEnv('AUTHZ_MODE', 'enforce');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.perms = ['leasing:view:*', 'leasing:edit:contracts'];
    const check = await loadModuleAccess(headers('LEASING_OPERATOR'), TENANT);
    expect(check(['leasing'], 'view', '/x')).toBeNull();
    expect(check(['leasing'], 'edit', '/x')).toBeNull();
    const denied = check(['rental'], 'view', '/x');
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ reason: 'missing-permission', required: 'rental:view:*' });
  });

  it('passes when the caller holds any one of the modules', async () => {
    vi.stubEnv('AUTHZ_MODE', 'enforce');
    state.perms = ['rental:create:*'];
    const check = await loadModuleAccess(headers('RAC_OPERATOR'), TENANT);
    expect(check(['leasing', 'rental'], 'create', '/api/leasing/documents/upload')).toBeNull();
  });

  it('report: logs a would-deny and lets the request continue', async () => {
    vi.stubEnv('AUTHZ_MODE', 'report');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const check = await loadModuleAccess(headers('VIEWER'), TENANT);
    expect(check(['leasing'], 'delete', '/api/branch-staff')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ authz: 'would-deny', path: '/api/branch-staff' });
  });

  it('skips the check (and the lookup) when off, and for SUPER_ADMIN', async () => {
    vi.stubEnv('AUTHZ_MODE', 'off');
    expect((await loadModuleAccess(headers('VIEWER'), TENANT))(['finance'], 'delete', '/x')).toBeNull();
    vi.stubEnv('AUTHZ_MODE', 'enforce');
    expect((await loadModuleAccess(headers('SUPER_ADMIN'), TENANT))(['finance'], 'delete', '/x')).toBeNull();
    expect(state.lookups).toBe(0);
  });
});

describe('branchStaffModules', () => {
  it('maps LEASING, RENTAL and anything else (BOTH, missing)', () => {
    expect(branchStaffModules('LEASING')).toEqual(['leasing']);
    expect(branchStaffModules('rental')).toEqual(['rental']);
    expect(branchStaffModules('BOTH')).toEqual(['leasing', 'rental']);
    expect(branchStaffModules(undefined)).toEqual(['leasing', 'rental']);
  });
});

describe('built-in roles hold what their screens need', () => {
  it('grants the permissions added for enforce mode', () => {
    const has = (role: string, perm: string) => systemRolePermissions(role).includes(perm);
    expect(has('TENANT_ADMIN', 'finance:edit:*')).toBe(true);
    expect(has('FINANCE_MANAGER', 'finance:delete:*')).toBe(true);
    expect(has('TRANSPORT_MANAGER', 'school-bus:delete:*')).toBe(true);
    expect(has('TRANSPORT_OPERATOR', 'dispatch:create:*')).toBe(true);
    expect(has('TRANSPORT_OPERATOR', 'school-bus:delete:*')).toBe(false);
    expect(has('FLEET_MANAGER', 'assets:view:*')).toBe(true);
    expect(has('LEASING_OPERATOR', 'leasing:edit:renewals')).toBe(true);
    expect(has('LEASING_MANAGER', 'finance:edit:*')).toBe(false);
  });
});
