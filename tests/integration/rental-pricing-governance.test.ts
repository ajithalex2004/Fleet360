import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    'x-tenant-plan': seed.tenant.plan,
    'x-test-auth-bypass': 'fleet360-test-bypass',
    ...extra,
  };
}

describe('RAC pricing governance cleanup', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    await ensureRentalGovernance();
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
  }, 120_000);

  afterAll(async () => {
    await ensureRentalGovernance().catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM pricing_rules WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rate_events WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_ancillaries WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('scopes pricing rules and keeps pricing alias on the same hardened write path', async () => {
    if (!serverAvailable) return;

    const create = await makeRequest(
      'POST',
      '/api/rental/pricing',
      {
        name: 'Tenant A Economy Direct',
        vehicleCategory: 'ECONOMY',
        baseDailyRate: 110,
        priority: 10,
        isActive: true,
        channel: 'DIRECT',
      },
      routeHeaders(tenantA),
    );
    expect(create.status).toBe(201);
    const created = await create.json();

    const pricingBId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO pricing_rules (id, vehicle_category, base_daily_rate, currency, priority, is_active, created_at, updated_at)
       VALUES ($1,'SUV',220,'AED',5,TRUE,NOW(),NOW())`,
      pricingBId,
    );
    await attachTenantToEntity('pricing_rules', pricingBId, tenantB.tenant.id);

    const listA = await makeRequest('GET', '/api/rental/rates', undefined, routeHeaders(tenantA));
    expect(listA.status).toBe(200);
    const listABody = await listA.json();
    const idsA = (listABody.data as Array<{ id: string }>).map(row => row.id);
    expect(idsA).toContain(created.id);
    expect(idsA).not.toContain(pricingBId);

    const blockedRead = await makeRequest('GET', `/api/rental/pricing/${pricingBId}`, undefined, routeHeaders(tenantA));
    expect(blockedRead.status).toBe(404);

    const update = await makeRequest(
      'PATCH',
      `/api/rental/rates/${created.id}`,
      { baseDailyRate: 125, notes: 'Tenant A override' },
      routeHeaders(tenantA),
    );
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(Number(updated.baseDailyRate)).toBe(125);

    const blockedDelete = await makeRequest('DELETE', `/api/rental/rates/${created.id}`, undefined, routeHeaders(tenantB));
    expect(blockedDelete.status).toBe(404);

    const removed = await makeRequest('DELETE', `/api/rental/pricing/${created.id}`, undefined, routeHeaders(tenantA));
    expect(removed.status).toBe(200);
  }, 120_000);

  it('prevents cross-tenant overwrite of globally unique rate-event and ancillary business keys', async () => {
    if (!serverAvailable) return;

    const eventCode = `DSF-${Date.now()}`;
    const ancillaryCode = `GPS-${Date.now()}`;

    const eventA = await makeRequest(
      'POST',
      '/api/rental/rate-events',
      {
        eventCode,
        name: 'Dubai Shopping Festival',
        dateFrom: '2026-12-01T00:00:00.000Z',
        dateTo: '2026-12-31T23:59:59.000Z',
        multiplier: 1.2,
        isActive: true,
      },
      routeHeaders(tenantA),
    );
    expect(eventA.status).toBe(201);
    const eventBody = await eventA.json();

    const eventB = await makeRequest(
      'POST',
      '/api/rental/rate-events',
      {
        eventCode,
        name: 'Attempted overwrite',
        dateFrom: '2026-12-01T00:00:00.000Z',
        dateTo: '2026-12-31T23:59:59.000Z',
        multiplier: 1.5,
        isActive: true,
      },
      routeHeaders(tenantB),
    );
    expect(eventB.status).toBe(409);

    const ancA = await makeRequest(
      'POST',
      '/api/rental/ancillaries',
      {
        code: ancillaryCode,
        nameEn: 'GPS Unit',
        pricingType: 'PER_DAY',
        unitPrice: 15,
        isActive: true,
      },
      routeHeaders(tenantA),
    );
    expect(ancA.status).toBe(201);
    const ancBody = await ancA.json();

    const ancB = await makeRequest(
      'POST',
      '/api/rental/ancillaries',
      {
        code: ancillaryCode,
        nameEn: 'Other GPS Unit',
        pricingType: 'PER_DAY',
        unitPrice: 20,
        isActive: true,
      },
      routeHeaders(tenantB),
    );
    expect(ancB.status).toBe(409);

    const visibleEventA = await makeRequest('GET', `/api/rental/rate-events/${eventBody.id}`, undefined, routeHeaders(tenantA));
    expect(visibleEventA.status).toBe(200);
    const hiddenEventB = await makeRequest('GET', `/api/rental/rate-events/${eventBody.id}`, undefined, routeHeaders(tenantB));
    expect(hiddenEventB.status).toBe(404);

    const visibleAncA = await makeRequest('GET', `/api/rental/ancillaries/${ancBody.id}`, undefined, routeHeaders(tenantA));
    expect(visibleAncA.status).toBe(200);
    const hiddenAncB = await makeRequest('GET', `/api/rental/ancillaries/${ancBody.id}`, undefined, routeHeaders(tenantB));
    expect(hiddenAncB.status).toBe(404);
  }, 120_000);
});
