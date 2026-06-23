import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { backfillLegacyLogisticsBookings, ensureLogisticsDomainTables } from '@/lib/logistics/domain';
import { getTenantContextOrNull } from '@/lib/tenant-session';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

function logisticsTenantContext(req: NextRequest) {
  const ctx = getTenantContextOrNull(req);
  if (ctx) return ctx;
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? 'logistics-stats';
  return tenantId ? { tenantId, userId, plan: req.headers.get('x-tenant-plan') ?? 'UNKNOWN' } : null;
}

export async function GET(req: NextRequest) {
  try {
    const tenantCtx = logisticsTenantContext(req);
    if (tenantCtx) {
      await backfillLegacyLogisticsBookings({
        tenantId: tenantCtx.tenantId,
        actorUserId: tenantCtx.userId,
        limit: 250,
      });
      await ensureLogisticsDomainTables();
    }

    const [
      totalVehicles,
      availableVehicles,
      inMaintenance,
      activeTrips,
      completedToday,
      pendingBookings,
      driversResult,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'AVAILABLE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'MAINTENANCE'`,
      ).catch(zero),

      tenantCtx
        ? prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count
               FROM logistics_shipment_orders
              WHERE deleted_at IS NULL
                AND tenant_id = $1
                AND status IN ('APPROVED','ASSIGNED','DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY')`,
            tenantCtx.tenantId,
          ).catch(zero)
        : prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS' AND status IN ('CONFIRMED','ACTIVE')`,
          ).catch(zero),

      tenantCtx
        ? prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count
               FROM logistics_shipment_orders
              WHERE deleted_at IS NULL
                AND tenant_id = $1
                AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
                AND DATE(updated_at) = CURRENT_DATE`,
            tenantCtx.tenantId,
          ).catch(zero)
        : prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS' AND status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE`,
          ).catch(zero),

      tenantCtx
        ? prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count
               FROM logistics_shipment_orders
              WHERE deleted_at IS NULL
                AND tenant_id = $1
                AND status = 'PENDING'`,
            tenantCtx.tenantId,
          ).catch(zero)
        : prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS' AND status = 'PENDING'`,
          ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM drivers WHERE deleted_at IS NULL AND assignment_type = 'LOGISTICS'`,
      ).catch(zero),
    ]);

    // Recent trips
    const recentTrips = tenantCtx
      ? await prisma.$queryRawUnsafe<Array<{
          id: string; booking_ref: string; status: string;
          start_date: Date; end_date: Date | null;
          origin_location: string | null; destination: string | null;
          customer_name: string | null; created_at: Date;
        }>>(
          `SELECT COALESCE(legacy_booking_id, id) AS id,
                  shipment_no AS booking_ref,
                  status,
                  pickup_window_from AS start_date,
                  delivery_window_to AS end_date,
                  COALESCE(origin_name, origin_address) AS origin_location,
                  COALESCE(destination_name, destination_address) AS destination,
                  cargo_owner_name AS customer_name,
                  created_at
             FROM logistics_shipment_orders
            WHERE deleted_at IS NULL
              AND tenant_id = $1
            ORDER BY created_at DESC
            LIMIT 10`,
          tenantCtx.tenantId,
        ).catch(() => [] as Array<{
          id: string; booking_ref: string; status: string;
          start_date: Date; end_date: Date | null;
          origin_location: string | null; destination: string | null;
          customer_name: string | null; created_at: Date;
        }>)
      : await prisma.$queryRawUnsafe<Array<{
      id: string; booking_ref: string; status: string;
      start_date: Date; end_date: Date | null;
      origin_location: string | null; destination: string | null;
      customer_name: string | null; created_at: Date;
    }>>(
        `SELECT b.id, b.booking_ref, b.status, b.start_date, b.end_date,
                b.origin_location, b.destination, b.customer_name, b.created_at
         FROM bookings b
         WHERE b.deleted_at IS NULL AND b.service_type = 'LOGISTICS'
         ORDER BY b.created_at DESC
         LIMIT 10`,
      ).catch(() => [] as Array<{
      id: string; booking_ref: string; status: string;
      start_date: Date; end_date: Date | null;
      origin_location: string | null; destination: string | null;
      customer_name: string | null; created_at: Date;
    }>);

    return NextResponse.json({
      totalVehicles:    Number(totalVehicles[0]?.count    ?? 0),
      availableVehicles: Number(availableVehicles[0]?.count ?? 0),
      inMaintenance:    Number(inMaintenance[0]?.count    ?? 0),
      activeTrips:      Number(activeTrips[0]?.count      ?? 0),
      completedToday:   Number(completedToday[0]?.count   ?? 0),
      pendingBookings:  Number(pendingBookings[0]?.count  ?? 0),
      drivers:          Number(driversResult[0]?.count    ?? 0),
      recentTrips:      recentTrips.map(t => ({
        ...t,
        start_date: t.start_date?.toISOString?.() ?? null,
        end_date:   t.end_date?.toISOString?.()   ?? null,
        created_at: t.created_at?.toISOString?.() ?? null,
      })),
    });
  } catch (err) {
    console.error('[logistics/stats]', err);
    return NextResponse.json({
      totalVehicles: 0, availableVehicles: 0, inMaintenance: 0,
      activeTrips: 0, completedToday: 0, pendingBookings: 0, drivers: 0, recentTrips: [],
    });
  }
}
