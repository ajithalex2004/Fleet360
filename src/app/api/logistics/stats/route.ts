import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'logistics:stats';

const activeShipmentStatuses = ['DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY', 'ACTIVE'];
const completedShipmentStatuses = ['CLOSED', 'COMPLETED', 'DELIVERED', 'POD_SUBMITTED'];

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

type CountRow = { count: bigint | number | string };

type RecentShipmentRow = {
  id: string;
  booking_ref: string;
  status: string;
  start_date: Date | null;
  end_date: Date | null;
  origin_location: string | null;
  destination: string | null;
  customer_name: string | null;
  created_at: Date | null;
};

function count(row: CountRow[] | undefined) {
  return Number(row?.[0]?.count ?? 0);
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// 8 raw SQL queries on every page load — wrap in cacheRead. The page
// also auto-refreshes every 30s, but the server cache means the auto-
// refresh now hits the Data Cache instead of Neon. Per-tenant key keeps
// responses isolated (no `public` because the URL doesn't carry the
// tenantId — see server-cache.ts for the security rationale).
const getLogisticsStats = cacheRead(
  async (tenantId: string) => {
    const [
      totalVehicles,
      availableVehicles,
      inMaintenance,
      activeTrips,
      completedToday,
      pendingBookings,
      driversResult,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM vehicles
          WHERE tenant_id = $1 AND deleted_at IS NULL AND vehicle_usage = 'LOGISTICS'`,
        tenantId,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM vehicles
          WHERE tenant_id = $1 AND deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'AVAILABLE'`,
        tenantId,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM vehicles
          WHERE tenant_id = $1 AND deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'MAINTENANCE'`,
        tenantId,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
          FROM logistics_shipment_orders
          WHERE tenant_id = $1 AND deleted_at IS NULL AND status = ANY($2::text[])`,
        tenantId,
        activeShipmentStatuses,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM logistics_shipment_orders
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND status = ANY($2::text[])
            AND DATE(updated_at) = CURRENT_DATE`,
        tenantId,
        completedShipmentStatuses,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
           FROM logistics_shipment_orders
          WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'PENDING'`,
        tenantId,
      ).catch(zero),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS count
          FROM drivers
          WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantId,
      ).catch(zero),
    ]);

    const recentTrips = await prisma.$queryRawUnsafe<RecentShipmentRow[]>(
      `SELECT id,
              shipment_no AS booking_ref,
              status,
              pickup_window_from AS start_date,
              delivery_window_to AS end_date,
              origin_name AS origin_location,
              destination_name AS destination,
              cargo_owner_name AS customer_name,
              created_at
         FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 10`,
      tenantId,
    ).catch(() => [] as RecentShipmentRow[]);

    return {
      totalVehicles: count(totalVehicles),
      availableVehicles: count(availableVehicles),
      inMaintenance: count(inMaintenance),
      activeTrips: count(activeTrips),
      completedToday: count(completedToday),
      pendingBookings: count(pendingBookings),
      drivers: count(driversResult),
      recentTrips: recentTrips.map((trip) => ({
        ...trip,
        start_date: iso(trip.start_date),
        end_date: iso(trip.end_date),
        created_at: iso(trip.created_at),
      })),
    };
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    const data = await getLogisticsStats(tenantId);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (err) {
    console.error('[logistics/stats]', err);
    return NextResponse.json(
      {
        totalVehicles: 0,
        availableVehicles: 0,
        inMaintenance: 0,
        activeTrips: 0,
        completedToday: 0,
        pendingBookings: 0,
        drivers: 0,
        recentTrips: [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
