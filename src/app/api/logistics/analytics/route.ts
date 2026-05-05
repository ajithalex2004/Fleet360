import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);
const zeroNum = () => Promise.resolve([{ val: null as null | string }]);

/**
 * GET /api/logistics/analytics
 * Returns KPI data for the logistics analytics dashboard.
 */
export async function GET() {
  try {
    // ── Core counts ─────────────────────────────────────────────────────────
    const [
      totalTrips,
      closedTrips,
      cancelledTrips,
      pendingTrips,
      activeTrips,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND status IN ('CLOSED','COMPLETED','DELIVERED','POD_SUBMITTED')`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND status = 'CANCELLED'`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND status = 'PENDING'`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND status IN ('DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','ACTIVE')`
      ).catch(zero),
    ]);

    // ── Vehicle stats ────────────────────────────────────────────────────────
    const [totalVehicles, availableVehicles, maintenanceVehicles] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS'`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'AVAILABLE'`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'LOGISTICS' AND status = 'MAINTENANCE'`
      ).catch(zero),
    ]);

    // ── Trips completed per day (last 14 days) ───────────────────────────────
    const dailyCompleted = await prisma.$queryRawUnsafe<Array<{ day: string; trips: bigint }>>(
      `SELECT DATE(updated_at) as day, COUNT(*) as trips
       FROM bookings
       WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND status IN ('CLOSED','COMPLETED','DELIVERED','POD_SUBMITTED')
         AND updated_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(updated_at)
       ORDER BY day ASC`
    ).catch(() => [] as Array<{ day: string; trips: bigint }>);

    // ── Trips by status distribution ─────────────────────────────────────────
    const statusDist = await prisma.$queryRawUnsafe<Array<{ status: string; count: bigint }>>(
      `SELECT status, COUNT(*) as count
       FROM bookings
       WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
       GROUP BY status
       ORDER BY count DESC`
    ).catch(() => [] as Array<{ status: string; count: bigint }>);

    // ── Trips by day of week ─────────────────────────────────────────────────
    const tripsByDow = await prisma.$queryRawUnsafe<Array<{ dow: number; trips: bigint }>>(
      `SELECT EXTRACT(DOW FROM start_date)::int as dow, COUNT(*) as trips
       FROM bookings
       WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND start_date IS NOT NULL
       GROUP BY dow
       ORDER BY dow ASC`
    ).catch(() => [] as Array<{ dow: number; trips: bigint }>);

    // ── On-time rate (trips completed by end_date) ───────────────────────────
    const [onTimeTrips, tripsWithDeadline] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
           AND status IN ('CLOSED','COMPLETED','DELIVERED','POD_SUBMITTED')
           AND end_date IS NOT NULL AND updated_at <= end_date`
      ).catch(zero),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
           AND status IN ('CLOSED','COMPLETED','DELIVERED','POD_SUBMITTED')
           AND end_date IS NOT NULL`
      ).catch(zero),
    ]);

    // ── Shipment type breakdown (from notes JSON) ─────────────────────────────
    const shipmentTypes = await prisma.$queryRawUnsafe<Array<{ shipment_type: string; count: bigint }>>(
      `SELECT
         COALESCE(notes::json->>'shipmentType', 'UNSPECIFIED') AS shipment_type,
         COUNT(*) AS count
       FROM bookings
       WHERE deleted_at IS NULL AND service_type = 'LOGISTICS'
         AND notes IS NOT NULL AND notes != ''
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 8`
    ).catch(() => [] as Array<{ shipment_type: string; count: bigint }>);

    // ── Compose response ─────────────────────────────────────────────────────
    const total    = Number(totalTrips[0]?.count ?? 0);
    const closed   = Number(closedTrips[0]?.count ?? 0);
    const cancelled = Number(cancelledTrips[0]?.count ?? 0);
    const tveh     = Number(totalVehicles[0]?.count ?? 0);
    const avail    = Number(availableVehicles[0]?.count ?? 0);
    const deadline = Number(tripsWithDeadline[0]?.count ?? 0);
    const onTime   = Number(onTimeTrips[0]?.count ?? 0);

    return NextResponse.json({
      // KPI cards
      totalTrips:       total,
      completedTrips:   closed,
      cancelledTrips:   cancelled,
      pendingTrips:     Number(pendingTrips[0]?.count ?? 0),
      activeTrips:      Number(activeTrips[0]?.count ?? 0),
      completionRate:   total > 0 ? Math.round((closed / total) * 100) : 0,
      cancellationRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
      onTimeRate:       deadline > 0 ? Math.round((onTime / deadline) * 100) : null,

      // Fleet
      totalVehicles:    tveh,
      availableVehicles: avail,
      maintenanceVehicles: Number(maintenanceVehicles[0]?.count ?? 0),
      fleetUtilization: tveh > 0 ? Math.round(((tveh - avail) / tveh) * 100) : 0,

      // Charts
      dailyCompleted: dailyCompleted.map(r => ({
        day:   r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day),
        trips: Number(r.trips),
      })),
      statusDistribution: statusDist.map(r => ({
        status: r.status,
        count:  Number(r.count),
      })),
      tripsByDow: tripsByDow.map(r => ({
        dow:   Number(r.dow),
        label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][Number(r.dow)] ?? `D${r.dow}`,
        trips: Number(r.trips),
      })),
      shipmentTypes: shipmentTypes.map(r => ({
        type:  r.shipment_type,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    console.error('[logistics/analytics]', err);
    return NextResponse.json({
      totalTrips: 0, completedTrips: 0, cancelledTrips: 0, pendingTrips: 0, activeTrips: 0,
      completionRate: 0, cancellationRate: 0, onTimeRate: null,
      totalVehicles: 0, availableVehicles: 0, maintenanceVehicles: 0, fleetUtilization: 0,
      dailyCompleted: [], statusDistribution: [], tripsByDow: [], shipmentTypes: [],
    });
  }
}
