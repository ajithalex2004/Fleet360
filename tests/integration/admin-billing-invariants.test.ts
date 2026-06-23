import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  readJsonResponse,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;
type JsonMap = Record<string, unknown>;
type SubscriptionRow = Record<string, unknown>;
type SubscriptionListResponse = { data: SubscriptionRow[] };
type BillingDashboardResponse = {
  overview: {
    active_subscriptions: number;
    mrr: number;
  };
  reconciliation: {
    source_of_truth: string;
    status: string;
    canonical: {
      mrr: number;
    };
  };
  canonical_subscriptions: SubscriptionRow[];
};

async function deleteSubscription(id: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM tenant_module_subscriptions WHERE id = $1::uuid`, id).catch(() => {});
}

function routeHeaders(seed: SeedResult) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': seed.role.code,
  };
}

describe('Admin billing invariants', () => {
  let seed: SeedResult;
  let subscriptionId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    seed = await seedTestTenantFull('ENTERPRISE', 'SUPER_ADMIN');
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO tenant_module_subscriptions
         (tenant_id, module_code, plan_tier, billing_cycle, base_price, currency,
          max_vehicles, max_users, status, start_date, next_billing_date)
       VALUES ($1, 'RAC', 'STANDARD', 'MONTHLY', 2500, 'AED', 50, 5, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
       RETURNING id::text`,
      seed.tenant.id,
    );
    subscriptionId = rows[0]?.id ?? '';
  });

  afterAll(async () => {
    if (subscriptionId) await deleteSubscription(subscriptionId);
    if (seed) {
      await cleanupTenant(seed.tenant.id);
      await cleanupUser(seed.user.id);
    }
  }, 30_000);

  it('returns subscription rows when the billing overview reports active subscriptions', async () => {
    if (!serverAvailable) return;

    const [dashboardRes, subsRes] = await Promise.all([
      makeRequest('GET', '/api/billing?type=dashboard', undefined, routeHeaders(seed)),
      makeRequest('GET', '/api/tenant-subscriptions', undefined, routeHeaders(seed)),
    ]);

    expect(dashboardRes.status).toBe(200);
    expect(subsRes.status).toBe(200);

    const dashboard = await readJsonResponse<BillingDashboardResponse>(dashboardRes, 'billing dashboard');
    const subs = await readJsonResponse<SubscriptionListResponse>(subsRes, 'tenant subscriptions');
    const activeRows = (subs.data ?? []).filter((row) => row.status === 'ACTIVE');

    expect(dashboard.overview.active_subscriptions).toBeGreaterThanOrEqual(1);
    expect(dashboard.reconciliation).toMatchObject({
      source_of_truth: 'tenant_module_subscriptions',
      status: 'OK',
    });
    expect(dashboard.canonical_subscriptions.some((row) => row.id === subscriptionId)).toBe(true);
    expect(activeRows.length).toBeGreaterThanOrEqual(1);
    expect(activeRows.some((row) => row.id === subscriptionId)).toBe(true);
  });

  it('has no orphan tenant_module_subscriptions rows', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string }>>(
      `SELECT s.id::text, s.tenant_id
         FROM tenant_module_subscriptions s
         LEFT JOIN tenants t ON t.id = s.tenant_id
        WHERE t.id IS NULL`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps billing MRR equal to active subscription row totals', async () => {
    if (!serverAvailable) return;

    const dashboardRes = await makeRequest('GET', '/api/billing?type=dashboard', undefined, routeHeaders(seed));
    const subsRes = await makeRequest('GET', '/api/tenant-subscriptions', undefined, routeHeaders(seed));
    expect(dashboardRes.status).toBe(200);
    expect(subsRes.status).toBe(200);

    const dashboard = await readJsonResponse<BillingDashboardResponse>(dashboardRes, 'billing dashboard');
    const subs = await readJsonResponse<SubscriptionListResponse>(subsRes, 'tenant subscriptions');
    const rowMrr = (subs.data ?? [])
      .filter((row) => row.status === 'ACTIVE')
      .reduce((sum: number, row) => {
        const price = Number(row.base_price ?? 0);
        return sum + (row.billing_cycle === 'ANNUAL' ? price / 12 : price);
      }, 0);

    expect(Math.round(Number(dashboard.overview.mrr) * 100) / 100).toBe(Math.round(rowMrr * 100) / 100);
    expect(Math.round(Number(dashboard.reconciliation.canonical.mrr) * 100) / 100).toBe(Math.round(rowMrr * 100) / 100);
  });
});
