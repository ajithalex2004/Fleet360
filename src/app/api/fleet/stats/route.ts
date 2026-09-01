export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cachedJson } from '@/lib/response-helpers';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'fleet:stats';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

// Stats change at most a few times per minute (vehicles/documents/insurance
// don't flicker on every request). 60s server cache + 300s browser
// stale-while-revalidate gives a near-instant response on repeated page
// loads while still surfacing fresh data within a minute. The per-tenant
// cache key keeps responses isolated.
//
// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages. None of the queries
// below have their own tenant_id filter — they rely entirely on RLS, which
// is force-applied to the runtime role regardless. With no scope ever set,
// every query returned zero rows for every tenant, and each .catch(zero)
// masked it as an empty/zero result rather than a visible error.
// withTenantRls sets app.tenant_id explicitly and gives every query below
// the same pinned, scoped connection. Queries run as individually-awaited
// statements, NOT built into an array first (even via Promise.all or the
// runSequential helper) - chaining .catch() onto a Prisma query eagerly
// dispatches it (that's what .then/.catch DOES for a lazy Prisma promise),
// so building an array of already-.catch()-chained queries fires them all
// concurrently over the one shared tx connection regardless of how the
// array is later consumed. That previously caused a cross-tenant leak here
// (fleet/stats returned the platform-wide vehicle count instead of the
// caller's tenant's). Each `await ... .catch(...)` below fully resolves
// before the next statement's query is even constructed.
const getFleetStats = cacheRead(
  async (tenantId: string) => {
    await ensureFleetSchema();
    const { totalResult, availableResult, maintenanceResult, allocatedResult,
      expiringDocsResult, workOrdersResult, expiringInsuranceResult,
      byLifecycleResult, byUsageResult } = await withTenantRls(prisma, tenantId, async (tx) => {
      const totalResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL`,
      ).catch(zero);

      const availableResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'AVAILABLE'`,
      ).catch(zero);

      const maintenanceResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'MAINTENANCE'`,
      ).catch(zero);

      // lifecycle_stage added by hub migration — catch if column not yet present
      const allocatedResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND lifecycle_stage = 'ALLOCATED'`,
      ).catch(zero);

      // vehicle_documents may not have deleted_at — use plain count
      const expiringDocsResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM vehicle_documents
         WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`,
      ).catch(zero);

      // correct table name is work_orders (not fleet_work_orders)
      const workOrdersResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM work_orders
         WHERE status NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
      ).catch(zero);

      // correct table name is vehicle_insurance (not fleet_vehicle_insurance)
      const expiringInsuranceResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM vehicle_insurance
         WHERE status = 'ACTIVE'
           AND end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`,
      ).catch(zero);

      const byLifecycleResult = await tx.$queryRawUnsafe<Array<{ lifecycle_stage: string; count: bigint }>>(
        `SELECT COALESCE(lifecycle_stage, 'UNKNOWN') as lifecycle_stage, COUNT(*) as count
         FROM vehicles
         WHERE deleted_at IS NULL
         GROUP BY lifecycle_stage`,
      ).catch(() => [] as Array<{ lifecycle_stage: string; count: bigint }>);

      const byUsageResult = await tx.$queryRawUnsafe<Array<{ vehicle_usage: string; count: bigint }>>(
        `SELECT COALESCE(vehicle_usage, 'UNKNOWN') as vehicle_usage, COUNT(*) as count
         FROM vehicles
         WHERE deleted_at IS NULL
         GROUP BY vehicle_usage`,
      ).catch(() => [] as Array<{ vehicle_usage: string; count: bigint }>);

      return { totalResult, availableResult, maintenanceResult, allocatedResult,
        expiringDocsResult, workOrdersResult, expiringInsuranceResult,
        byLifecycleResult, byUsageResult };
    });

    return {
      totalVehicles:     Number(totalResult[0]?.count     ?? 0),
      available:         Number(availableResult[0]?.count  ?? 0),
      inMaintenance:     Number(maintenanceResult[0]?.count ?? 0),
      allocated:         Number(allocatedResult[0]?.count  ?? 0),
      expiringDocs:      Number(expiringDocsResult[0]?.count      ?? 0),
      openWorkOrders:    Number(workOrdersResult[0]?.count        ?? 0),
      expiringInsurance: Number(expiringInsuranceResult[0]?.count  ?? 0),
      byLifecycleStage:  byLifecycleResult.map(r => ({
        stage: r.lifecycle_stage,
        count: Number(r.count),
      })),
      byUsage: byUsageResult.map(r => ({
        usage: r.vehicle_usage,
        count: Number(r.count),
      })),
    };
  },
  [CACHE_TAG],
  60,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    // tenantId is the per-tenant cache key — see server-cache.ts for the
    // security rationale (public CDN would leak data across tenants).
    const stats = await getFleetStats(tenantId);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': privateCacheControl(60, 300) },
    });
    } catch (e) {
    console.error('Error fetching fleet stats:', e);
    return NextResponse.json({ error: 'Failed to fetch fleet stats' }, { status: 500 });
  }
}
