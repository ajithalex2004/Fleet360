/**
 * tests/unit/module-policies.test.ts
 *
 * Module availability policies (Admin > Module Policies): each module is
 * Default (every tenant), Per tenant (switched per tenant) or Tier-gated
 * (from a plan upward), and a tenant's effective module list follows them.
 * AI Platform and Vendors & Partners are registry modules now; before, no
 * tenant could have them, so only platform admins could open those areas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ saved: null as string | null, writes: [] as unknown[][] }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => (sql.includes('platform_settings') && db.saved !== null ? [{ value: db.saved }] : []),
    $executeRawUnsafe: async (_sql: string, ...args: unknown[]) => { db.writes.push(args); db.saved = String(args[1]); return 1; },
  },
}));
vi.mock('@/lib/plans', () => ({
  listPlans: async () => [
    { code: 'TRIAL', name: 'Trial', sortOrder: 0, isActive: true },
    { code: 'STANDARD', name: 'Standard', sortOrder: 1, isActive: true },
    { code: 'PROFESSIONAL', name: 'Professional', sortOrder: 2, isActive: true },
    { code: 'ENTERPRISE', name: 'Enterprise', sortOrder: 3, isActive: true },
  ],
}));

import { MODULES, MODULE_BY_KEY } from '@/lib/modules';
import { FEATURES_BY_MODULE } from '@/lib/module-features';
import {
  effectiveTenantModules, planMeets, policyLabel, resolvePolicies,
} from '@/lib/module-policy-rules';
import { getModulePolicies, saveModulePolicies, tenantModulesFor } from '@/lib/module-policies';

beforeEach(() => { db.saved = null; db.writes = []; });

describe('registry', () => {
  it('has AI Platform and Vendors & Partners as modules with feature flags', () => {
    expect(MODULE_BY_KEY['ai-platform'].href).toBe('/ai-platform');
    expect(MODULE_BY_KEY['vendors'].href).toBe('/vendors');
    expect(FEATURES_BY_MODULE['ai-platform'].length).toBeGreaterThan(0);
    expect(FEATURES_BY_MODULE['vendors'].length).toBeGreaterThan(0);
  });
});

describe('resolvePolicies', () => {
  it('keeps today\'s behaviour without saved policies', () => {
    const p = resolvePolicies(null);
    for (const m of MODULES) {
      expect(p[m.key].availability, m.key).toBe(m.subscription === 'always-on' ? 'ALWAYS_ON' : 'PER_TENANT');
    }
    expect(p['sustainability'].availability).toBe('PER_TENANT');
  });

  it('applies saved policies and ignores malformed or unknown entries', () => {
    const p = resolvePolicies({
      'ai-platform': { availability: 'TIER', minPlan: 'PROFESSIONAL' },
      'fleet': { availability: 'ALWAYS_ON' },
      'vendors': { availability: 'TIER' },            // no plan → default
      'teleport': { availability: 'ALWAYS_ON' },       // unknown → ignored
    });
    expect(p['ai-platform']).toEqual({ availability: 'TIER', minPlan: 'PROFESSIONAL' });
    expect(p['fleet']).toEqual({ availability: 'ALWAYS_ON' });
    expect(p['vendors']).toEqual({ availability: 'PER_TENANT' });
    expect('teleport' in p).toBe(false);
  });
});

describe('effectiveTenantModules', () => {
  const policies = resolvePolicies({
    'ai-platform': { availability: 'TIER', minPlan: 'PROFESSIONAL' },
    'fleet': { availability: 'ALWAYS_ON' },
  });

  it('adds defaults and system keys, keeps per-tenant switches, and gates by plan', () => {
    const std = effectiveTenantModules(['rac', 'leasing'], 'STANDARD', policies);
    expect(std).toEqual(expect.arrayContaining(['admin', 'platform', 'fleet', 'dispatch', 'rental', 'leasing']));
    expect(std).not.toContain('ai-platform');
    expect(std).not.toContain('vendors');
    expect(effectiveTenantModules([], 'PROFESSIONAL', policies)).toContain('ai-platform');
    expect(effectiveTenantModules([], 'ENTERPRISE', policies)).toContain('ai-platform');
  });

  it('does not let a stored switch override a tier gate', () => {
    expect(effectiveTenantModules(['ai-platform'], 'TRIAL', policies)).not.toContain('ai-platform');
  });

  it('ranks plans by sort order when given, else by the canonical order', () => {
    expect(planMeets('STANDARD', 'PROFESSIONAL')).toBe(false);
    expect(planMeets('GOLD', 'PROFESSIONAL', { GOLD: 5, PROFESSIONAL: 2 })).toBe(true);
    expect(planMeets(undefined, 'STANDARD')).toBe(false);
    expect(policyLabel({ availability: 'TIER', minPlan: 'PROFESSIONAL' })).toBe('Professional+');
  });
});

describe('module policy storage', () => {
  it('saves valid policies and serves them to sessions', async () => {
    const r = await saveModulePolicies({ 'ai-platform': { availability: 'TIER', minPlan: 'ENTERPRISE' }, vendors: { availability: 'ALWAYS_ON' } });
    expect(r.ok).toBe(true);
    expect(JSON.parse(db.saved!)['ai-platform']).toEqual({ availability: 'TIER', minPlan: 'ENTERPRISE' });
    expect((await getModulePolicies())['vendors'].availability).toBe('ALWAYS_ON');
    const pro = await tenantModulesFor(['rental'], 'PROFESSIONAL');
    expect(pro).toContain('vendors');
    expect(pro).not.toContain('ai-platform');
  });

  it('rejects unknown modules, bad availability and tier gates without an active plan', async () => {
    expect((await saveModulePolicies({ teleport: { availability: 'ALWAYS_ON' } })).ok).toBe(false);
    expect((await saveModulePolicies({ fleet: { availability: 'SOMETIMES' } })).ok).toBe(false);
    expect((await saveModulePolicies({ fleet: { availability: 'TIER', minPlan: 'PLATINUM' } })).ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });
});
