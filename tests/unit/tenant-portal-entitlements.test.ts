/**
 * Tenant-level Customer Portal provisioning (Field Services & Transport Services)
 * and Admin module enforcement across Customer Portal access & Transport catalogue.
 */
import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_PORTAL_FSM_FLAG,
  CUSTOMER_PORTAL_TRANSPORT_FLAG,
  FEATURE_BY_KEY,
  defaultFeatureFlags,
  parseFeatureFlags,
} from '@/lib/module-features';
import {
  computeTenantPortalEntitlements,
  isCategoryAllowedByTenantModules,
} from '@/lib/customer-portal/entitlement-rules';
import { resolveRequiredModule } from '@/lib/booking-portal/service-module-map';

describe('Admin Customer Portal feature flags', () => {
  it('registers Field Services and Transport Services portal flags under customer-mgmt (default enabled)', () => {
    expect(FEATURE_BY_KEY[CUSTOMER_PORTAL_FSM_FLAG]).toMatchObject({
      module: 'customer-mgmt',
      defaultEnabled: true,
    });
    expect(FEATURE_BY_KEY[CUSTOMER_PORTAL_TRANSPORT_FLAG]).toMatchObject({
      module: 'customer-mgmt',
      defaultEnabled: true,
    });
    const defaults = defaultFeatureFlags();
    expect(defaults[CUSTOMER_PORTAL_FSM_FLAG]).toBe(true);
    expect(defaults[CUSTOMER_PORTAL_TRANSPORT_FLAG]).toBe(true);
    expect(
      parseFeatureFlags({
        [CUSTOMER_PORTAL_FSM_FLAG]: true,
        [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false,
      }),
    ).toEqual({
      ok: true,
      flags: {
        [CUSTOMER_PORTAL_FSM_FLAG]: true,
        [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false,
      },
    });
  });
});

describe('computeTenantPortalEntitlements', () => {
  it('enables both portals when backing modules and Admin portal flags are on', () => {
    const ent = computeTenantPortalEntitlements({
      enabledModules: ['service-tickets', 'booking-portal', 'rental', 'logistics'],
      featureFlags: defaultFeatureFlags(),
    });
    expect(ent.enabledPortals).toEqual(['FSM', 'TRANSPORT']);
    expect(ent.portals.FSM).toEqual({ enabled: true, flagEnabled: true, moduleEnabled: true });
    expect(ent.portals.TRANSPORT).toEqual({ enabled: true, flagEnabled: true, moduleEnabled: true });
  });

  it('supports Field Services Only and Transport Services Only via Admin portal toggles', () => {
    const fsmOnly = computeTenantPortalEntitlements({
      enabledModules: ['service-tickets', 'booking-portal', 'rental'],
      featureFlags: { [CUSTOMER_PORTAL_FSM_FLAG]: true, [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false },
    });
    expect(fsmOnly.enabledPortals).toEqual(['FSM']);
    expect(fsmOnly.portals.TRANSPORT).toEqual({ enabled: false, flagEnabled: false, moduleEnabled: true });

    const transportOnly = computeTenantPortalEntitlements({
      enabledModules: ['service-tickets', 'booking-portal', 'rental'],
      featureFlags: { [CUSTOMER_PORTAL_FSM_FLAG]: false, [CUSTOMER_PORTAL_TRANSPORT_FLAG]: true },
    });
    expect(transportOnly.enabledPortals).toEqual(['TRANSPORT']);
    expect(transportOnly.portals.FSM).toEqual({ enabled: false, flagEnabled: false, moduleEnabled: true });

    const neither = computeTenantPortalEntitlements({
      enabledModules: ['service-tickets', 'booking-portal', 'rental'],
      featureFlags: { [CUSTOMER_PORTAL_FSM_FLAG]: false, [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false },
    });
    expect(neither.enabledPortals).toEqual([]);
  });

  it('blocks Field Services when service-tickets module is disabled in Admin', () => {
    const ent = computeTenantPortalEntitlements({
      enabledModules: ['booking-portal', 'rental', 'customer-mgmt'],
      featureFlags: defaultFeatureFlags(),
    });
    expect(ent.enabledPortals).toEqual(['TRANSPORT']);
    expect(ent.portals.FSM).toEqual({ enabled: false, flagEnabled: true, moduleEnabled: false });
  });

  it('blocks Transport Services when no transport/booking modules are enabled in Admin', () => {
    const ent = computeTenantPortalEntitlements({
      enabledModules: ['service-tickets', 'fleet', 'customer-mgmt'],
      featureFlags: defaultFeatureFlags(),
    });
    expect(ent.enabledPortals).toEqual(['FSM']);
    expect(ent.portals.TRANSPORT).toEqual({ enabled: false, flagEnabled: true, moduleEnabled: false });
  });

  it('resolves legacy module aliases and stays backward compatible when no tenant_modules rows exist', () => {
    const legacyAlias = computeTenantPortalEntitlements({
      enabledModules: ['rac', 'bus_ops'],
      featureFlags: defaultFeatureFlags(),
    });
    expect(legacyAlias.enabledModules).toEqual(expect.arrayContaining(['rental', 'bus-ops']));
    expect(legacyAlias.portals.TRANSPORT.enabled).toBe(true);

    const noModuleRows = computeTenantPortalEntitlements({
      enabledModules: [],
      featureFlags: { [CUSTOMER_PORTAL_FSM_FLAG]: true, [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false },
    });
    expect(noModuleRows.hasModuleRestrictions).toBe(false);
    expect(noModuleRows.enabledPortals).toEqual(['FSM']);
  });
});

describe('per-category Admin module gating for Transport catalogue', () => {
  it('allows only categories whose linked Admin module is enabled (plus All-Staff custom categories)', () => {
    const tenantModules = ['booking-portal', 'rental', 'leasing'];
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('RAC', null), tenantModules, true)).toBe(true);
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('LEASING', null), tenantModules, true)).toBe(true);
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('LOGISTICS', null), tenantModules, true)).toBe(false);
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('SCHOOL_BUS', null), tenantModules, true)).toBe(false);
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('VIP_CONCIERGE', ''), tenantModules, true)).toBe(true);
    expect(isCategoryAllowedByTenantModules(resolveRequiredModule('LOGISTICS', null), [], false)).toBe(true);
  });
});

describe('CustomerPortalsProvisioningCard SSR rendering', () => {
  it('renders both Field Services and Transport Services toggles with status badges', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { CustomerPortalsProvisioningCard } = await import('@/components/admin/CustomerPortalsProvisioningCard');
    const html = renderToStaticMarkup(
      React.createElement(CustomerPortalsProvisioningCard, {
        enabledModules: ['service-tickets', 'booking-portal', 'rental'],
        featureFlags: { ...defaultFeatureFlags(), [CUSTOMER_PORTAL_TRANSPORT_FLAG]: false },
        onModulesChange: () => {},
        onFlagsChange: () => {},
        allowOverrideAll: true,
      }),
    );
    expect(html).toContain('Field Services Portal (FSM)');
    expect(html).toContain('Transport Services Portal');
    expect(html).toContain('Active');
    expect(html).toContain('Disabled');
  });
});
