import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cachedJson } from '@/lib/response-helpers';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'fleet:stats';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

// Stats change at most a few times per minute (vehicles/documents/insurance
// don't flicker on every request). 60s server cache + 300s browser
// stale-while-revalidate gives a near-instant response on repeated page
// loads while still surfacing fresh data within a minute. The per-tenant
// cache key keeps responses isolated.
const getFleetStats = cacheRead(
  async (tenantId: string) => {
    await ensureFleetSchema();
    const [
      totalResult,
      availableResult,
      maintenanceResult,
      allocatedResult,
      expiringDocsResult,
      workOrdersResult,
      expiringInsuranceResult,
      byLifecycleResult,
      byUsageResult,
    ] = await Promise.all([

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'AVAILABLE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'MAINTENANCE'`,
      ).catch(zero),

      // lifecycle_stage added by hub migration — catch if column not yet present
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND lifecycle_stage = 'ALLOCATED'`,
      ).catch(zero),

      // vehicle_documents may not have deleted_at — use plain count
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM vehicle_documents
         WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`,
      ).catch(zero),

      // correct table name is work_orders (not fleet_work_orders)
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM work_orders
         WHERE status NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
      ).catch(zero),

      // correct table name is vehicle_insurance (not fleet_vehicle_insurance)
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM vehicle_insurance
         WHERE status = 'ACTIVE'
           AND end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ lifecycle_stage: string; count: bigint }>>(
        `SELECT COALESCE(lifecycle_stage, 'UNKNOWN') as lifecycle_stage, COUNT(*) as count
         FROM vehicles
         WHERE deleted_at IS NULL
         GROUP BY lifecycle_stage`,
      ).catch(() => [] as Array<{ lifecycle_stage: string; count: bigint }>),

      prisma.$queryRawUnsafe<Array<{ vehicle_usage: string; count: bigint }>>(
        `SELECT COALESCE(vehicle_usage, 'UNKNOWN') as vehicle_usage, COUNT(*) as count
         FROM vehicles
         WHERE deleted_at IS NULL
         GROUP BY vehicle_usage`,
      ).catch(() => [] as Array<{ vehicle_usage: string; count: bigint }>),
    ]);

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
  try {
    // tenantId is the per-tenant cache key — see server-cache.ts for the
    // security rationale (public CDN would leak data across tenants).
    const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';
    const stats = await getFleetStats(tenantId);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': privateCacheControl(60, 300) },
    });
  } catch (error) {
    console.error('Error fetching fleet stats:', error);
    return NextResponse.json({ error: 'Failed to fetch fleet stats' }, { status: 500 });
  }
}
