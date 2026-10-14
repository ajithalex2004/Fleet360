/**
 * tests/unit/access-mask.test.ts
 *
 * Module Access on a user's membership narrows what their role grants in
 * that company and never widens it (src/lib/authz/access-mask.ts). Before,
 * the Module Access dialog saved settings nothing read: a Transport Manager
 * given "Logistics: manager" there still could not open Logistics.
 */
import { describe, it, expect } from 'vitest';
import {
  applyAccessMask, parseAccessMask, roleAccessByModule, storedAccessMask, accessLevelFor,
} from '@/lib/authz/access-mask';

const FLEET_MANAGER = [
  'fleet:view:*', 'fleet:create:*', 'fleet:edit:*', 'fleet:delete:*', 'fleet:approve:*', 'fleet:export:*',
  'maintenance:view:*', 'maintenance:create:*',
  'reports:view:*',
];

describe('applyAccessMask', () => {
  it('leaves the role as is without a mask', () => {
    expect(applyAccessMask(FLEET_MANAGER, null)).toEqual(FLEET_MANAGER);
  });

  it('narrows a module to view only: view and export stay, everything else goes', () => {
    const out = applyAccessMask(FLEET_MANAGER, { fleet: ['view'] });
    expect(out.filter((p) => p.startsWith('fleet:'))).toEqual(['fleet:view:*', 'fleet:export:*']);
  });

  it('maps approve to edit', () => {
    expect(applyAccessMask(FLEET_MANAGER, { fleet: ['view', 'edit'] })).toContain('fleet:approve:*');
    expect(applyAccessMask(FLEET_MANAGER, { fleet: ['view', 'create'] })).not.toContain('fleet:approve:*');
  });

  it('removes a module given no access', () => {
    expect(applyAccessMask(FLEET_MANAGER, { maintenance: [] }).some((p) => p.startsWith('maintenance:'))).toBe(false);
  });

  it('never widens: access the role lacks is not granted', () => {
    const out = applyAccessMask(FLEET_MANAGER, { logistics: ['view', 'create', 'edit', 'delete'] });
    expect(out.some((p) => p.startsWith('logistics:'))).toBe(false);
    expect(out).toEqual(FLEET_MANAGER);
  });

  it('leaves modules the mask does not name to the role', () => {
    expect(applyAccessMask(FLEET_MANAGER, { fleet: ['view'] })).toContain('reports:view:*');
  });

  it('does not narrow platform administrators', () => {
    expect(applyAccessMask(['*:*:*', 'fleet:edit:*'], { fleet: [] }, 'SUPER_ADMIN')).toEqual(['*:*:*', 'fleet:edit:*']);
  });

  it('keeps a wildcard action only when every level is allowed', () => {
    expect(applyAccessMask(['bus-ops:*:*'], { 'bus-ops': ['view'] })).toEqual([]);
    expect(applyAccessMask(['bus-ops:*:*'], { 'bus-ops': ['view', 'create', 'edit', 'delete'] })).toEqual(['bus-ops:*:*']);
  });

  it('resolves legacy module names in permissions', () => {
    expect(applyAccessMask(['rac:view:*', 'rac:edit:*'], { rental: ['view'] })).toEqual(['rac:view:*']);
  });
});

describe('parseAccessMask', () => {
  it('accepts null as "no mask"', () => {
    expect(parseAccessMask(null)).toBeNull();
    expect(parseAccessMask(undefined)).toBeNull();
  });

  it('adds view when create, edit or delete is chosen, and orders the levels', () => {
    expect(parseAccessMask({ fleet: ['delete', 'create'] })).toEqual({ fleet: ['view', 'create', 'delete'] });
    expect(parseAccessMask({ fleet: [] })).toEqual({ fleet: [] });
  });

  it('rejects unknown modules, unknown levels and the wrong shape', () => {
    expect(() => parseAccessMask({ nosuch: ['view'] })).toThrow('Unknown module');
    expect(() => parseAccessMask({ fleet: ['manager'] })).toThrow('Unknown access level');
    expect(() => parseAccessMask({ fleet: 'view' })).toThrow();
    expect(() => parseAccessMask(['fleet'])).toThrow();
  });

  it('stores legacy module names under the canonical key', () => {
    expect(parseAccessMask({ rac: ['view'] })).toEqual({ rental: ['view'] });
  });
});

describe('storedAccessMask', () => {
  it('fails closed on a malformed stored value: the modules it names get no access', () => {
    expect(storedAccessMask({ fleet: { role: 'manager' } })).toEqual({ fleet: [] });
    expect(storedAccessMask('garbage')).toBeNull();
  });
});

describe('roleAccessByModule', () => {
  it('summarises what a role grants per module', () => {
    expect(roleAccessByModule(FLEET_MANAGER)).toMatchObject({
      fleet: ['view', 'create', 'edit', 'delete'],
      maintenance: ['view', 'create'],
      reports: ['view'],
    });
  });

  it('accessLevelFor covers the catalogue actions', () => {
    expect(['view', 'export', 'create', 'edit', 'approve', 'admin', 'delete'].map(accessLevelFor))
      .toEqual(['view', 'view', 'create', 'edit', 'edit', 'edit', 'delete']);
  });
});
