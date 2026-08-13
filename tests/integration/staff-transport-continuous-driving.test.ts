/**
 * tests/integration/staff-transport-continuous-driving.test.ts
 *
 * End-to-end test for the driver-app continuous-driving CBA endpoint.
 *
 * Exercises:
 *   - 401 when unauthenticated
 *   - Platform default (4.5h) when no CBA is configured
 *   - CBA-configured value (e.g. 3h for a stricter tenant)
 *   - Enforcement respected (a rule with enforced=false is ignored,
 *     platform default kicks in)
 *
 * Run: npx vitest run tests/integration/staff-transport-continuous-driving.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';
import { DEFAULT_CBA_RULES, type CbaRules } from '@/lib/cba/types';

let seed: SeedResult | undefined;
let createdRuleSetId: string | null = null;

const prisma = new PrismaClient();

/** Platform default for the continuous-driving limit (hours). */
const PLATFORM_DEFAULT_HOURS =
  DEFAULT_CBA_RULES.rules.find((r) => r.category === 'MAX_DRIVING_HOURS_CONTINUOUS')?.value
  ?? 4.5;

beforeAll(async () => {
  if (!(await isServerRunning())) {
    throw new Error('dev server must be running on :3000 — start with `npm run dev`');
  }
  seed = await seedTestTenantFull();
});

beforeEach(async () => {
  // Clean slate: delete any default rule set the previous test left
  // behind. We use ONE rule set and update it in place, because the
  // partial unique index `idx_cba_default_per_tenant` only allows
  // one default per tenant.
  if (createdRuleSetId) {
    await prisma.cbaRuleSet.delete({ where: { id: createdRuleSetId } }).catch(() => undefined);
    createdRuleSetId = null;
  }
  await prisma.cbaRuleSet.deleteMany({
    where: { tenantId: seed!.tenant.id, isDefault: true },
  });
});

afterAll(async () => {
  if (createdRuleSetId) {
    await prisma.cbaRuleSet.delete({ where: { id: createdRuleSetId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

/** Helper — create (or update) the tenant's default CBA rule set. */
async function setDefaultRuleSet(name: string, rules: CbaRules) {
  // Delete any existing default first (the partial unique index
  // would reject a second one in the same tenant).
  await prisma.cbaRuleSet.deleteMany({
    where: { tenantId: seed!.tenant.id, isDefault: true },
  });
  const created = await prisma.cbaRuleSet.create({
    data: {
      tenantId: seed!.tenant.id,
      name,
      jurisdiction: 'AE',
      isDefault: true,
      isSystem: false,
      schemaVersion: 1,
      rulesJson: rules as unknown as object,
    },
  });
  createdRuleSetId = created.id;
  return created;
}

async function clearDefaultRuleSet() {
  await prisma.cbaRuleSet.deleteMany({
    where: { tenantId: seed!.tenant.id, isDefault: true },
  });
  createdRuleSetId = null;
}

describe('Driver CBA — continuous-driving limit', () => {
  it('returns 401 when unauthenticated', async () => {
    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit');
    expect(r.status).toBe(401);
  });

  it('returns the platform default (4.5h) when no CBA is configured', async () => {
    await clearDefaultRuleSet();
    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.limitHours).toBe(PLATFORM_DEFAULT_HOURS);
    expect(body.limitMinutes).toBe(PLATFORM_DEFAULT_HOURS * 60);
    expect(body.limitMs).toBe(PLATFORM_DEFAULT_HOURS * 60 * 60 * 1000);
    expect(body.source).toBe('PLATFORM_DEFAULT');
    expect(body.rule).toBeNull();
  });

  it('returns the CBA-configured value when a default rule-set is present', async () => {
    // Build a custom CBA with MAX_DRIVING_HOURS_CONTINUOUS = 3h
    const custom: CbaRules = {
      schemaVersion: 1,
      rules: [
        {
          id: 'r-custom-driving',
          name: 'Max driving hours continuous',
          category: 'MAX_DRIVING_HOURS_CONTINUOUS',
          value: 3,
          unit: 'HOURS',
          enforced: true,
        },
      ],
    };
    await setDefaultRuleSet('Stricter CBA (3h limit)', custom);

    // Now the endpoint should return 3h
    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.limitHours).toBe(3);
    expect(body.limitMinutes).toBe(180);
    expect(body.limitMs).toBe(3 * 60 * 60 * 1000);
    expect(body.source).toBe('CBA');
    expect(body.rule).toEqual({
      id: 'r-custom-driving',
      name: 'Max driving hours continuous',
      value: 3,
      unit: 'HOURS',
    });
    expect(body.jurisdiction).toBe('AE');
    expect(body.fetchedAt).toBeTruthy();
    // Verify the ISO timestamp is recent
    const fetchedAt = new Date(body.fetchedAt).getTime();
    expect(Date.now() - fetchedAt).toBeLessThan(60_000);
  });

  it('falls back to platform default when the rule is marked enforced=false', async () => {
    const custom: CbaRules = {
      schemaVersion: 1,
      rules: [
        {
          id: 'r-soft-driving',
          name: 'Advisory driving limit (not enforced)',
          category: 'MAX_DRIVING_HOURS_CONTINUOUS',
          value: 2,
          unit: 'HOURS',
          enforced: false, // advisory
        },
      ],
    };
    await setDefaultRuleSet('Advisory-only CBA', custom);

    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    // enforced=false → ignored → platform default
    expect(body.limitHours).toBe(PLATFORM_DEFAULT_HOURS);
    expect(body.source).toBe('PLATFORM_DEFAULT');
  });

  it('rejects an invalid value (≤0) and falls back to platform default', async () => {
    const custom: CbaRules = {
      schemaVersion: 1,
      rules: [
        {
          id: 'r-bad-driving',
          name: 'Bogus driving limit',
          category: 'MAX_DRIVING_HOURS_CONTINUOUS',
          value: 0,
          unit: 'HOURS',
          enforced: true,
        },
      ],
    };
    await setDefaultRuleSet('Bogus CBA', custom);

    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    // value=0 is invalid → fall back to platform default
    expect(body.limitHours).toBe(PLATFORM_DEFAULT_HOURS);
    expect(body.source).toBe('PLATFORM_DEFAULT');
  });

  it('uses the default flag — a non-default rule-set is ignored', async () => {
    // No default rule set at all (beforeEach already cleaned up)
    // Insert a non-default rule set with a 5h limit and verify the
    // endpoint still returns the platform default (because only
    // is_default rules are consulted).
    const custom: CbaRules = {
      schemaVersion: 1,
      rules: [
        {
          id: 'r-non-default',
          name: 'Max driving hours (5h, non-default)',
          category: 'MAX_DRIVING_HOURS_CONTINUOUS',
          value: 5,
          unit: 'HOURS',
          enforced: true,
        },
      ],
    };
    const created = await prisma.cbaRuleSet.create({
      data: {
        tenantId: seed!.tenant.id,
        name: 'Non-default rule set (should be ignored)',
        jurisdiction: 'AE',
        isDefault: false, // <-- not the default
        isSystem: false,
        schemaVersion: 1,
        rulesJson: custom as unknown as object,
      },
    });
    createdRuleSetId = created.id;

    const r = await makeRequest('GET', '/api/driver-app/cba/continuous-driving-limit', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.limitHours).toBe(PLATFORM_DEFAULT_HOURS);
    expect(body.source).toBe('PLATFORM_DEFAULT');
  });
});
