/**
 * Customer Portal catalogue: parsing of per-portal roles and Transport
 * categories sent by the onboarding screen (src/lib/customer-portal/catalog.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  parsePortalRoleMap, parseTransportCategories, TRANSPORT_CATEGORIES, isTransportCategory,
} from '@/lib/customer-portal/catalog';

describe('parsePortalRoleMap', () => {
  it('accepts roles per portal and null to remove a portal', () => {
    expect(parsePortalRoleMap({ FSM: 'ADMIN', TRANSPORT: null })).toEqual({ FSM: 'ADMIN', TRANSPORT: null });
    expect(parsePortalRoleMap({})).toEqual({});
  });

  it('rejects unknown portals, unknown roles and non-objects', () => {
    expect(parsePortalRoleMap({ RAC: 'ADMIN' })).toBeNull();
    expect(parsePortalRoleMap({ FSM: 'OWNER' })).toBeNull();
    expect(parsePortalRoleMap({ FSM: 'SHIPPER_ADMIN' })).toBeNull();
    expect(parsePortalRoleMap(['FSM'])).toBeNull();
    expect(parsePortalRoleMap('FSM')).toBeNull();
    expect(parsePortalRoleMap(null)).toBeNull();
  });
});

describe('parseTransportCategories', () => {
  it('keeps known categories in catalogue order without duplicates', () => {
    expect(parseTransportCategories(['LOGISTICS', 'RAC', 'RAC'])).toEqual(['RAC', 'LOGISTICS']);
    expect(parseTransportCategories([])).toEqual([]);
  });

  it('rejects unknown categories and non-arrays', () => {
    expect(parseTransportCategories(['RAC', 'SPACE'])).toBeNull();
    expect(parseTransportCategories('RAC')).toBeNull();
    expect(parseTransportCategories(undefined)).toBeNull();
  });

  it('lists the eight categories the database CHECK allows', () => {
    expect(TRANSPORT_CATEGORIES).toEqual([
      'RAC', 'LEASING', 'LIMOUSINE', 'STAFF_TRANSPORT', 'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS', 'RECOVERY',
    ]);
    expect(TRANSPORT_CATEGORIES.every(isTransportCategory)).toBe(true);
  });
});
