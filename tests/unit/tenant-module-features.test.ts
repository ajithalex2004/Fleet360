/**
 * tests/unit/tenant-module-features.test.ts
 *
 * Tenant module access and the module → feature flag catalog.
 *
 * The Create Tenant modal used to offer 12 of the registry's modules, so new
 * tenants were created without the always-on modules (Dispatch, Bookings,
 * Customers, Assets …) and without the 'admin' key that gates /admin, and
 * ModuleGuard then walled those screens off. Feature flags had no mapping to
 * modules at all.
 */
import { describe, it, expect } from 'vitest';
import { MODULES, SYSTEM_MODULE_KEYS, normalizeTenantModules } from '@/lib/modules';
import {
  MODULE_FEATURES,
  FEATURES_BY_MODULE,
  defaultFeatureFlags,
  parseFeatureFlags,
  activeFeatureKeys,
} from '@/lib/module-features';
import { ALL_MODULE_KEYS } from '@/components/ModuleFeaturePicker';

describe('module picker coverage', () => {
  it('shows every registry module exactly once', () => {
    expect([...ALL_MODULE_KEYS].sort()).toEqual(MODULES.map((m) => m.key).sort());
    expect(new Set(ALL_MODULE_KEYS).size).toBe(ALL_MODULE_KEYS.length);
  });
});

describe('module → feature flag catalog', () => {
  it('maps every flag to a registry module', () => {
    const keys = new Set(MODULES.map((m) => m.key));
    for (const d of MODULE_FEATURES) expect(keys.has(d.module), d.key).toBe(true);
  });

  it('has unique flag keys', () => {
    const keys = MODULE_FEATURES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers at least one flag for every module', () => {
    for (const m of MODULES) expect(FEATURES_BY_MODULE[m.key].length, m.key).toBeGreaterThan(0);
  });

  it('keeps the dispatch toggles in tenant_settings, where the dispatch engine reads them', () => {
    const settings = Object.fromEntries(
      MODULE_FEATURES.filter((d) => d.settingsField).map((d) => [d.key, d.settingsField]),
    );
    expect(settings).toEqual({
      'dispatch.trip-merging': 'tripMergingEnabled',
      'dispatch.auto-merge': 'autoMergeEnabled',
      'dispatch.auto-dispatch': 'autoDispatchEnabled',
      'dispatch.route-optimization': 'routeOptimizationEnabled',
    });
  });

  it('only counts a flag as active while its module is enabled', () => {
    const flags = { ...defaultFeatureFlags(), 'rental.dynamic-pricing': true };
    expect(activeFeatureKeys(['rental'], flags)).toContain('rental.dynamic-pricing');
    expect(activeFeatureKeys(['fleet'], flags)).not.toContain('rental.dynamic-pricing');
  });
});

describe('parseFeatureFlags', () => {
  it('accepts known flags with boolean values', () => {
    expect(parseFeatureFlags({ 'fleet.traffic-fines': false })).toEqual({
      ok: true, flags: { 'fleet.traffic-fines': false },
    });
    expect(parseFeatureFlags(undefined)).toEqual({ ok: true, flags: {} });
  });

  it('rejects unknown keys, non-boolean values and non-objects', () => {
    expect(parseFeatureFlags({ 'fleet.nope': true }).ok).toBe(false);
    expect(parseFeatureFlags({ 'fleet.traffic-fines': 'yes' }).ok).toBe(false);
    expect(parseFeatureFlags(['fleet.traffic-fines']).ok).toBe(false);
  });
});

describe('normalizeTenantModules', () => {
  it('adds the always-on modules and the system keys', () => {
    const r = normalizeTenantModules(['rental']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of SYSTEM_MODULE_KEYS) expect(r.modules).toContain(k);
    for (const m of MODULES.filter((m) => m.subscription === 'always-on')) expect(r.modules).toContain(m.key);
    expect(r.modules).toContain('rental');
    expect(r.modules).not.toContain('leasing');
  });

  it('resolves legacy aliases and keeps system keys sent back by the client', () => {
    const r = normalizeTenantModules(['rac', 'bus_ops', 'admin', 'platform']);
    expect(r.ok && r.modules).toEqual(expect.arrayContaining(['rental', 'bus-ops', 'admin', 'platform']));
    expect(r.ok && r.modules.filter((m) => m === 'admin')).toHaveLength(1);
  });

  it('rejects unknown modules', () => {
    expect(normalizeTenantModules(['rental', 'teleportation'])).toEqual({ ok: false, error: 'Unknown module: teleportation' });
    expect(normalizeTenantModules([42]).ok).toBe(false);
  });
});

describe('ModuleFeaturePicker rendering', () => {
  it('renders every module, the flag counts and the active-configuration summary', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ModuleFeaturePicker, TenantModuleFeatureSummary } = await import('@/components/ModuleFeaturePicker');
    const flags = defaultFeatureFlags();
    const picker = renderToStaticMarkup(React.createElement(ModuleFeaturePicker, {
      enabledModules: ['rental'], featureFlags: flags, onModulesChange: () => {}, onFlagsChange: () => {},
    }));
    for (const m of MODULES) expect(picker).toContain(m.name.replace('&', '&amp;'));
    const enabledCount = 1 + MODULES.filter((m) => m.subscription === 'always-on').length;
    expect(picker).toContain(`${enabledCount} of ${MODULES.length} modules enabled`);
    expect(picker).toContain('>Default<'); // always-on modules carry the "Default" policy badge

    const summary = renderToStaticMarkup(React.createElement(TenantModuleFeatureSummary, {
      enabledModules: ['rental'], featureFlags: { ...flags, 'rental.dynamic-pricing': true },
    }));
    expect(summary).toContain('Rent-a-Car');
    expect(summary).toContain('Dynamic Pricing');
    expect(summary).not.toContain('Vehicle Leasing');
  });
});
